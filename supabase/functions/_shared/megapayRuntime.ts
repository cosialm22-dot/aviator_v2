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

export const ADMIN_ROLES = new Set(["platform_superadmin", "super_admin", "admin", "finance_admin", "support"]);

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
