// Settles every Mega Pay deposit whose outcome we don't know yet. Called once a minute by pg_cron
// (header x-cron-secret = MEGAPAY_CRON_SECRET) and by admins ("Check pending deposits now").
// Mega Pay's webhook goes to the account's single registered URL (invest254), so this job — not a
// callback — is what guarantees a paid deposit is credited even if the player closed the app.
import { configured, cors, json } from "../_shared/megapay.ts";
import { ADMIN_ROLES, caller, cfgFromEnv, serviceClient, settleOne } from "../_shared/megapayRuntime.ts";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = serviceClient();
  const cronOk = safeEqual(req.headers.get("x-cron-secret") ?? "", Deno.env.get("MEGAPAY_CRON_SECRET") ?? "");
  // The cron job and platform owners sweep every brand. A brand's staff only sweep their own brand
  // and only see their own brand's numbers (multi-tenant isolation).
  let site: string | null = null;
  if (!cronOk) {
    const me = await caller(req, db);
    if (!me || !ADMIN_ROLES.has(me.role)) return json({ error: "FORBIDDEN" }, 403);
    if (me.role !== "platform_superadmin") {
      if (!me.site_id) return json({ error: "FORBIDDEN" }, 403);
      site = me.site_id;
    }
  }
  const cfg = cfgFromEnv();
  if (!configured(cfg)) return json({ error: "MEGAPAY_NOT_CONFIGURED" }, 503);

  const out = { orphans_closed: 0, marked_timeout: 0, checked: 0, credited: 0, failed: 0, pending: 0, errors: 0 };
  const { data: o } = await db.rpc("fn_megapay_close_orphans");
  const { data: t } = await db.rpc("fn_megapay_mark_stale");
  if (!site) { out.orphans_closed = Number(o ?? 0); out.marked_timeout = Number(t ?? 0); }
  const { data: due, error } = await db.rpc("fn_megapay_due", { p_limit: 60 });
  if (error) return json({ error: "DUE_FAILED" }, 500);
  let rows = (due ?? []) as { id: string; trid: string }[];
  if (site && rows.length) {
    const { data: mine } = await db.from("mpesa_stk_requests").select("id").eq("site_id", site).in("id", rows.map((r) => r.id));
    const ok = new Set((mine ?? []).map((r: { id: string }) => r.id));
    rows = rows.filter((r) => ok.has(r.id));
  }
  const started = Date.now();
  for (const d of rows) {
    if (Date.now() - started > 45000) break; // stay inside one cron minute
    out.checked++;
    try {
      const r = await settleOne(db, cfg, d.trid);
      if (r.result === "credited") out.credited++;
      else if (r.result === "failed") out.failed++;
      else out.pending++;
    } catch (e) {
      out.errors++;
      console.warn(`[megapay] reconcile ${d.trid}: ${(e as Error).message}`);
    }
  }
  if (out.checked || out.orphans_closed || out.marked_timeout) console.log(`[megapay] reconcile ${JSON.stringify(out)}`);
  return json(out);
});
