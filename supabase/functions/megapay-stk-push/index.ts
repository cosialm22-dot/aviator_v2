// POST {amount, phone} with the player's session → sends a Mega Pay M-Pesa prompt.
// The player comes from the JWT, never from the body. The deposit is recorded (fn_megapay_begin)
// BEFORE Mega Pay is called; the wallet is credited only after Mega Pay reports it paid
// (megapay-status / megapay-reconcile → fn_megapay_settle).
import { configured, cors, friendly, initiateStk, json, toMsisdn } from "../_shared/megapay.ts";
import { accountFor, caller, serviceClient } from "../_shared/megapayRuntime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const db = serviceClient();
    const me = await caller(req, db);
    if (!me) return json({ success: false, error: "AUTH_REQUIRED", message: "Sign in to deposit." }, 401);

    let body: { amount?: unknown; phone?: unknown };
    try { body = await req.json(); } catch { return json({ success: false, error: "BAD_JSON", message: "Invalid request." }, 400); }
    const amount = Number(body.amount);
    const msisdn = toMsisdn(String(body.phone ?? ""));
    if (!msisdn) return json({ success: false, error: "INVALID_PHONE", message: friendly("INVALID_PHONE") }, 400);

    // fn_megapay_begin checks the brand's switches and limits, picks the brand's payment owner
    // (brand → platform → System) and records the account on the deposit row.
    const { data: begun, error: bErr } = await db.rpc("fn_megapay_begin", { p_user: me.id, p_phone: msisdn, p_amount: amount });
    if (bErr) {
      const code = String(bErr.message ?? "").trim();
      const status = code.startsWith("RATE_LIMITED") ? 429 : code.startsWith("DEPOSITS_DISABLED") || code.startsWith("MEGAPAY_DISABLED") ? 403
        : code.startsWith("GATEWAY_NOT_CONFIGURED") ? 503 : 400;
      return json({ success: false, error: code.split(":")[0], message: friendly(code) }, status);
    }
    const dep = begun as { id: string; reference: string; payment_scope: string; integration_id: string | null };
    const cfg = await accountFor(db, dep);
    if (!cfg || !configured(cfg)) {
      await db.rpc("fn_megapay_initiation_failed", { p_id: dep.id, p_reason: "gateway not configured" });
      console.error(`[megapay] no account for scope ${dep.payment_scope}`);
      return json({ success: false, error: "MEGAPAY_NOT_CONFIGURED", message: "Deposits are temporarily unavailable." }, 503);
    }

    let init;
    try {
      init = await initiateStk(cfg, { amountKes: amount, msisdn, reference: dep.reference });
    } catch (e) {
      // Network error / timeout: we don't know if the prompt went out. The row stays "initiated";
      // it is closed after 10 minutes and listed for staff to check in Mega Pay.
      console.error(`[megapay] initiate error for ${dep.id}: ${(e as Error).message}`);
      return json({ success: false, error: "MEGAPAY_UNREACHABLE", message: "We couldn't reach M-Pesa. If you got a prompt and paid, your deposit will be checked by support.", id: dep.id }, 502);
    }
    if (!init.ok) {
      await db.rpc("fn_megapay_initiation_failed", { p_id: dep.id, p_reason: init.reason });
      console.warn(`[megapay] initiate rejected for ${dep.id}: ${init.reason}`);
      return json({ success: false, error: "MEGAPAY_REJECTED", message: "M-Pesa could not send the prompt. Check the number and try again.", id: dep.id }, 502);
    }
    const { error: aErr } = await db.rpc("fn_megapay_attach", { p_id: dep.id, p_trid: init.transactionRequestId, p_merchant: init.merchantRequestId });
    if (aErr) console.error(`[megapay] attach failed for ${dep.id}: ${aErr.message}`);
    return json({ success: true, id: dep.id, transaction_request_id: init.transactionRequestId, message: "Check your phone and enter your M-Pesa PIN." });
  } catch (e) {
    console.error(`[megapay] stk-push error: ${(e as Error).message}`);
    return json({ success: false, error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, 500);
  }
});
