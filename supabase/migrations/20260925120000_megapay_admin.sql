-- Mega Pay — operator tools.
--   fn_admin_megapay_overview(site)          KPIs + health for the Deposits screen (brand-scoped)
--   fn_admin_megapay_manual_credit(id, receipt, note)
--                                            credit a deposit staff have confirmed in Mega Pay when
--                                            our side never got the answer (brand-scoped, audited,
--                                            once per deposit, once per receipt)
--   fn_admin_set_payment_settings(provider, min, max)
--                                            gateway + deposit limits — PLATFORM OWNER only, because
--                                            they apply to every brand
BEGIN;

-- Deposit rows are written ONLY by the Mega Pay / Daraja edge functions (service role). Staff could
-- previously INSERT/UPDATE/DELETE them through the API (policy admin_full_access = ALL), which would
-- let a brand admin plant a row whose amount or Mega Pay id the reconcile job would then credit.
-- Staff keep read access to their own brand's rows; changes go through audited RPCs.
DROP POLICY IF EXISTS admin_full_access ON public.mpesa_stk_requests;
DROP POLICY IF EXISTS admin_read_site ON public.mpesa_stk_requests;
CREATE POLICY admin_read_site ON public.mpesa_stk_requests FOR SELECT USING (public._can_admin_site(site_id));
REVOKE INSERT, UPDATE, DELETE ON public.mpesa_stk_requests FROM anon, authenticated;

-- Health + KPIs. Platform owner: any brand, or all brands with p_site NULL. Everyone else: own brand.
CREATE OR REPLACE FUNCTION public.fn_admin_megapay_overview(p_site uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_own uuid; v_site uuid; v_all boolean;
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi';
  k jsonb; h jsonb; v_job boolean; v_last record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role, site_id INTO v_role, v_own FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','super_admin','admin','finance_admin','support') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_role = 'platform_superadmin' THEN v_site := p_site; v_all := p_site IS NULL;
  ELSE v_site := v_own; v_all := false;
    IF p_site IS NOT NULL AND p_site IS DISTINCT FROM v_own THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  END IF;

  SELECT jsonb_build_object(
    'today_completed_count', count(*) FILTER (WHERE status = 'completed' AND completed_at >= v_today),
    'today_completed_kes',   coalesce(sum(amount) FILTER (WHERE status = 'completed' AND completed_at >= v_today), 0),
    'today_started',         count(*) FILTER (WHERE created_at >= v_today),
    'today_failed',          count(*) FILTER (WHERE status IN ('failed','cancelled') AND created_at >= v_today),
    'pending_count',         count(*) FILTER (WHERE status IN ('initiated','pending')),
    'pending_kes',           coalesce(sum(amount) FILTER (WHERE status IN ('initiated','pending')), 0),
    'timeout_count',         count(*) FILTER (WHERE status = 'timeout'),
    'timeout_kes',           coalesce(sum(amount) FILTER (WHERE status = 'timeout'), 0),
    'attention_count',       count(*) FILTER (WHERE (status = 'timeout' AND created_at < now() - interval '1 hour')
                                                 OR (status = 'failed' AND result_description = 'No Mega Pay response'
                                                     AND created_at > now() - interval '7 days')
                                                 OR (provider_status LIKE 'AMOUNT_MISMATCH%' AND status <> 'completed')),
    'week_completed_kes',    coalesce(sum(amount) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '7 days'), 0),
    'week_started',          count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
    'week_completed',        count(*) FILTER (WHERE status = 'completed' AND created_at >= now() - interval '7 days')
  ) INTO k
  FROM mpesa_stk_requests
  WHERE provider = 'megapay' AND (v_all OR site_id = v_site);

  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'megapay_reconcile' AND active) INTO v_job;
  SELECT d.status, d.start_time INTO v_last
    FROM cron.job_run_details d JOIN cron.job j USING (jobid)
   WHERE j.jobname = 'megapay_reconcile' ORDER BY d.start_time DESC LIMIT 1;
  h := jsonb_build_object(
    'provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', coalesce(public._game_setting_num('finance.min_deposit'), 100),
    'max_deposit', coalesce(public._game_setting_num('finance.max_deposit'), 150000),
    'auto_check_scheduled', v_job,
    -- Booleans only — the values never leave the vault.
    'auto_check_ready', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
                    AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'megapay_cron_secret'),
    'auto_check_last_run', v_last.start_time,
    'auto_check_last_status', v_last.status,
    'can_edit_gateway', v_role = 'platform_superadmin',
    'can_manual_credit', v_role IN ('platform_superadmin','super_admin','admin','finance_admin')
  );
  RETURN jsonb_build_object('scope', CASE WHEN v_all THEN 'all' ELSE 'site' END, 'site_id', v_site, 'kpis', k, 'health', h);
END $fn$;

