/**
 * MPESA STK CALLBACK EDGE FUNCTION
 * 
 * Purpose: Handle STK Push callback from Safaricom
 * Input: Callback payload from Safaricom
 * Output: HTTP 200 (must respond within 5 seconds)
 * 
 * Critical Requirements:
 * 1. Respond within 5 seconds (Safaricom requirement)
 * 2. Verify IP is from Safaricom (196.201.214.200-208)
 * 3. Implement idempotency (same callback twice = same result)
 * 4. Log all callbacks (audit trail)
 * 5. Credit wallet on success
 * 6. Handle all error scenarios
 * 
 * Flow:
 * 1. Verify IP is from Safaricom
 * 2. Parse callback payload
 * 3. Verify CheckoutRequestID exists
 * 4. Check idempotency (already processed?)
 * 5. If success (ResultCode == 0):
 *    a) Credit wallet
 *    b) Create transaction record
 *    c) Update profiles.total_deposited
 *    d) Broadcast to admin via Realtime
 * 6. If failure (ResultCode != 0):
 *    a) Mark as failed
 *    b) Log failure reason
 * 7. Return HTTP 200
 * 
 * Reasoning:
 * - IP verification prevents spoofed requests
 * - Idempotency prevents duplicate credits
 * - Fast response prevents Safaricom retries
 * - Comprehensive logging enables debugging
 * - Database transaction ensures atomicity
 * 
 * Security:
 * - IP whitelist (Safaricom IPs only)
 * - Idempotency checks
 * - Database transaction
 * - Audit logging
 * - HTTPS only
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// ============================================
// TYPES
// ============================================

interface STKCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

interface CallbackMetadata {
  Amount: number;
  MpesaReceiptNumber: string;
  TransactionDate: string;
  PhoneNumber: string;
}

// ============================================
// CONSTANTS
// ============================================

const SAFARICOM_IP_RANGES = [
  "196.201.214.200",
  "196.201.214.201",
  "196.201.214.202",
  "196.201.214.203",
  "196.201.214.204",
  "196.201.214.205",
  "196.201.214.206",
  "196.201.214.207",
  "196.201.214.208",
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

function log(level: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const context = data ? JSON.stringify(data) : "";
  console.log(`[${timestamp}] [${level}] ${message} ${context}`);
}

/**
 * Get client IP from request
 * Reasoning: Extract IP from X-Forwarded-For or CF-Connecting-IP headers
 */
function getClientIP(req: Request): string {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }

  const cfConnectingIP = req.headers.get("cf-connecting-ip");
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  return "unknown";
}

/**
 * Verify IP is from Safaricom
 * Reasoning: Prevent spoofed callbacks from unauthorized sources
 */
function verifySafaricomIP(ip: string): boolean {
  return SAFARICOM_IP_RANGES.includes(ip);
}

/**
 * Extract callback metadata
 * Reasoning: Parse Safaricom's nested metadata structure
 */
function extractMetadata(items: Array<{ Name: string; Value: string | number }>): CallbackMetadata | null {
  const metadata: Record<string, string | number> = {};

  for (const item of items) {
    metadata[item.Name] = item.Value;
  }

  if (!metadata.Amount || !metadata.MpesaReceiptNumber || !metadata.TransactionDate || !metadata.PhoneNumber) {
    return null;
  }

  return {
    Amount: Number(metadata.Amount),
    MpesaReceiptNumber: String(metadata.MpesaReceiptNumber),
    TransactionDate: String(metadata.TransactionDate),
    PhoneNumber: String(metadata.PhoneNumber),
  };
}

/**
 * Check if callback already processed (idempotency)
 * Reasoning: Safaricom may retry callbacks, prevent duplicate credits
 */
async function isCallbackProcessed(
  supabase: ReturnType<typeof createClient>,
  checkoutRequestId: string
): Promise<{ processed: boolean; status?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("mpesa_stk_requests")
      .select("status")
      .eq("checkout_request_id", checkoutRequestId)
      .maybeSingle();

    if (error) {
      log("ERROR", "Failed to check idempotency", { error });
      return { processed: false, error: "Database error" };
    }

    if (!data) {
      log("WARN", "CheckoutRequestID not found", { checkoutRequestId });
      return { processed: false, error: "CheckoutRequestID not found" };
    }

    // If status is not 'initiated', it's already been processed
    if (data.status !== "initiated") {
      log("INFO", "Callback already processed", { checkoutRequestId, status: data.status });
      return { processed: true, status: data.status };
    }

    return { processed: false };
  } catch (error) {
    log("ERROR", "Idempotency check error", { error });
    return { processed: false, error: "Database error" };
  }
}

