// Staff: how Mega Pay is set up for a brand or a payment scope, and a read-only credential test
// (asks Mega Pay for a transaction that cannot exist: never moves money, never rings a phone).
//   {action:"status", site_id?}                 → the brand's payment owner and its account (masked);
//                                                  without site_id: the System's account
//   {action:"test", site_id?}                   → test that account (staff of the brand)
//   {action:"test", scope_kind, scope_id}       → test the account saved at exactly this scope
//                                                  (whoever may manage that scope; recorded on it)
// Accounts come from payment scopes (migration 20260930096000): brand → platform → System; the
// System falls back to the server environment when no account is saved.
import { configured, cors, json, testCredentials, type MegaPayConfig } from "../_shared/megapay.ts";
import { ADMIN_ROLES, asUser, caller, cfgFromEnv, cfgFromIntegration, serviceClient, staffCanSite } from "../_shared/megapayRuntime.ts";

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");
type Row = { id: string; enabled: boolean; config: { email?: string; env?: string; base_url?: string }; secrets: { api_key?: string } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = serviceClient();
  const me = await caller(req, db);
  if (!me || !ADMIN_ROLES.has(me.role)) return json({ error: "FORBIDDEN" }, 403);
  const body = await req.json().catch(() => ({})) as { action?: string; site_id?: string; scope_kind?: string; scope_id?: string | null };

  // Which account?
  let kind: string, id: string | null, ownerName = "System";
  if (body.scope_kind) {
    kind = body.scope_kind; id = body.scope_id ?? null;
    // SQL decides who may manage a scope (owner; the platform's admins; the brand's platform admin)
    const user = asUser(req);
    const { error } = user ? await user.rpc("admin_integrations", { p_scope_kind: kind, p_scope_id: id }) : { error: { message: "FORBIDDEN" } };
    if (error) return json({ error: "FORBIDDEN" }, 403);
  } else if (body.site_id) {
    if (!(await staffCanSite(db, me.id, body.site_id))) return json({ error: "FORBIDDEN" }, 403);
    const { data: o } = await db.rpc("fn_payment_owner", { p_site: body.site_id });
    const owner = o as { kind: string; id: string | null; name: string };
    kind = owner.kind; id = owner.id; ownerName = owner.name;
  } else {
    kind = "global"; id = null;
  }

  const { data: saved } = await db.rpc("svc_integration_at", { p_provider: "megapay", p_kind: kind, p_id: id });
  const row = saved as Row | null;
  let cfg: MegaPayConfig | null = null, source: "saved" | "env" | "missing" = "missing";
  if (row && row.enabled && row.secrets.api_key && row.config.email) { cfg = cfgFromIntegration(row); source = "saved"; }
  else if (kind === "global") { cfg = cfgFromEnv(); source = configured(cfg) ? "env" : "missing"; }
  // an explicit scope test also tests a saved-but-switched-off draft
  if (!cfg && row && body.scope_kind && row.secrets.api_key && row.config.email) { cfg = cfgFromIntegration(row); source = "saved"; }

  const summary = {
    configured: !!cfg && configured(cfg), source, scope: kind, owner: ownerName,
    env: cfg?.env ?? null, base_url: cfg?.baseUrl ?? null, email: cfg?.email ? mask(cfg.email) : null,
    cron: !!Deno.env.get("MEGAPAY_CRON_SECRET"),
  };
  if (body.action === "test") {
    if (!cfg || !summary.configured) return json({ ...summary, test: { ok: false, message: "API key or email is not set." } });
    let test: { ok: boolean; message: string };
    try { test = await testCredentials(cfg); }
    catch (e) { test = { ok: false, message: `Could not reach Mega Pay: ${(e as Error).message.slice(0, 120)}` }; }
    if (row && source === "saved") await db.rpc("svc_integration_record_test", { p_id: row.id, p_ok: test.ok, p_message: test.message });
    return json({ ...summary, test });
  }
  return json(summary);
});
