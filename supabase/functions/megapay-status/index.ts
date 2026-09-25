// POST {id} with the player's session → the deposit's status. While it is pending, asks Mega Pay
// (at most every 4 s per deposit) and settles it, so the wallet updates as soon as the player pays.
// Admins may check any deposit on their brand.
import { configured, cors, json } from "../_shared/megapay.ts";
import { accountFor, ADMIN_ROLES, caller, serviceClient, settleOne, staffCanSite } from "../_shared/megapayRuntime.ts";

const FINAL = new Set(["completed", "failed", "cancelled"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const db = serviceClient();
    const me = await caller(req, db);
    if (!me) return json({ error: "AUTH_REQUIRED" }, 401);
    const { id } = await req.json().catch(() => ({})) as { id?: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "BAD_ID" }, 400);

    const { data: row } = await db.from("mpesa_stk_requests")
      .select("id, user_id, site_id, status, amount, checkout_request_id, last_checked_at, provider, mpesa_receipt_number, payment_scope, integration_id")
      .eq("id", id).eq("provider", "megapay").maybeSingle();
    const isAdmin = !!row && row.user_id !== me.id && ADMIN_ROLES.has(me.role) && await staffCanSite(db, me.id, row.site_id as string | null);
    if (!row || (row.user_id !== me.id && !isAdmin)) return json({ error: "NOT_FOUND" }, 404);

    let status = String(row.status);
    const recent = row.last_checked_at && Date.now() - Date.parse(String(row.last_checked_at)) < 4000;
    const hasTrid = !String(row.checkout_request_id).startsWith("mp-pending:");
    const cfg = !FINAL.has(status) && hasTrid && !recent ? await accountFor(db, row) : null;
    if (cfg && configured(cfg)) {
      try {
        await settleOne(db, cfg, String(row.checkout_request_id));
        const { data: again } = await db.from("mpesa_stk_requests").select("status, mpesa_receipt_number").eq("id", id).maybeSingle();
        status = String(again?.status ?? status);
        row.mpesa_receipt_number = again?.mpesa_receipt_number ?? null;
      } catch (e) {
        console.warn(`[megapay] status check failed for ${id}: ${(e as Error).message}`);
      }
    }
    return json({ id, status, amount: Number(row.amount), receipt: row.mpesa_receipt_number ?? null });
  } catch (e) {
    console.error(`[megapay] status error: ${(e as Error).message}`);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
