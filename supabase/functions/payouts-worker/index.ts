// payouts-worker — sends approved withdrawals by M-Pesa B2C and chases unanswered ones.
//
//   {action:"run"}   pg_cron every minute + an immediate wake-up whenever a withdrawal is
//                    approved (x-cron-secret, checked against Vault):
//                      1. svc_payout_claim: approved withdrawals → one attempt each, written
//                         BEFORE sending (write-ahead; SKIP LOCKED, so never twice)
//                      2. B2C v3 request per attempt; the synchronous answer is recorded
//                         (accepted / refused → staff / no answer → unknown, never resent)
//                      3. svc_payouts_unresolved: attempts with no result after 3 min get a
//                         Transaction Status query; after 60 min they go to staff
//   {action:"test", scope_kind, scope_id}   staff who may manage that scope: sign in to Daraja
//                    and ask for the account balance; the answer (payout-result, k=balance)
//                    marks the account tested and shows the float.
//
// Accounts come from Vault through the integrations table (payment scopes). Every money decision
// is in SQL (migration 20260930097000); this function only talks to Safaricom.
import { cors, json } from "../_shared/megapay.ts";
import { asUser, serviceClient } from "../_shared/megapayRuntime.ts";
import { daraja, darajaConfig, DarajaError, missing, type Daraja } from "../_shared/daraja.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const RESULT_FN = "payout-result";
function callbackUrl(params: Record<string, string>): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/${RESULT_FN}?${new URLSearchParams(params)}`;
}

async function clientFor(db: SupabaseClient, cache: Map<string, Daraja | null>, integrationId: string | null): Promise<Daraja | null> {
  if (!integrationId) return null;
  if (cache.has(integrationId)) return cache.get(integrationId)!;
  const { data } = await db.rpc("svc_integration_by_id", { p_id: integrationId });
  const cfg = data ? darajaConfig(data as { config: Record<string, unknown>; secrets: Record<string, unknown> }) : null;
  const c = cfg && missing(cfg).length === 0 ? daraja(cfg) : null;
  cache.set(integrationId, c);
  return c;
}

type Claimed = { attempt_id: string; token: string; withdrawal_id: string; amount: number; phone: string; integration_id: string; site_id: string };
type Unresolved = { attempt_id: string; token: string; integration_id: string | null; transaction_id: string | null };

async function run(db: SupabaseClient) {
  const started = Date.now();
  const cache = new Map<string, Daraja | null>();
  const out = { sent: 0, refused: 0, unknown: 0, status_queries: 0, status_errors: 0 };

  // 1 + 2: claim and send
  const { data: claimed, error } = await db.rpc("svc_payout_claim", { p_limit: 10 });
  if (error) throw new Error(`CLAIM_FAILED:${error.message}`);
  for (const c of (claimed ?? []) as Claimed[]) {
    const client = await clientFor(db, cache, c.integration_id);
    if (!client) {
      await db.rpc("svc_payout_sent", { p_attempt: c.attempt_id, p_accepted: false, p_conversation_id: null, p_code: "NO_ACCOUNT", p_desc: "The B2C account is missing or incomplete" });
      out.refused++; continue;
    }
    try {
      const r = await client.b2c({
        originatorId: c.attempt_id, amountKes: Number(c.amount), msisdn: c.phone, remarks: "Withdrawal", occasion: `W-${c.withdrawal_id.slice(0, 8)}`,
        resultUrl: callbackUrl({ a: c.attempt_id, k: "result", t: c.token }),
        timeoutUrl: callbackUrl({ a: c.attempt_id, k: "timeout", t: c.token }),
      });
      await db.rpc("svc_payout_sent", { p_attempt: c.attempt_id, p_accepted: true, p_conversation_id: r.conversationId, p_code: r.code, p_desc: r.desc });
      out.sent++;
    } catch (e) {
      const d = e instanceof DarajaError ? e : new DarajaError(String((e as Error).message), false);
      if (d.definite) {
        await db.rpc("svc_payout_sent", { p_attempt: c.attempt_id, p_accepted: false, p_conversation_id: null, p_code: d.code, p_desc: d.message });
        out.refused++;
      } else {
        await db.rpc("svc_payout_unknown", { p_attempt: c.attempt_id, p_error: d.message });
        out.unknown++;
      }
    }
  }

  // 3: chase attempts Safaricom has not answered
  if (Date.now() - started < 40_000) {
    const { data: open } = await db.rpc("svc_payouts_unresolved", { p_limit: 20 });
    for (const u of (open ?? []) as Unresolved[]) {
      if (Date.now() - started > 45_000) break;
      const client = await clientFor(db, cache, u.integration_id);
      if (!client) { out.status_errors++; continue; }
      try {
        await client.transactionStatus({
          originatorId: u.attempt_id, transactionId: u.transaction_id,
          resultUrl: callbackUrl({ a: u.attempt_id, k: "status", t: u.token }),
          timeoutUrl: callbackUrl({ a: u.attempt_id, k: "status_timeout", t: u.token }),
        });
        out.status_queries++;
      } catch (e) {
        out.status_errors++;
        console.warn(`[payouts] status query ${u.attempt_id}: ${(e as Error).message}`);
      }
    }
  }
  if (out.sent || out.refused || out.unknown || out.status_queries || out.status_errors) console.log(`[payouts] ${JSON.stringify(out)}`);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = serviceClient();
  const body = await req.json().catch(() => ({})) as { action?: string; scope_kind?: string; scope_id?: string | null };

  if (body.action === "run") {
    const { data: ok } = await db.rpc("svc_cron_secret_ok", { p_name: "payouts_cron_secret", p_value: req.headers.get("x-cron-secret") ?? "" });
    if (ok !== true) return json({ error: "FORBIDDEN" }, 403);
    try { return json(await run(db)); }
    catch (e) { console.error(`[payouts] run failed: ${(e as Error).message}`); return json({ error: "RUN_FAILED" }, 500); }
  }

  if (body.action === "test") {
    const user = asUser(req);
    if (!user || !body.scope_kind) return json({ error: "FORBIDDEN" }, 403);
    // SQL decides who may manage this scope
    const { error: authErr } = await user.rpc("admin_integrations", { p_scope_kind: body.scope_kind, p_scope_id: body.scope_id ?? null });
    if (authErr) return json({ error: "FORBIDDEN" }, 403);
    const { data: row } = await db.rpc("svc_integration_at", { p_provider: "mpesa_b2c", p_kind: body.scope_kind, p_id: body.scope_id ?? null });
    if (!row) return json({ ok: false, message: "Save the B2C account first." });
    const i = row as { id: string; config: Record<string, unknown>; secrets: Record<string, unknown> };
    const cfg = darajaConfig(i);
    const miss = missing(cfg);
    const record = (ok: boolean, message: string) => db.rpc("svc_integration_record_test", { p_id: i.id, p_ok: ok, p_message: message });
    if (miss.length) { await record(false, `Missing: ${miss.join(", ")}.`); return json({ ok: false, message: `Missing: ${miss.join(", ")}.` }); }
    const client = daraja(cfg);
    try {
      await client.signIn();
      const { data: tok } = await db.rpc("svc_payout_token", { p_ref: `balance:${i.id}` });
      await client.accountBalance({
        resultUrl: callbackUrl({ b: i.id, k: "balance", t: String(tok) }),
        timeoutUrl: callbackUrl({ b: i.id, k: "balance_timeout", t: String(tok) }),
      });
      // the result (test_ok + balance) is recorded when Safaricom's balance answer arrives (usually
      // seconds); the previous result stays in force meanwhile so payouts are not interrupted
      return json({ ok: true, pending: true, message: "Signed in. Waiting for Safaricom to confirm the initiator and send the balance…" });
    } catch (e) {
      const m = e instanceof DarajaError ? e.message : `Could not reach Safaricom: ${(e as Error).message}`;
      await record(false, m);
      return json({ ok: false, message: m });
    }
  }

  return json({ error: "UNKNOWN_ACTION" }, 400);
});
