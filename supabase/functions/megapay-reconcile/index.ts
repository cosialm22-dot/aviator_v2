// Settles every Mega Pay deposit whose outcome we don't know yet. Called once a minute by pg_cron
// (header x-cron-secret = MEGAPAY_CRON_SECRET) and by admins ("Check pending deposits now").
// Mega Pay's webhook goes to the account's single registered URL (invest254), so this job — not a
// callback — is what guarantees a paid deposit is credited even if the player closed the app.
import { configured, cors, json } from "../_shared/megapay.ts";
import { accountFor, ADMIN_ROLES, caller, serviceClient, settleOne, staffCanSite } from "../_shared/megapayRuntime.ts";
import type { MegaPayConfig } from "../_shared/megapay.ts";

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
  // The cron job and the System owner sweep every brand. Other staff sweep only the brands in
  // their scope (a platform admin: its platform's brands; brand staff: their own brand).
  let me: { id: string; role: string } | null = null;
  if (!cronOk) {
    me = await caller(req, db);
    if (!me || !ADMIN_ROLES.has(me.role)) return json({ error: "FORBIDDEN" }, 403);
  }
  const everyBrand = cronOk || me?.role === "platform_superadmin";

  const out = { orphans_closed: 0, marked_timeout: 0, checked: 0, credited: 0, failed: 0, pending: 0, errors: 0, no_account: 0 };
  const { data: o } = await db.rpc("fn_megapay_close_orphans");
  const { data: t } = await db.rpc("fn_megapay_mark_stale");
  if (everyBrand) { out.orphans_closed = Number(o ?? 0); out.marked_timeout = Number(t ?? 0); }
  const { data: due, error } = await db.rpc("fn_megapay_due", { p_limit: 60 });
  if (error) return json({ error: "DUE_FAILED" }, 500);
  type Due = { id: string; trid: string; site_id: string | null; payment_scope: string; integration_id: string | null };
  let rows = (due ?? []) as Due[];
  if (!everyBrand && me) {
    const allowed = new Map<string, boolean>();
    for (const s of new Set(rows.map((r) => r.site_id ?? ""))) allowed.set(s, await staffCanSite(db, me.id, s || null));
    rows = rows.filter((r) => allowed.get(r.site_id ?? "") === true);
  }
  // Each deposit is verified with the account it was made through (payment scopes, invariant 2).
  const accounts = new Map<string, MegaPayConfig | null>();
  const started = Date.now();
  for (const d of rows) {
    if (Date.now() - started > 45000) break; // stay inside one cron minute
    const key = d.integration_id ?? d.payment_scope;
    if (!accounts.has(key)) accounts.set(key, await accountFor(db, d));
    const cfg = accounts.get(key);
    if (!cfg || !configured(cfg)) { out.no_account++; continue; }
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
  if (out.checked || out.orphans_closed || out.marked_timeout || out.no_account) console.log(`[megapay] reconcile ${JSON.stringify(out)}`);
  return json(out);
});
