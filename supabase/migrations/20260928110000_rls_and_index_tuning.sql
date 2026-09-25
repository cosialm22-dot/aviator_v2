-- ============================================================================
-- RLS + index tuning (Supabase performance advisor findings, BUGLOG #22).
--
-- RLS: policies that call auth.uid() / _is_admin() / _can_admin_site(site_id) directly are
-- evaluated once PER ROW. Wrapping caller-only expressions in a sub-select turns them into an
-- InitPlan evaluated once per query, and comparing site_id to a constant lets Postgres use the
-- site_id index. Staff "own brand" checks now compare against _staff_site() (caller's brand if
-- they are brand staff) instead of a per-row function call. Same access as before:
--   _can_admin_site(s) = platform owner OR (super_admin/admin/finance_admin/support AND s = own brand)
-- Overlapping permissive SELECT policies on the same table are merged into one.
--
-- Indexes (built/dropped CONCURRENTLY on production; plain here for fresh databases):
--   + crash_queue(round_id), free_bets(used_round_id): foreign keys checked when rounds are deleted
--     by the retention job (each deleted round scanned all of crash_queue).
--   − exact duplicates, a redundant DESC copy of game_rounds' unique round_number index, an unused
--     index on game_rounds.source, and the full game_rounds.status index (replaced by a tiny
--     partial index on the one or two live rounds). Fewer indexes = less write work per round.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public._staff_site()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT site_id FROM profiles
   WHERE id = auth.uid() AND role IN ('super_admin','admin','finance_admin','support');
$$;
REVOKE ALL ON FUNCTION public._staff_site() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._staff_site() TO authenticated, service_role;

-- staff-only tables
DROP POLICY IF EXISTS staff_read_site ON public.admin_audit_log;
CREATE POLICY staff_read_site ON public.admin_audit_log FOR SELECT TO authenticated
  USING ((SELECT public._is_platform_superadmin()) OR site_id = (SELECT public._staff_site()));
DROP POLICY IF EXISTS staff_read_site ON public.player_risk_scores;
CREATE POLICY staff_read_site ON public.player_risk_scores FOR SELECT TO authenticated
  USING ((SELECT public._is_platform_superadmin()) OR site_id = (SELECT public._staff_site()));
DROP POLICY IF EXISTS staff_read ON public.crash_queue;
CREATE POLICY staff_read ON public.crash_queue FOR SELECT TO authenticated USING ((SELECT public._is_staff()));
DROP POLICY IF EXISTS staff_read ON public.system_settings;
CREATE POLICY staff_read ON public.system_settings FOR SELECT TO authenticated USING ((SELECT public._is_staff()));

-- own rows OR brand staff: one policy each
DROP POLICY IF EXISTS staff_read_site ON public.withdrawal_requests;
DROP POLICY IF EXISTS user_read_own_withdrawals ON public.withdrawal_requests;
DROP POLICY IF EXISTS read_own_or_staff ON public.withdrawal_requests;
CREATE POLICY read_own_or_staff ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public._is_platform_superadmin()) OR site_id = (SELECT public._staff_site()));

DROP POLICY IF EXISTS admin_read_site ON public.mpesa_stk_requests;
DROP POLICY IF EXISTS user_read_own_mpesa ON public.mpesa_stk_requests;
DROP POLICY IF EXISTS "Users can view own STK requests" ON public.mpesa_stk_requests;
DROP POLICY IF EXISTS read_own_or_staff ON public.mpesa_stk_requests;
CREATE POLICY read_own_or_staff ON public.mpesa_stk_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public._is_platform_superadmin()) OR site_id = (SELECT public._staff_site()));

-- own rows: InitPlan form of auth.uid()
DO $$
DECLARE r record; q text; w text;
BEGIN
  FOR r IN SELECT tablename, policyname, qual, with_check FROM pg_policies
            WHERE schemaname = 'public'
              AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '(auth\.uid\(\)|_is_admin\(\))'
              AND (coalesce(qual,'') || coalesce(with_check,'')) !~* 'select (auth\.uid|public\._is_admin|_is_admin)'
  LOOP
    q := regexp_replace(regexp_replace(r.qual, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g'), '(^|[^.[:alnum:]_])_is_admin\(\)', '\1(SELECT public._is_admin())', 'g');
    w := regexp_replace(regexp_replace(r.with_check, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g'), '(^|[^.[:alnum:]_])_is_admin\(\)', '\1(SELECT public._is_admin())', 'g');
    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, q, w);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, q);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, w);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- indexes (production: CONCURRENTLY, outside a transaction)
CREATE INDEX IF NOT EXISTS idx_crash_queue_round_id ON public.crash_queue (round_id) WHERE round_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_free_bets_used_round_id ON public.free_bets (used_round_id) WHERE used_round_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_rounds_live ON public.game_rounds (round_number DESC) WHERE status IN ('waiting','flying');
DROP INDEX IF EXISTS public.idx_game_rounds_status;
DROP INDEX IF EXISTS public.idx_game_rounds_round_number;
DROP INDEX IF EXISTS public.idx_game_rounds_source;
DROP INDEX IF EXISTS public.idx_stk_checkout_id;
DROP INDEX IF EXISTS public.idx_mpesa_stk_checkout;
DROP INDEX IF EXISTS public.uq_mpesa_deposit_reference;
DROP INDEX IF EXISTS public.idx_withdrawals_user;
