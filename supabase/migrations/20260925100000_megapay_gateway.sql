-- =====================================================================
-- 20260925100000_megapay_gateway.sql — Mega Pay (megapay.co.ke) M-Pesa deposits
--
-- The same Mega Pay merchant account as invest254 collects player deposits here. Mega Pay sends
-- its webhook to the ONE URL registered on that account (invest254's API), so this platform
-- never relies on a callback: every deposit is settled by asking Mega Pay for the transaction's
-- status, server to server (player polling + a once-a-minute reconcile job + admin "check now").
--
-- Money rules (e2e: supabase/tests/megapay_gateway_e2e.py):
--   1. A deposit row is created BEFORE Mega Pay is called, so a prompt can never be sent for a
--      deposit we have no record of.
--   2. The credited amount is ALWAYS the amount stored at initiation — never a figure from Mega Pay.
--   3. Settlement locks the row (FOR UPDATE) and credits at most once; a unique index on the deposit
--      reference is the backstop. `completed` and `failed` are final; `timeout` is not (a late
--      payment still credits).
--   4. Only the service_role (edge functions) can create, attach or settle deposits.
--   5. Players read only their own deposits; brand admins read their brand's (existing RLS).
-- Additive + idempotent.
-- =====================================================================
BEGIN;

-- ── 1) Provider + reconcile bookkeeping on the existing request table ──
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'daraja';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mpesa_stk_requests_provider_chk') THEN
    ALTER TABLE public.mpesa_stk_requests ADD CONSTRAINT mpesa_stk_requests_provider_chk CHECK (provider IN ('daraja','megapay'));
  END IF;
END $$;
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS check_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS credited_tx_id uuid REFERENCES public.transactions(id);
ALTER TABLE public.mpesa_stk_requests ADD COLUMN IF NOT EXISTS reference text;
CREATE INDEX IF NOT EXISTS idx_stk_provider_status ON public.mpesa_stk_requests(provider, status, created_at);

-- Backstop against a double credit: one completed M-Pesa deposit per provider reference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_deposit_reference ON public.transactions(reference)
  WHERE type = 'deposit' AND payment_method = 'mpesa' AND reference IS NOT NULL;

-- ── 2) Which gateway takes deposits + limits (public read) ──
INSERT INTO public.system_settings(key, value, category, description) VALUES
  ('payments.deposit_provider', '"megapay"'::jsonb, 'payments', 'Gateway that takes player deposits: megapay | daraja'),
  ('finance.min_deposit', '100'::jsonb, 'finance', 'Smallest deposit in KES'),
  ('finance.max_deposit', '150000'::jsonb, 'finance', 'Largest single deposit in KES')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_public_payment_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'deposit_provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', coalesce(public._game_setting_num('finance.min_deposit'), 100),
    'max_deposit', coalesce(public._game_setting_num('finance.max_deposit'), 150000),
    'min_withdrawal', coalesce(public._game_setting_num('finance.min_withdrawal'), 100)
  );
$fn$;