-- Manual credit for a deposit Mega Pay confirms but our side never settled:
--   * 'timeout'  — still being checked automatically; staff may settle early from Mega Pay's portal
--   * 'failed' with 'No Mega Pay response' — the prompt call died mid-flight, so there is no id to
--     query; the player may still have paid.
-- Never for a deposit Mega Pay itself reported as failed, and never twice.
CREATE OR REPLACE FUNCTION public.fn_admin_megapay_manual_credit(p_id uuid, p_receipt text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_role text; r mpesa_stk_requests%ROWTYPE; v_rcpt text; v_tx uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','super_admin','admin','finance_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  v_rcpt := upper(btrim(coalesce(p_receipt, '')));
  IF v_rcpt !~ '^[A-Z0-9]{8,12}$' THEN RAISE EXCEPTION 'INVALID_RECEIPT'; END IF;
  IF length(btrim(coalesce(p_note, ''))) < 5 THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;

  SELECT * INTO r FROM mpesa_stk_requests WHERE id = p_id AND provider = 'megapay' FOR UPDATE;
  IF NOT FOUND OR NOT public._can_admin_site(r.site_id) THEN RAISE EXCEPTION 'DEPOSIT_NOT_FOUND'; END IF;
  IF r.status = 'completed' THEN RAISE EXCEPTION 'ALREADY_CREDITED'; END IF;
  IF NOT (r.status = 'timeout' OR (r.status = 'failed' AND r.result_description = 'No Mega Pay response')) THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE';
  END IF;
  -- Mega Pay reported a different paid amount: crediting our (larger) amount would be wrong.
  IF coalesce(r.provider_status, '') LIKE 'AMOUNT_MISMATCH%' THEN RAISE EXCEPTION 'AMOUNT_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM transactions WHERE reference = v_rcpt AND type = 'deposit') THEN
    RAISE EXCEPTION 'RECEIPT_ALREADY_USED';
  END IF;

  INSERT INTO transactions(user_id, type, amount, payment_method, reference, description, status, site_id)
  VALUES (r.user_id, 'deposit', r.amount, 'mpesa', v_rcpt, 'M-Pesa deposit via Mega Pay (confirmed by staff)', 'completed', r.site_id)
  RETURNING id INTO v_tx;
  UPDATE mpesa_stk_requests
     SET status = 'completed', completed_at = now(), mpesa_receipt_number = v_rcpt, credited_tx_id = v_tx,
         result_code = '0', result_description = 'Paid (confirmed by staff)'
   WHERE id = r.id;
  UPDATE profiles SET total_deposited = coalesce(total_deposited, 0) + r.amount WHERE id = r.user_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (v_uid, 'megapay_manual_credit', 'mpesa_stk_request', r.id::text,
          jsonb_build_object('user_id', r.user_id, 'amount', r.amount, 'receipt', v_rcpt, 'previous_status', r.status,
                             'note', left(btrim(p_note), 500), 'tx', v_tx), r.site_id);
  RETURN jsonb_build_object('result', 'credited', 'tx', v_tx, 'amount', r.amount);
END $fn$;

-- Gateway + limits apply to every brand → platform owner only.
CREATE OR REPLACE FUNCTION public.fn_admin_set_payment_settings(p_provider text, p_min numeric, p_max numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_old jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role = 'platform_superadmin') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_provider NOT IN ('megapay','daraja') THEN RAISE EXCEPTION 'INVALID_PROVIDER'; END IF;
  IF p_min IS NULL OR p_max IS NULL OR p_min <> trunc(p_min) OR p_max <> trunc(p_max) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_min < 10 THEN RAISE EXCEPTION 'INVALID_RANGE: minimum deposit must be at least KES 10'; END IF;
  IF p_max > 250000 THEN RAISE EXCEPTION 'INVALID_RANGE: M-Pesa allows at most KES 250,000 per transaction'; END IF;
  IF p_min > p_max THEN RAISE EXCEPTION 'INVALID_RANGE: minimum cannot exceed maximum'; END IF;

  v_old := jsonb_build_object(
    'provider', (SELECT value FROM system_settings WHERE key = 'payments.deposit_provider'),
    'min', (SELECT value FROM system_settings WHERE key = 'finance.min_deposit'),
    'max', (SELECT value FROM system_settings WHERE key = 'finance.max_deposit'));
  INSERT INTO system_settings(key, value, category, description, updated_by, updated_at) VALUES
    ('payments.deposit_provider', to_jsonb(p_provider), 'payments', 'Gateway that takes player deposits: megapay | daraja', v_uid, now()),
    ('finance.min_deposit', to_jsonb(p_min), 'finance', 'Smallest single deposit (KES)', v_uid, now()),
    ('finance.max_deposit', to_jsonb(p_max), 'finance', 'Largest single deposit (KES)', v_uid, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = v_uid, updated_at = now();
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'payment_settings_updated', 'setting', 'payments',
          jsonb_build_object('old', v_old, 'new', jsonb_build_object('provider', p_provider, 'min', p_min, 'max', p_max)));
  RETURN public.fn_public_payment_config();
END $fn$;

REVOKE ALL ON FUNCTION public.fn_admin_megapay_overview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_admin_megapay_manual_credit(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_admin_set_payment_settings(text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_megapay_overview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_megapay_manual_credit(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_payment_settings(text, numeric, numeric) TO authenticated, service_role;

COMMIT;
