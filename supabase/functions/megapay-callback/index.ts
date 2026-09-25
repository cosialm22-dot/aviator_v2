// Optional webhook endpoint (for a Mega Pay account whose webhook points here). The body is NEVER
// trusted: we take only the transaction id and ask Mega Pay for the real status before crediting.
// Unknown ids are acknowledged with 200 so Mega Pay does not retry forever.
import { configured, cors, json } from "../_shared/megapay.ts";
import { accountFor, serviceClient, settleOne } from "../_shared/megapayRuntime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const trid = String(b.transaction_request_id ?? b.TransactionRequestID ?? b.transactionRequestId ?? b.TransactionID ?? b.transaction_id ?? "").trim();
  if (!trid) return json({ error: "BAD_CALLBACK" }, 400);
  const db = serviceClient();
  // Verify with the account the deposit was made through (never "whatever is configured now").
  const { data: row } = await db.from("mpesa_stk_requests").select("payment_scope, integration_id")
    .eq("provider", "megapay").eq("checkout_request_id", trid).maybeSingle();
  if (!row) return json({ received: true, result: "unknown" });
  const cfg = await accountFor(db, row);
  if (!cfg || !configured(cfg)) return json({ received: true, result: "deferred" });
  try {
    const r = await settleOne(db, cfg, trid);
    return json({ received: true, result: r.result });
  } catch (e) {
    console.warn(`[megapay] callback ${trid}: ${(e as Error).message}`);
    return json({ received: true, result: "deferred" }); // the reconcile job settles it
  }
});
