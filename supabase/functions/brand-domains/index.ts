// brand-domains — Cloudflare automation for brand domains (multi-brand step 5).
//
// Actions (POST JSON {action, ...}):
//   add       {site_id, hostname, include_www}  platform tier  → admin_domain_add, then advance
//   check     {hostname}                         platform tier  → advance one domain now
//   replace   {hostname}                         platform tier  → delete the conflicting A/AAAA/CNAME records it showed, then advance
//   remove    {hostname}                         platform tier  → detach from the Worker, then delete the row
//   unassigned {}                                owner          → Worker custom domains no brand claims yet
//   adopt     {site_id, hostname}                owner          → claim one of those for a brand
//   test      {}                                 owner          → verify the stored Cloudflare account
//   sweep     {}                                 pg_cron (x-cron-secret) → advance everything due
//
// Authorisation lives in SQL: every caller action first runs an RPC AS THE CALLER (user JWT), which
// raises FORBIDDEN outside their scope; only then does the service role touch Cloudflare or write
// what it saw. The Cloudflare token comes from Vault (svc_integration_resolve) and never leaves here.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { cors, json } from "../_shared/megapay.ts";
import { serviceClient } from "../_shared/megapayRuntime.ts";
import { advance, cloudflare, detachAll, explain, lookupNs, probe, replaceConflicts, type Cloudflare, type DomainRow, TOKEN_HELP } from "../_shared/domains.ts";

type Body = { action?: string; site_id?: string; hostname?: string; include_www?: boolean };

function asUser(req: Request): SupabaseClient | null {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SERVER_MISCONFIGURED");
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
}

async function cfFor(db: SupabaseClient): Promise<{ cf: Cloudflare; id: string } | null> {
  const { data } = await db.rpc("svc_integration_resolve", { p_provider: "cloudflare", p_site: null });
  const i = data as { id: string; config: { account_id?: string; worker_service?: string }; secrets: { api_token?: string } } | null;
  if (!i?.secrets?.api_token || !i.config?.account_id) return null;
  return { id: i.id, cf: cloudflare({ token: i.secrets.api_token, accountId: i.config.account_id, service: i.config.worker_service || "aviatorv2" }) };
}

const deps = (cf: Cloudflare) => ({ cf, ns: (n: string) => lookupNs(n), probe: (h: string) => probe(h) });

async function record(db: SupabaseClient, hostname: string, patch: Record<string, unknown>) {
  const { data, error } = await db.rpc("svc_domain_record", { p_hostname: hostname, p_patch: patch });
  if (error) throw new Error(`RECORD_FAILED:${error.message}`);
  return data;
}