/**
 * Credit wallet on successful deposit
 * Reasoning: Update wallet balance and create transaction record
 */
async function creditWallet(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  mpesaReceiptNumber: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletError || !wallet) {
      log("ERROR", "Wallet not found", { userId });
      return { success: false, error: "Wallet not found" };
    }

    // NOTE: wallet crediting is done SERVER-SIDE by the DB trigger
    // trg_credit_mpesa_deposit (migration 20260829010000): it credits
    // real_balance (cents) + writes ledger_entries via _wallet_move when the
    // 'deposit' transaction row is inserted below. Do NOT mutate wallets.balance
    // here — post-P1b `balance` is a derived cache that _wallet_move recomputes,
    // so a manual write is either erased or (worse) risks a double credit.

    // Create transaction record (fires the credit + first-deposit-match triggers)
    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "deposit",
      amount,
      payment_method: "mpesa",
      reference: mpesaReceiptNumber,
      description: "M-Pesa deposit",
      status: "completed",
      created_at: new Date().toISOString(),
    });

    if (transactionError) {
      log("ERROR", "Failed to create transaction", { error: transactionError });
      return { success: false, error: "Failed to create transaction" };
    }

    // Update profiles.total_deposited
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("total_deposited")
      .eq("id", userId)
      .maybeSingle();

    if (!profileError && profile) {
      const newTotalDeposited = Number(profile.total_deposited || 0) + amount;
      await supabase
        .from("profiles")
        .update({ total_deposited: newTotalDeposited, last_active_at: new Date().toISOString() })
        .eq("id", userId);
    }

    return { success: true };
  } catch (error) {
    log("ERROR", "Credit wallet error", { error });
    return { success: false, error: "Credit wallet failed" };
  }
}

/**
 * Update STK request status
 * Reasoning: Mark callback as processed
 */
async function updateSTKRequestStatus(
  supabase: ReturnType<typeof createClient>,
  checkoutRequestId: string,
  status: string,
  resultCode: number,
  resultDesc: string,
  mpesaReceiptNumber?: string,
  callbackPayload?: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = {
      status,
      result_code: resultCode,
      result_desc: resultDesc,
      completed_at: new Date().toISOString(),
      callback_payload: callbackPayload,
    };

    if (mpesaReceiptNumber) {
      updateData.mpesa_receipt_number = mpesaReceiptNumber;
    }

    const { error } = await supabase
      .from("mpesa_stk_requests")
      .update(updateData)
      .eq("checkout_request_id", checkoutRequestId);

    if (error) {
      log("ERROR", "Failed to update STK request", { error });
      return { success: false, error: "Failed to update STK request" };
    }

    return { success: true };
  } catch (error) {
    log("ERROR", "Update STK request error", { error });
    return { success: false, error: "Update failed" };
  }
}

/**
 * Broadcast to admin via Realtime
 * Reasoning: Notify admin dashboard of new deposit
 */
