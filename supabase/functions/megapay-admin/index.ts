// Admin-only: {action:"status"} → how Mega Pay is configured (no secrets); {action:"test"} → a
// read-only credential check against Mega Pay (asks for a transaction that cannot exist).
import { configured, cors, json, testCredentials } from "../_shared/megapay.ts";
import { ADMIN_ROLES, caller, cfgFromEnv, serviceClient } from "../_shared/megapayRuntime.ts";

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = serviceClient();
  const me = await caller(req, db);
  if (!me || !ADMIN_ROLES.has(me.role)) return json({ error: "FORBIDDEN" }, 403);
  const { action } = await req.json().catch(() => ({})) as { action?: string };
  const cfg = cfgFromEnv();
  const summary = { configured: configured(cfg), env: cfg.env, base_url: cfg.baseUrl, email: cfg.email ? mask(cfg.email) : null, cron: !!Deno.env.get("MEGAPAY_CRON_SECRET") };
  if (action === "test") {
    if (!summary.configured) return json({ ...summary, test: { ok: false, message: "API key or email is not set." } });
    try { return json({ ...summary, test: await testCredentials(cfg) }); }
    catch (e) { return json({ ...summary, test: { ok: false, message: `Could not reach Mega Pay: ${(e as Error).message.slice(0, 120)}` } }); }
  }
  return json(summary);
});
