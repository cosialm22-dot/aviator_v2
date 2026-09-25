// Runtime glue shared by the Mega Pay edge functions: Supabase clients, auth, and settle-one.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { megapayConfig, queryStatus, type Fetch, type MegaPayConfig } from "./megapay.ts";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SERVER_MISCONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const cfgFromEnv = (): MegaPayConfig => megapayConfig((k) => Deno.env.get(k));

/** A client that runs RPCs AS the caller (their JWT), so SQL decides what they may do. */
export function asUser(req: Request): SupabaseClient | null {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SERVER_MISCONFIGURED");
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in caller (from the Authorization bearer), with role and site; null when anonymous. */
export async function caller(req: Request, db: SupabaseClient): Promise<{ id: string; role: string; site_id: string | null } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: p } = await db.from("profiles").select("id, role, site_id").eq("id", data.user.id).maybeSingle();
  if (!p) return null;
  return { id: p.id as string, role: String(p.role ?? "player"), site_id: (p.site_id as string | null) ?? null };
}

export const ADMIN_ROLES = new Set(["platform_superadmin", "platform_admin", "super_admin", "admin", "finance_admin", "support"]);

/** May this staff member act on this brand? (owner: all; platform admin: its platform; staff: own brand) */
export async function staffCanSite(db: SupabaseClient, userId: string, siteId: string | null): Promise<boolean> {
  if (!siteId) return false;
  const { data } = await db.rpc("svc_staff_can_site", { p_user: userId, p_site: siteId });
  return data === true;
}

// ── payment scopes (migration 20260930096000): which Mega Pay account a deposit uses ──────────
interface IntegrationRow { id: string; config: { email?: string; env?: string; base_url?: string }; secrets: { api_key?: string } }

/** A saved Mega Pay account → client config (same rules as the environment: a live key never on the sandbox host). */
export function cfgFromIntegration(i: IntegrationRow): MegaPayConfig {
  return megapayConfig((k) => ({
    MEGAPAY_ENV: i.config.env, MEGAPAY_API_BASE: i.config.base_url, MEGAPAY_API_KEY: i.secrets.api_key, MEGAPAY_EMAIL: i.config.email,
  } as Record<string, string | undefined>)[k]);
}

/** The account a deposit was initiated with (invariant 2: verify with the initiating account).
 *  - integration_id set → that saved account (even if since switched off)
 *  - System scope without one → the server environment (legacy behaviour)
 *  - a brand/platform scope whose account is gone → null (never another owner's account) */
export async function accountFor(db: SupabaseClient, row: { payment_scope?: string | null; integration_id?: string | null }): Promise<MegaPayConfig | null> {
  if (row.integration_id) {
    const { data } = await db.rpc("svc_integration_by_id", { p_id: row.integration_id });
    return data ? cfgFromIntegration(data as IntegrationRow) : null;
  }
  if (!row.payment_scope || row.payment_scope === "global") return cfgFromEnv();
  return null;
}

/** Ask Mega Pay about one deposit and settle it in the DB. Never trusts anything but Mega Pay's answer.
 *  If Mega Pay reports a paid amount that differs from what we asked for, nothing is credited: the
 *  deposit stays open (and surfaces in the operators' "needs attention" list). */
export async function settleOne(db: SupabaseClient, cfg: MegaPayConfig, trid: string, fetchImpl: Fetch = fetch): Promise<{ result: string; outcome: string }> {
  const s = await queryStatus(cfg, trid, fetchImpl);
  let outcome = s.outcome, providerStatus = s.providerStatus;
  if (outcome === "paid" && s.amount != null) {
    const { data: row } = await db.from("mpesa_stk_requests").select("amount").eq("checkout_request_id", trid).eq("provider", "megapay").maybeSingle();
    if (row && Math.abs(Number(row.amount) - s.amount) > 0.001) {
      console.error(`[megapay] AMOUNT MISMATCH for ${trid}: asked ${row.amount}, Mega Pay reports ${s.amount} — not credited`);
      outcome = "pending"; providerStatus = `AMOUNT_MISMATCH ${s.amount}`;
    }
  }
  const { data, error } = await db.rpc("fn_megapay_settle", {
    p_trid: trid, p_outcome: outcome, p_receipt: s.receipt, p_provider_status: providerStatus,
  });
  if (error) throw new Error(`SETTLE_FAILED:${error.message}`);
  return { result: String((data as { result?: string })?.result ?? "unknown"), outcome };
}