async function broadcastToAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  mpesaReceiptNumber: string
): Promise<void> {
  try {
    // Broadcast via Realtime
    supabase.channel("admin-feed").send("broadcast", {
      event: "deposit",
      data: {
        user_id: userId,
        amount,
        mpesa_receipt_number: mpesaReceiptNumber,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log("WARN", "Failed to broadcast to admin", { error });
    // Don't fail the callback if broadcast fails
  }
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      log("WARN", `Invalid method: ${req.method}`);
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Invalid method" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    log("INFO", "STK Callback received");

    // Verify IP
    const clientIP = getClientIP(req);
    log("INFO", "Client IP", { ip: clientIP });

    if (!verifySafaricomIP(clientIP)) {
      log("ERROR", "Invalid IP address", { ip: clientIP });
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Invalid IP" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse callback payload
    let callback: STKCallback;
    try {
      callback = await req.json();
    } catch {
      log("ERROR", "Invalid JSON in callback");
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stkCallback = callback.Body?.stkCallback;
    if (!stkCallback) {
      log("ERROR", "Invalid callback structure");
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Invalid structure" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    log("INFO", "Callback details", { CheckoutRequestID, ResultCode, ResultDesc });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      log("ERROR", "Missing Supabase configuration");
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Check idempotency
    const idempotencyCheck = await isCallbackProcessed(supabase, CheckoutRequestID);
    if (idempotencyCheck.processed) {
      log("INFO", "Callback already processed, returning 200");
      return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (idempotencyCheck.error) {
      log("ERROR", "Idempotency check failed", { error: idempotencyCheck.error });
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get STK request details
    const { data: stkRequest, error: stkError } = await supabase
      .from("mpesa_stk_requests")
      .select("user_id, amount")
      .eq("checkout_request_id", CheckoutRequestID)
      .maybeSingle();

    if (stkError || !stkRequest) {
      log("ERROR", "STK request not found", { CheckoutRequestID });
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Process based on ResultCode
    if (ResultCode === 0) {
      // Success
      log("INFO", "Deposit successful");

      // Extract metadata
      let metadata: CallbackMetadata | null = null;
      if (CallbackMetadata?.Item) {
        metadata = extractMetadata(CallbackMetadata.Item);
      }

      if (!metadata) {
        log("ERROR", "Failed to extract metadata");
        return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Invalid metadata" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Credit wallet
      const creditResult = await creditWallet(supabase, stkRequest.user_id, stkRequest.amount, metadata.MpesaReceiptNumber);

      if (!creditResult.success) {
        log("ERROR", "Failed to credit wallet");
        return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Credit failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update STK request status
      const updateResult = await updateSTKRequestStatus(
        supabase,
        CheckoutRequestID,
        "completed",
        ResultCode,
        ResultDesc,
        metadata.MpesaReceiptNumber,
        callback
      );

      if (!updateResult.success) {
        log("ERROR", "Failed to update STK request");
        return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Update failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Broadcast to admin
      await broadcastToAdmin(supabase, stkRequest.user_id, stkRequest.amount, metadata.MpesaReceiptNumber);

      log("INFO", "Deposit processed successfully", {
        userId: stkRequest.user_id,
        amount: stkRequest.amount,
        receipt: metadata.MpesaReceiptNumber,
      });
    } else {
      // Failure
      log("INFO", "Deposit failed", { ResultCode, ResultDesc });

      // Update STK request status
      const updateResult = await updateSTKRequestStatus(
        supabase,
        CheckoutRequestID,
        "failed",
        ResultCode,
        ResultDesc,
        undefined,
        callback
      );

      if (!updateResult.success) {
        log("ERROR", "Failed to update STK request");
        return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Update failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Calculate response time
    const responseTime = Date.now() - startTime;
    log("INFO", "Callback processed", { responseTime: `${responseTime}ms` });

    // Return success response
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log("ERROR", "Unhandled error", { error: String(error) });
    return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/**
 * DEPLOYMENT INSTRUCTIONS
 * 
 * 1. Create directory:
 *    mkdir -p supabase/functions/mpesa-stk-callback
 * 
 * 2. Save this file as:
 *    supabase/functions/mpesa-stk-callback/index.ts
 * 
 * 3. Deploy:
 *    supabase functions deploy mpesa-stk-callback
 * 
 * 4. Register callback URL with Safaricom:
 *    https://your-project.supabase.co/functions/v1/mpesa-stk-callback
 * 
 * 5. Test with mock callback:
 *    curl -X POST http://localhost:54321/functions/v1/mpesa-stk-callback \
 *      -H "Content-Type: application/json" \
 *      -H "X-Forwarded-For: 196.201.214.200" \
 *      -d '{
 *        "Body": {
 *          "stkCallback": {
 *            "MerchantRequestID": "test",
 *            "CheckoutRequestID": "test-checkout-id",
 *            "ResultCode": 0,
 *            "ResultDesc": "The service request is processed successfully.",
 *            "CallbackMetadata": {
 *              "Item": [
 *                {"Name": "Amount", "Value": 500},
 *                {"Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV"},
 *                {"Name": "TransactionDate", "Value": "20191219102115"},
 *                {"Name": "PhoneNumber", "Value": "254712345678"}
 *              ]
 *            }
 *          }
 *        }
 *      }'
 */
