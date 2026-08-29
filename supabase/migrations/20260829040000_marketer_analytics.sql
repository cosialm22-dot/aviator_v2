-- =====================================================================
-- 20260829040000_marketer_analytics.sql
-- Borrow #5 (additive analytics slice): affiliate click tracking + marketer
-- expenses + a funnel/ROI read. invest254 0073 (affiliate_clicks) + 0068
-- (marketer_expenses), adapted to aviator conventions (profiles.referral_code
-- + role='marketer', _is_admin(), admin_audit_log).
--
-- SCOPE (per decision): purely ADDITIVE analytics. Does NOT touch the existing
--   GGR-on-demand commission/payout money model. marketer_expenses is
--   INFORMATIONAL only (it is NOT netted out of payout math) — that netting is
--   a separate money-model decision (invest254 0105), deferred.
-- Additive + idempotent.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1) affiliate_clicks — append-only referral-link click log (no PII)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code         text NOT NULL,
  site_id      uuid REFERENCES public.sites(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_aff  ON public.affiliate_clicks(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_site ON public.affiliate_clicks(site_id, created_at DESC);

ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_clicks'
                 AND policyname='clicks marketer/admin read') THEN
    CREATE POLICY "clicks marketer/admin read" ON public.affiliate_clicks
      FOR SELECT TO authenticated USING (affiliate_id = auth.uid() OR public._is_admin());
  END IF;
END $$;
GRANT SELECT ON public.affiliate_clicks TO authenticated;

-- Tolerant recorder: resolves code -> active marketer, logs a click. Unknown/
-- inactive code = silent no-op. NEVER raises (fire-and-forget from /r/<code>).
CREATE OR REPLACE FUNCTION public.fn_record_affiliate_click(p_code text, p_site uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_aff uuid; v_site uuid;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN RETURN false; END IF;
  SELECT id, site_id INTO v_aff, v_site FROM public.profiles
    WHERE upper(referral_code) = upper(trim(p_code)) AND role = 'marketer'
    LIMIT 1;
  IF v_aff IS NULL THEN RETURN false; END IF;
  INSERT INTO public.affiliate_clicks(affiliate_id, code, site_id)
    VALUES (v_aff, upper(trim(p_code)), coalesce(p_site, v_site));
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;   -- click tracking must never break the landing page
END $fn$;

-- ---------------------------------------------------------------------
-- 2) marketer_expenses — admin-logged, transparent (informational only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketer_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES public.sites(id),
  marketer_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category      text NOT NULL,             -- 'promo' | 'data_bundles' | 'advance' | 'airtime' | 'other'
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketer_expenses_user ON public.marketer_expenses(marketer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketer_expenses_site ON public.marketer_expenses(site_id, created_at DESC);

ALTER TABLE public.marketer_expenses ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marketer_expenses'
                 AND policyname='expenses marketer/admin read') THEN
    CREATE POLICY "expenses marketer/admin read" ON public.marketer_expenses
      FOR SELECT TO authenticated USING (marketer_id = auth.uid() OR public._is_admin());
  END IF;
END $$;
GRANT SELECT ON public.marketer_expenses TO authenticated;

-- Admin logs an expense against a marketer (audited). Site resolved from the marketer.
CREATE OR REPLACE FUNCTION public.admin_add_marketer_expense(
    p_marketer uuid, p_category text, p_amount_cents bigint, p_note text DEFAULT NULL)
 RETURNS public.marketer_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_row public.marketer_expenses; v_site uuid; v_role text;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_category IS NULL OR length(trim(p_category)) = 0 THEN RAISE EXCEPTION 'CATEGORY_REQUIRED'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT site_id, role INTO v_site, v_role FROM public.profiles WHERE id = p_marketer;
  IF v_site IS NULL THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;
  INSERT INTO public.marketer_expenses(site_id, marketer_id, category, amount_cents, note, created_by)
    VALUES (v_site, p_marketer, trim(p_category), p_amount_cents,
            nullif(trim(coalesce(p_note,'')), ''), auth.uid())
    RETURNING * INTO v_row;
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'marketer_expense_add', 'user', p_marketer::text,
            jsonb_build_object('category', v_row.category, 'amount_cents', v_row.amount_cents, 'note', v_row.note),
            v_site);
  RETURN v_row;
END $fn$;

-- ---------------------------------------------------------------------
-- 3) fn_marketer_funnel — clicks -> registrations -> FTDs + expenses (ROI)
--    Own marketer or admin only. Informational.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_marketer_funnel(p_marketer uuid)
 RETURNS TABLE(clicks bigint, registrations bigint, ftds bigint, expenses_cents bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NOT (public._is_admin() OR auth.uid() = p_marketer) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.affiliate_clicks c WHERE c.affiliate_id = p_marketer),
    (SELECT count(*) FROM public.referrals r WHERE r.marketer_id = p_marketer),
    (SELECT count(DISTINCT r.player_id) FROM public.referrals r
       WHERE r.marketer_id = p_marketer
         AND EXISTS (SELECT 1 FROM public.transactions t
                     WHERE t.user_id = r.player_id AND t.type='deposit'
                       AND t.payment_method='mpesa' AND t.status='completed')),
    (SELECT coalesce(sum(e.amount_cents),0)::bigint FROM public.marketer_expenses e WHERE e.marketer_id = p_marketer);
END $fn$;

-- ---------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------
DO $g$
BEGIN
  -- public landing page (pre-signup) may record clicks
  REVOKE ALL ON FUNCTION public.fn_record_affiliate_click(text,uuid) FROM public;
  GRANT  EXECUTE ON FUNCTION public.fn_record_affiliate_click(text,uuid) TO anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.admin_add_marketer_expense(uuid,text,bigint,text) FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.admin_add_marketer_expense(uuid,text,bigint,text) TO authenticated, service_role;
  REVOKE ALL ON FUNCTION public.fn_marketer_funnel(uuid) FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_marketer_funnel(uuid) TO authenticated, service_role;
END
$g$;

-- realtime for live funnel counters (optional, mirrors other tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='affiliate_clicks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.affiliate_clicks;
  END IF;
END $$;

COMMIT;
-- REVERT: drop fn_marketer_funnel, admin_add_marketer_expense, fn_record_affiliate_click;
--         drop table marketer_expenses, affiliate_clicks.
