-- =====================================================================
-- 20260829090000_disable_support_kb.sql
-- Flip OFF the remaining support/KB back-office surface (per request).
-- The client-facing RPCs were already revoked (20260829080000); this revokes
-- the service_role-only functions too, so the entire support + KB feature is
-- dormant (no role can invoke it except the DB owner for maintenance).
--
-- Non-destructive + fully reversible: support_conversations / support_messages /
-- kb_chunks tables and all data are untouched. Re-enable with:
--   GRANT EXECUTE ON FUNCTION public.fn_kb_search(uuid,vector,int)                 TO service_role;
--   GRANT EXECUTE ON FUNCTION public.fn_support_log(uuid,text,text,jsonb,real)     TO service_role;
--   (and the client RPCs per 20260829080000's header, if desired.)
-- =====================================================================
BEGIN;

-- Client-facing were already revoked from authenticated/anon (20260829080000);
-- now revoke service_role too so the ENTIRE support + KB surface is dormant.
REVOKE EXECUTE ON FUNCTION public.fn_kb_search(uuid,vector,int)             FROM service_role, authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_support_log(uuid,text,text,jsonb,real) FROM service_role, authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_support_start(uuid,text,uuid)          FROM service_role, authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_support_send(uuid,text)                FROM service_role, authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_support_escalate(uuid,text,text)       FROM service_role, authenticated, anon, public;

COMMIT;
