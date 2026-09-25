// payout-result — Safaricom's answers for payouts (B2C result, queue timeout, Transaction Status
// result) and for the B2C account "Test connection" (Account Balance result).
//
//   POST ?a=<attempt id>&k=result|timeout|status|status_timeout&t=<token>
//   POST ?b=<integration id>&k=balance|balance_timeout&t=<token>
//
// The token is HMAC-SHA256(attempt id) with a Vault key, only ever sent to Safaricom inside the
// callback URL; svc_payout_callback re-computes and compares it, checks the ids in the body belong
// to that attempt, and decides every money outcome. The body is only data. Safaricom gets 200 for
// anything we recorded or refused (refusals are logged) and 500 only if we could not record it.
import { cors, json } from "../_shared/megapay.ts";
import { serviceClient } from "../_shared/megapayRuntime.ts";
import { parseBalance, parseCallback } from "../_shared/daraja.ts";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const u = new URL(req.url);
  const kind = u.searchParams.get("k") ?? "";
  const token = u.searchParams.get("t") ?? "";
  const body = await req.json().catch(() => null);
  const db = serviceClient();
  const from = req.headers.get("x-forwarded-for") ?? "?";

  if (kind === "balance" || kind === "balance_timeout") {
    const id = u.searchParams.get("b") ?? "";
    if (!UUID.test(id)) return json(ACK);
    const r = kind === "balance" ? parseBalance(body) : { ok: false, message: "Safaricom did not answer the balance request in time. Test again." };
    const { data } = await db.rpc("svc_b2c_balance_result", { p_integration: id, p_token: token, p_ok: r.ok, p_message: r.message });
    if ((data as { result?: string } | null)?.result === "forbidden") console.warn(`[payout-result] refused balance callback for ${id} from ${from}`);
    return json(ACK);
  }

  const attempt = u.searchParams.get("a") ?? "";
  if (!UUID.test(attempt) || !["result", "timeout", "status", "status_timeout"].includes(kind)) return json(ACK);
  if (kind === "status_timeout") return json(ACK);   // the worker simply asks again later
  const parsed = parseCallback(kind as "result" | "timeout" | "status", body);
  const { data, error } = await db.rpc("svc_payout_callback", { p_attempt: attempt, p_token: token, p_kind: kind, p_r: parsed });
  if (error) {
    // could not record it (database hiccup): ask Safaricom to send it again; the status query is the backstop
    console.error(`[payout-result] ${kind} for ${attempt}: ${error.message}`);
    return json({ ResultCode: 1, ResultDesc: "Retry" }, 500);
  }
  const result = (data as { result?: string } | null)?.result ?? "?";
  if (result === "forbidden" || result === "mismatch") console.warn(`[payout-result] ${kind} for ${attempt}: ${result} (from ${from})`);
  else console.log(`[payout-result] ${kind} for ${attempt}: ${result}`);
  return json(ACK);
});