-- ── 3) Begin: validate + record the deposit BEFORE calling Mega Pay ──
CREATE OR REPLACE FUNCTION public.fn_megapay_begin(p_user uuid, p_phone text, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_prof profiles%ROWTYPE; v_min numeric; v_max numeric; v_cfg jsonb; v_id uuid; v_ref text; v_recent int;
BEGIN
  SELECT * INTO v_prof FROM profiles WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF coalesce(v_prof.is_banned, false) THEN RAISE EXCEPTION 'ACCOUNT_BANNED'; END IF;
  IF v_prof.role IN ('admin','super_admin','platform_superadmin','finance_admin','support') THEN RAISE EXCEPTION 'OPERATOR_CANNOT_DEPOSIT'; END IF;

  BEGIN v_cfg := public.fn_platform_get_global_config(); EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
  IF v_cfg IS NOT NULL AND (v_cfg->>'deposits_enabled') = 'false' THEN RAISE EXCEPTION 'DEPOSITS_DISABLED'; END IF;
  IF coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay') <> 'megapay' THEN
    RAISE EXCEPTION 'MEGAPAY_DISABLED';
  END IF;

  IF p_amount IS NULL OR p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  v_min := coalesce(public._game_setting_num('finance.min_deposit'), 100);
  v_max := coalesce(public._game_setting_num('finance.max_deposit'), 150000);
  IF p_amount < v_min THEN RAISE EXCEPTION 'BELOW_MIN:%', v_min; END IF;
  IF p_amount > v_max THEN RAISE EXCEPTION 'ABOVE_MAX:%', v_max; END IF;
  IF p_phone IS NULL OR p_phone !~ '^254(7|1)[0-9]{8}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;

  -- Throttle: at most 3 prompts per player per 2 minutes (each one rings the player's phone).
  SELECT count(*) INTO v_recent FROM mpesa_stk_requests
   WHERE user_id = p_user AND provider = 'megapay' AND created_at > now() - interval '2 minutes';
  IF v_recent >= 3 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;

  -- The "Account no." the payer sees: the brand name in capitals (as invest254 does).
  SELECT upper(regexp_replace(coalesce(s.wordmark_text, s.name, 'AVIATOR'), '[^A-Za-z0-9]', '', 'g')) INTO v_ref
    FROM sites s WHERE s.id = v_prof.site_id;

  v_id := gen_random_uuid();
  INSERT INTO mpesa_stk_requests(id, user_id, phone_number, amount, checkout_request_id, status, provider, site_id, reference)
  VALUES (v_id, p_user, p_phone, p_amount, 'mp-pending:' || v_id, 'initiated', 'megapay', v_prof.site_id, coalesce(nullif(v_ref, ''), 'AVIATOR'));
  RETURN jsonb_build_object('id', v_id, 'reference', coalesce(nullif(v_ref, ''), 'AVIATOR'));
END $fn$;

-- ── 4) Attach Mega Pay's transaction_request_id (or record that the prompt failed) ──
CREATE OR REPLACE FUNCTION public.fn_megapay_attach(p_id uuid, p_trid text, p_merchant text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_trid IS NULL OR btrim(p_trid) = '' THEN RAISE EXCEPTION 'INVALID_TRID'; END IF;
  UPDATE mpesa_stk_requests
     SET checkout_request_id = btrim(p_trid), merchant_request_id = p_merchant, status = 'pending'
   WHERE id = p_id AND provider = 'megapay' AND status = 'initiated';
  IF NOT FOUND THEN RAISE EXCEPTION 'DEPOSIT_NOT_FOUND'; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_megapay_initiation_failed(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE mpesa_stk_requests
     SET status = 'failed', result_description = left(coalesce(p_reason, 'initiation failed'), 500), completed_at = now()
   WHERE id = p_id AND provider = 'megapay' AND status = 'initiated';
END $fn$;

-- ── 5) Settle from Mega Pay's authoritative status. Idempotent; credits at most once. ──
-- p_outcome: 'paid' | 'failed' | 'pending'
CREATE OR REPLACE FUNCTION public.fn_megapay_settle(p_trid text, p_outcome text, p_receipt text, p_provider_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r mpesa_stk_requests%ROWTYPE; v_tx uuid; v_ref text;
BEGIN
  IF p_outcome NOT IN ('paid','failed','pending') THEN RAISE EXCEPTION 'INVALID_OUTCOME'; END IF;
  SELECT * INTO r FROM mpesa_stk_requests WHERE checkout_request_id = p_trid AND provider = 'megapay' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF r.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('result', 'already_' || r.status, 'id', r.id);
  END IF;

  IF p_outcome = 'pending' THEN
    UPDATE mpesa_stk_requests SET last_checked_at = now(), check_count = check_count + 1,
           provider_status = left(p_provider_status, 60) WHERE id = r.id;
    RETURN jsonb_build_object('result', 'pending', 'id', r.id);
  END IF;

  IF p_outcome = 'failed' THEN
    UPDATE mpesa_stk_requests SET status = 'failed', completed_at = now(), last_checked_at = now(),
           check_count = check_count + 1, provider_status = left(p_provider_status, 60),
           result_description = 'Mega Pay: ' || coalesce(p_provider_status, 'failed') WHERE id = r.id;
    RETURN jsonb_build_object('result', 'failed', 'id', r.id);
  END IF;

  -- paid: credit the amount recorded at initiation (the deposit trigger does the wallet move).
  v_ref := coalesce(nullif(btrim(p_receipt), ''), 'MP-' || p_trid);
  INSERT INTO transactions(user_id, type, amount, payment_method, reference, description, status, site_id)
  VALUES (r.user_id, 'deposit', r.amount, 'mpesa', v_ref, 'M-Pesa deposit via Mega Pay', 'completed', r.site_id)
  RETURNING id INTO v_tx;
  UPDATE mpesa_stk_requests SET status = 'completed', completed_at = now(), last_checked_at = now(),
         check_count = check_count + 1, provider_status = left(p_provider_status, 60),
         mpesa_receipt_number = nullif(btrim(p_receipt), ''), credited_tx_id = v_tx, result_code = '0',
         result_description = 'Paid' WHERE id = r.id;
  UPDATE profiles SET total_deposited = coalesce(total_deposited, 0) + r.amount, last_active_at = now() WHERE id = r.user_id;
  RETURN jsonb_build_object('result', 'credited', 'id', r.id, 'amount', r.amount, 'tx', v_tx);
END $fn$;

-- ── 6) Deposits the reconcile job should re-check (oldest first) ──
CREATE OR REPLACE FUNCTION public.fn_megapay_due(p_limit int DEFAULT 50)
RETURNS TABLE(id uuid, trid text, created_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT r.id, r.checkout_request_id, r.created_at FROM mpesa_stk_requests r
   WHERE r.provider = 'megapay' AND r.status IN ('pending', 'timeout')
     AND r.created_at > now() - interval '3 days'
     AND (r.last_checked_at IS NULL OR r.last_checked_at < now() - interval '20 seconds')
   ORDER BY r.created_at LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

-- After 15 minutes without a final answer a deposit shows as "timeout" to the player; the job keeps
-- checking it for 3 days, and a late payment still credits.
CREATE OR REPLACE FUNCTION public.fn_megapay_mark_stale()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH u AS (
    UPDATE mpesa_stk_requests SET status = 'timeout'
     WHERE provider = 'megapay' AND status = 'pending' AND created_at < now() - interval '15 minutes'
    RETURNING 1)
  SELECT count(*)::int FROM u;
$fn$;
-- Initiated rows that never got a Mega Pay id (edge function crashed mid-call) are closed after 10 min.
CREATE OR REPLACE FUNCTION public.fn_megapay_close_orphans()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH u AS (
    UPDATE mpesa_stk_requests SET status = 'failed', completed_at = now(), result_description = 'No Mega Pay response'
     WHERE provider = 'megapay' AND status = 'initiated' AND created_at < now() - interval '10 minutes'
    RETURNING 1)
  SELECT count(*)::int FROM u;
$fn$;

-- ── 7) Grants: the money functions are service_role only ──
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fn_megapay_begin(uuid,text,numeric)', 'fn_megapay_attach(uuid,text,text)',
    'fn_megapay_initiation_failed(uuid,text)', 'fn_megapay_settle(text,text,text,text)',
    'fn_megapay_due(integer)', 'fn_megapay_mark_stale()', 'fn_megapay_close_orphans()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $g$;
REVOKE ALL ON FUNCTION public.fn_public_payment_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_payment_config() TO anon, authenticated, service_role;

COMMIT;
