// Mega Pay (megapay.co.ke) client for the edge functions — pure and network-injectable, so the
// Deno tests drive it with a fake fetch. Same contract as invest254's HttpMegaPayClient
// (apps/engine/src/megapay.ts, verified against the live API):
//   POST {base}/initiatestk        {api_key, email, amount, msisdn, reference}
//        -> {ResponseCode:"0", transaction_request_id, CheckoutRequestID, MerchantRequestID}
//   POST {base}/transactionstatus  {api_key, email, transaction_request_id}
//        -> {ResultCode, TransactionStatus:"Pending"|"Completed"|…, TransactionReceipt}
// ResultCode on the status endpoint says whether the QUERY worked ("102" = not found / not yet);
// the payment outcome is TransactionStatus. Production host = /backend/v1 (/backend/v2 is a sandbox
// that refuses live keys).

export const MEGAPAY_PRODUCTION_BASE = "https://megapay.co.ke/backend/v1";
export const MEGAPAY_SANDBOX_BASE = "https://megapay.co.ke/backend/v2";

export interface MegaPayConfig { env: "production" | "sandbox"; apiKey: string; email: string; baseUrl: string }
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Outcome = "paid" | "failed" | "pending";

export function megapayConfig(get: (k: string) => string | undefined): MegaPayConfig {
  const env = get("MEGAPAY_ENV") === "sandbox" ? "sandbox" : "production";
  let base = (get("MEGAPAY_API_BASE") ?? "").trim().replace(/\/+$/, "");
  if (!base) base = env === "production" ? MEGAPAY_PRODUCTION_BASE : MEGAPAY_SANDBOX_BASE;
  if (env === "production" && base === MEGAPAY_SANDBOX_BASE) base = MEGAPAY_PRODUCTION_BASE; // a live key never works on the sandbox
  return { env, apiKey: (get("MEGAPAY_API_KEY") ?? "").trim(), email: (get("MEGAPAY_EMAIL") ?? "").trim(), baseUrl: base };
}

export const configured = (c: MegaPayConfig) => !!c.apiKey && !!c.email;

/** Kenyan number in any common form → 2547XXXXXXXX / 2541XXXXXXXX, or null. */
export function toMsisdn(raw: string): string | null {
  const d = String(raw ?? "").replace(/[^0-9]/g, "");
  let m: string | null = null;
  if (/^0[17]\d{8}$/.test(d)) m = "254" + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) m = "254" + d;
  else if (/^254[17]\d{8}$/.test(d)) m = d;
  return m;
}
/** Mega Pay takes the local 07…/01… form. */
export const toLocal = (msisdn: string) => "0" + msisdn.slice(3);

