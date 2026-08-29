-- =====================================================================
-- 20260829080000_disable_support_client.sql
-- Disable the client-facing support functionality (per operator request).
-- There is NO frontend support widget; the only user-callable surface is the
-- support RPCs granted to `authenticated`. Revoking those makes any client call
-- fail with permission-denied, disabling support end-to-end for users.
--
-- Non-destructive + fully reversible: the support_conversations / support_messages
-- / kb_chunks tables and the service_role functions (fn_support_log / fn_kb_search)
-- are untouched. Re-enable later with:
--   GRANT EXECUTE ON FUNCTION public.fn_support_start(uuid,text,uuid)   TO authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.fn_support_send(uuid,text)         TO authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.fn_support_escalate(uuid,text,text) TO authenticated, service_role;
-- =====================================================================
BEGIN;

REVOKE EXECUTE ON FUNCTION public.fn_support_start(uuid,text,uuid)    FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.fn_support_send(uuid,text)          FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.fn_support_escalate(uuid,text,text) FROM authenticated, anon;

COMMIT;