// A plain-words error from an RPC ("FORBIDDEN", "DOMAIN_TAKEN: x is already connected to Y").
const rpcError = (e: { message?: string } | null) => {
  const m = String(e?.message ?? "Something went wrong");
  const code = m.split(":")[0].trim();
  return { error: code, message: m.includes(":") ? m.slice(m.indexOf(":") + 1).trim() : m };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = serviceClient();
  const body = await req.json().catch(() => ({})) as Body;
  const action = body.action ?? "";

  // ── cron sweep ────────────────────────────────────────────────────────────────────────────
  if (action === "sweep") {
    const { data: ok } = await db.rpc("svc_cron_secret_ok", { p_name: "domains_cron_secret", p_value: req.headers.get("x-cron-secret") ?? "" });
    if (ok !== true) return json({ error: "FORBIDDEN" }, 403);
    const c = await cfFor(db);
    if (!c) return json({ skipped: "cloudflare not configured" });
    const { data: due } = await db.rpc("svc_domains_due", { p_limit: 25 });
    const started = Date.now(); const out: Record<string, string> = {};
    for (const d of (due ?? []) as DomainRow[]) {
      if (Date.now() - started > 45_000) break;           // stay inside the function's time limit
      try { const p = await advance(d, deps(c.cf)); await record(db, d.hostname, p); out[d.hostname] = String(p.stage); }
      catch (e) { out[d.hostname] = "error"; await record(db, d.hostname, { last_error: explain(e) }).catch(() => {}); }
    }
    return json({ swept: out });
  }

  // ── everything else runs as the signed-in caller ─────────────────────────────────────────────
  const user = asUser(req);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);

  if (action === "test" || action === "unassigned" || action === "adopt") {
    const { data: who } = await user.rpc("admin_whoami");
    if ((who as { role?: string } | null)?.role !== "platform_superadmin") return json({ error: "FORBIDDEN" }, 403);
  }
  const c = await cfFor(db);

  if (action === "test") {
    if (!c) return json({ ok: false, message: "Cloudflare is not set up: add the account ID and an API token." });
    let ok = false, message = "";
    try {
      const v = await c.cf.verifyToken();
      if (v.status !== "active") message = `The token is ${v.status}.`;
      else if (!(await c.cf.workerExists())) message = `No Worker named "${c.cf.config.service}" in this account.`;
      else { await c.cf.workerDomains({ service: c.cf.config.service }); ok = true; message = "Connected: the token works and the app's Worker was found."; }
    } catch (e) { message = explain(e); }
    await db.rpc("svc_integration_record_test", { p_id: c.id, p_ok: ok, p_message: message });
    return json({ ok, message });
  }

  if (action === "unassigned") {
    if (!c) return json({ error: "NOT_CONFIGURED", message: "Cloudflare is not set up." }, 409);
    try {
      const all = await c.cf.workerDomains({ service: c.cf.config.service });
      const { data: rows } = await db.from("site_domains").select("hostname, include_www");
      const claimed = new Set<string>();
      for (const r of (rows ?? []) as { hostname: string; include_www: boolean }[]) { claimed.add(r.hostname); if (r.include_www) claimed.add(`www.${r.hostname}`); }
      const free = all.map((w) => w.hostname).filter((h) => !claimed.has(h));
      // show apexes once: www.x.com folds into x.com when both are attached
      const hosts = free.filter((h) => !(h.startsWith("www.") && free.includes(h.slice(4))));
      return json({ hosts: hosts.map((h) => ({ hostname: h.replace(/^www\./, ""), with_www: free.includes(`www.${h.replace(/^www\./, "")}`) })) });
    } catch (e) { return json({ error: "CLOUDFLARE", message: explain(e) }, 502); }
  }

  if (action === "add" || action === "adopt") {
    const { data: row, error } = await user.rpc("admin_domain_add", {
      p_site: body.site_id, p_hostname: body.hostname ?? "", p_include_www: body.include_www ?? true, p_managed: true,
    });
    if (error) return json(rpcError(error), 400);
    const d = row as DomainRow;
    if (!c) return json({ domain: d, automation: false, message: "Saved. Cloudflare is not set up, so connect the domain by hand or ask the System owner to set up Cloudflare." });
    try { return json({ domain: await record(db, d.hostname, await advance(d, deps(c.cf))), automation: true }); }
    catch (e) { return json({ domain: await record(db, d.hostname, { stage: "error", last_error: explain(e) }), automation: true }); }
  }

  if (action === "check" || action === "replace" || action === "remove") {
    const { data: row, error } = await user.rpc("admin_domain_authorize", { p_hostname: body.hostname ?? "" });
    if (error) return json(rpcError(error), error.message?.startsWith("FORBIDDEN") ? 403 : 404);
    const d = row as DomainRow & { managed: boolean };

    if (action === "remove") {
      let detached: string[] = [];
      if (c && d.managed) {
        try { detached = await detachAll(d, c.cf); }
        catch (e) { return json({ error: "CLOUDFLARE", message: `Could not disconnect it from Cloudflare: ${explain(e)}` }, 502); }
      }
      const { error: rmErr } = await user.rpc("admin_domain_remove", { p_hostname: d.hostname });
      if (rmErr) return json(rpcError(rmErr), 400);
      return json({ removed: d.hostname, detached });
    }
    if (!d.managed) return json({ domain: d, message: "This domain was connected by hand; nothing to check in Cloudflare." });
    if (!c) return json({ error: "NOT_CONFIGURED", message: "Cloudflare is not set up." }, 409);
    try {
      const p = action === "replace" ? await replaceConflicts(d, deps(c.cf)) : await advance(d, deps(c.cf));
      return json({ domain: await record(db, d.hostname, p) });
    } catch (e) { return json({ domain: await record(db, d.hostname, { last_error: explain(e) }) }); }
  }

  return json({ error: "UNKNOWN_ACTION", help: TOKEN_HELP }, 400);
});