async function post(cfg: MegaPayConfig, path: string, body: Record<string, unknown>, fetchImpl: Fetch, timeoutMs: number): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: cfg.apiKey, email: cfg.email, ...body }),
      signal: ctl.signal,
    });
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw new Error(`MEGAPAY_HTTP_${res.status}:${JSON.stringify(j).slice(0, 200)}`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

export interface InitResult { ok: true; transactionRequestId: string; merchantRequestId: string }
export interface InitRejected { ok: false; reason: string }

/** Send the STK prompt. A provider rejection returns {ok:false}; a network error/timeout throws. */
export async function initiateStk(cfg: MegaPayConfig, a: { amountKes: number; msisdn: string; reference: string }, fetchImpl: Fetch = fetch, timeoutMs = 25000): Promise<InitResult | InitRejected> {
  const j = await post(cfg, "/initiatestk", { amount: String(Math.round(a.amountKes)), msisdn: toLocal(a.msisdn), reference: a.reference }, fetchImpl, timeoutMs);
  const code = String(j.ResponseCode ?? j.responseCode ?? "");
  const trid = j.transaction_request_id ?? j.TransactionRequestID ?? j.transactionRequestId;
  if (code !== "0" || !trid) {
    const reason = String(j.errorMessage ?? j.message ?? j.ResponseDescription ?? j.CustomerMessage ?? "Mega Pay rejected the request");
    return { ok: false, reason: reason.slice(0, 300) };
  }
  return { ok: true, transactionRequestId: String(trid), merchantRequestId: String(j.MerchantRequestID ?? j.merchantRequestId ?? "") };
}

const PAID = new Set(["completed", "success", "successful", "paid"]);
const FAILED = new Set(["failed", "cancelled", "canceled", "timeout", "timedout", "reversed", "declined", "insufficient"]);

/** Map TransactionStatus to paid / failed / pending. Anything unknown stays pending (never credits). */
export function mapStatus(transactionStatus: unknown): Outcome {
  const s = String(transactionStatus ?? "").trim().toLowerCase();
  if (PAID.has(s)) return "paid";
  if (FAILED.has(s)) return "failed";
  return "pending";
}

export interface StatusResult { outcome: Outcome; receipt: string | null; providerStatus: string; message: string | null; amount: number | null }

/** The amount Mega Pay says was paid, when it reports one (defence in depth against a mismatched row). */
export function reportedAmount(j: Record<string, unknown>): number | null {
  const raw = j.TransactionAmount ?? j.Amount ?? j.amount;
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function queryStatus(cfg: MegaPayConfig, trid: string, fetchImpl: Fetch = fetch, timeoutMs = 15000): Promise<StatusResult> {
  const j = await post(cfg, "/transactionstatus", { transaction_request_id: trid }, fetchImpl, timeoutMs);
  const queryCode = String(j.ResultCode ?? "");
  const status = j.TransactionStatus;
  const message = j.errorMessage != null ? String(j.errorMessage) : null;
  if (queryCode === "102" || status == null || status === "") {
    return { outcome: "pending", receipt: null, providerStatus: queryCode === "102" ? "not_found" : "unknown", message, amount: null };
  }
  const outcome = mapStatus(status);
  const r = j.TransactionReceipt ?? j.TransactionCode;
  const receipt = outcome === "paid" && r != null && String(r) !== "N/A" && String(r).trim() !== "" ? String(r).trim() : null;
  return { outcome, receipt, providerStatus: String(status), message, amount: reportedAmount(j) };
}

/** Read-only credential check: ask for a transaction that cannot exist. */
export async function testCredentials(cfg: MegaPayConfig, fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const j = await post(cfg, "/transactionstatus", { transaction_request_id: "credential-check-0000" }, fetchImpl, 15000);
  const msg = String(j.errorMessage ?? j.ResultDesc ?? j.message ?? "");
  if (/transaction request does not exist/i.test(msg)) return { ok: true, message: "Mega Pay accepted the API key and email." };
  if (/api key does not exist|invalid api key/i.test(msg)) return { ok: false, message: "Mega Pay rejected the API key." };
  if (/email does not exist|invalid email/i.test(msg)) return { ok: false, message: "Mega Pay rejected the account email." };
  return { ok: false, message: `Unexpected Mega Pay answer: ${msg || JSON.stringify(j).slice(0, 120)}` };
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Player-facing text for the DB/function error codes. */
export function friendly(code: string): string {
  const c = code.split(":")[0];
  const n = code.split(":")[1];
  switch (c) {
    case "BELOW_MIN": return `The smallest deposit is KES ${n ?? "100"}.`;
    case "ABOVE_MAX": return `The largest single deposit is KES ${n ?? "150,000"}.`;
    case "INVALID_AMOUNT": return "Enter a whole number of shillings.";
    case "INVALID_PHONE": return "Enter a valid Safaricom number, e.g. 0712 345 678.";
    case "RATE_LIMITED": return "Too many deposit prompts. Wait a minute and try again.";
    case "DEPOSITS_DISABLED": return "Deposits are temporarily unavailable.";
    case "MEGAPAY_DISABLED": return "This payment method is not available right now.";
    case "ACCOUNT_BANNED": return "Your account can't make deposits. Contact support.";
    case "OPERATOR_CANNOT_DEPOSIT": return "Operator accounts can't deposit.";
    case "USER_NOT_FOUND": return "Sign in again and retry.";
    default: return "Something went wrong. Please try again.";
  }
}
