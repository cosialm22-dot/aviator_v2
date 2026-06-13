-- ============================================================================
-- AVIATOR V2 - MARKETING ADMIN MODULE EXPANSION
-- ============================================================================
-- Expands the admin "Marketing" module into a comprehensive affiliate +
-- promotions management surface, on top of the live database.
--
-- This migration is the single source of truth for the marketing/affiliate
-- backend on the LIVE database. It was authored AFTER introspecting the live
-- schema (not the divergent repo migration history): every external object it
-- depends on (profiles, bets[amount,winnings,is_bot], transactions[type,
-- payment_method,status], wallets, withdrawal_requests[auto_approved],
-- admin_audit_log, _is_admin/_is_super_admin, _game_setting_num, pgcrypto in
-- the `extensions` schema) was verified to exist before writing.
--
-- AUTHORIZATION MODEL (consistent with the existing Phase-1 lockdown):
--   Every privileged path is a SECURITY DEFINER RPC that self-checks the
--   caller via _is_marketer()/_is_admin()/_is_super_admin(). New tables are
--   RLS-locked (FORCE) with NO client policies and no client grants; clients
--   never touch them directly. Every write is recorded to admin_audit_log.
--
-- IDEMPOTENCY: this file is applied statement-by-statement through the
--   PostgreSQL MCP (which forbids multi-command scripts), so it CANNOT rely on
--   a wrapping BEGIN/COMMIT. Every statement is therefore individually
--   idempotent (CREATE OR REPLACE / IF NOT EXISTS / DROP ... IF EXISTS) and
--   safe to re-run. Statements are separated by a `--##` sentinel line.
-- ============================================================================

-- ============================================================================
-- PART 1 - RBAC: make `marketer` a first-class role (required for everything
--           below). Normalise existing data BEFORE constraining so it cannot
--           fail on legacy rows.
-- ============================================================================
UPDATE public.profiles
   SET role = CASE
     WHEN role IN ('player','admin','super_admin','marketer') THEN role
     WHEN role IN ('marketing','marketing_manager','affiliate','affiliate_manager') THEN 'marketer'
     ELSE 'player'
   END
 WHERE role IS NULL OR role NOT IN ('player','admin','super_admin','marketer');
--##
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'player';
--##
UPDATE public.profiles SET role = 'player' WHERE role IS NULL;
--##
ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;
--##
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
--##
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('player','admin','super_admin','marketer'));
--##
-- admin_set_role: accept the four roles + protect the super_admin floor.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_old text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_role NOT IN ('player','admin','super_admin','marketer') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  SELECT role INTO v_old FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_old = p_role THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false);
  END IF;

  IF v_old = 'super_admin' AND p_role <> 'super_admin'
     AND (SELECT count(*) FROM profiles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN';
  END IF;

  UPDATE profiles SET role = p_role WHERE id = p_user_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'role_changed', 'user', p_user_id::text, jsonb_build_object('old', v_old, 'new', p_role));

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END $fn$;
--##

-- ============================================================================
-- PART 2 - AFFILIATE FOUNDATION (referrals, commission ledger, config, RPCs).
-- ============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;
--##
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id);
--##
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code) WHERE referral_code IS NOT NULL;
--##
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles (referred_by);
--##
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id            uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified')),
  first_deposit_amount numeric,
  qualified_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self CHECK (marketer_id <> player_id)
);
--##
CREATE INDEX IF NOT EXISTS idx_referrals_marketer ON public.referrals (marketer_id);
--##
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals (status);
--##
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
--##
ALTER TABLE public.referrals FORCE ROW LEVEL SECURITY;
--##
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount           numeric NOT NULL CHECK (amount > 0),
  phone_number     text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','paid','rejected')),
  reviewed_by      uuid REFERENCES public.profiles(id),
  review_note      text,
  rejection_reason text,
  mpesa_receipt    text,
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
--##
CREATE INDEX IF NOT EXISTS idx_commission_payouts_marketer ON public.commission_payouts (marketer_id);
--##
CREATE INDEX IF NOT EXISTS idx_commission_payouts_status ON public.commission_payouts (status);
--##
CREATE UNIQUE INDEX IF NOT EXISTS commission_payouts_one_pending
  ON public.commission_payouts (marketer_id) WHERE status = 'pending';
--##
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
--##
ALTER TABLE public.commission_payouts FORCE ROW LEVEL SECURITY;
--##
CREATE TABLE IF NOT EXISTS public.marketing_config (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  commission_rate        numeric NOT NULL DEFAULT 0.10 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  qualifying_deposit_min numeric NOT NULL DEFAULT 50 CHECK (qualifying_deposit_min >= 0),
  updated_by             uuid REFERENCES public.profiles(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
--##
INSERT INTO public.marketing_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
--##
ALTER TABLE public.marketing_config ENABLE ROW LEVEL SECURITY;
--##
ALTER TABLE public.marketing_config FORCE ROW LEVEL SECURITY;
--##
CREATE OR REPLACE FUNCTION public._is_marketer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'marketer');
$fn$;
--##
CREATE OR REPLACE FUNCTION public._ensure_referral_code(p_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_code text; v_existing text; v_try int := 0;
BEGIN
  SELECT referral_code INTO v_existing FROM profiles WHERE id = p_user;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  LOOP
    v_try := v_try + 1;
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
    BEGIN
      UPDATE profiles SET referral_code = v_code WHERE id = p_user;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 10 THEN RAISE EXCEPTION 'REFERRAL_CODE_GENERATION_FAILED'; END IF;
    END;
  END LOOP;
END $fn$;
--##
CREATE OR REPLACE FUNCTION public._marketer_ggr(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT greatest(coalesce(sum(b.amount), 0) - coalesce(sum(b.winnings), 0), 0)
  FROM referrals r
  JOIN bets b ON b.user_id = r.player_id AND b.is_bot = false
  WHERE r.marketer_id = p_marketer AND r.status = 'qualified';
$fn$;
--##
CREATE OR REPLACE FUNCTION public._marketer_commission_earned(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round((SELECT commission_rate FROM marketing_config WHERE id = true) * public._marketer_ggr(p_marketer), 2);
$fn$;
--##
CREATE OR REPLACE FUNCTION public.marketer_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_rate numeric;
  v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric; v_committed numeric;
  v_paid numeric; v_pending numeric; v_approved numeric;
  v_payouts jsonb;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT referral_code INTO v_code FROM profiles WHERE id = v_uid;
  IF v_code IS NULL THEN v_code := _ensure_referral_code(v_uid); END IF;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  SELECT count(*), count(*) FILTER (WHERE status = 'qualified') INTO v_referred, v_qualified
  FROM referrals WHERE marketer_id = v_uid;
  v_ggr := _marketer_ggr(v_uid);
  v_earned := _marketer_commission_earned(v_uid);
  SELECT coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0),
         coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
         coalesce(sum(amount) FILTER (WHERE status = 'approved'), 0)
    INTO v_paid, v_pending, v_approved
  FROM commission_payouts WHERE marketer_id = v_uid;
  v_committed := v_paid + v_pending + v_approved;
  SELECT coalesce(jsonb_agg(p ORDER BY p.created_at DESC), '[]'::jsonb) INTO v_payouts
  FROM (
    SELECT id, amount, phone_number, status, mpesa_receipt, rejection_reason, reviewed_at, paid_at, created_at
    FROM commission_payouts WHERE marketer_id = v_uid ORDER BY created_at DESC LIMIT 50
  ) p;
  RETURN jsonb_build_object(
    'referral_code', v_code, 'commission_rate', v_rate,
    'referred_count', v_referred, 'qualified_count', v_qualified,
    'lifetime_ggr', v_ggr, 'commission_earned', v_earned,
    'commission_paid', v_paid, 'commission_pending', v_pending,
    'commission_approved', v_approved,
    'commission_available', greatest(v_earned - v_committed, 0),
    'payouts', v_payouts
  );
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.request_commission_payout(p_amount numeric, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_earned numeric; v_committed numeric; v_available numeric; v_id uuid;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW'; END IF;
  IF p_amount <> trunc(p_amount)       THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  IF EXISTS (SELECT 1 FROM commission_payouts WHERE marketer_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'PAYOUT_PENDING';
  END IF;
  v_earned := _marketer_commission_earned(v_uid);
  SELECT coalesce(sum(amount), 0) INTO v_committed
    FROM commission_payouts WHERE marketer_id = v_uid AND status IN ('pending','approved','paid');
  v_available := greatest(v_earned - v_committed, 0);
  IF p_amount > v_available THEN RAISE EXCEPTION 'INSUFFICIENT_COMMISSION: available %', v_available; END IF;
  INSERT INTO commission_payouts(marketer_id, amount, phone_number, status)
  VALUES (v_uid, p_amount, v_phone, 'pending') RETURNING id INTO v_id;
  RETURN jsonb_build_object('commission_payout_id', v_id, 'amount', p_amount, 'phone', v_phone, 'status', 'pending');
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_commission_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rate numeric; v_pending_count int; v_pending_amount numeric; v_paid_total numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  SELECT count(*) FILTER (WHERE status = 'pending'),
         coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
         coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)
    INTO v_pending_count, v_pending_amount, v_paid_total
  FROM commission_payouts;
  RETURN jsonb_build_object('commission_rate', v_rate, 'pending_count', v_pending_count,
    'pending_amount', v_pending_amount, 'paid_total', v_paid_total, 'can_edit_rate', _is_super_admin());
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_list_commission_payouts(
  p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, marketer_id uuid, marketer_username text, amount numeric, phone_number text,
  status text, review_note text, rejection_reason text, mpesa_receipt text,
  reviewed_by uuid, reviewer_username text, reviewed_at timestamptz, paid_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT c.id, c.marketer_id, m.username, c.amount, c.phone_number, c.status,
         c.review_note, c.rejection_reason, c.mpesa_receipt,
         c.reviewed_by, r.username, c.reviewed_at, c.paid_at, c.created_at
  FROM commission_payouts c
  JOIN profiles m ON m.id = c.marketer_id
  LEFT JOIN profiles r ON r.id = c.reviewed_by
  WHERE (p_status IS NULL OR c.status = p_status)
  ORDER BY (c.status = 'pending') DESC,
    CASE WHEN c.status = 'pending' THEN c.created_at END ASC, c.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_review_commission_payout(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT status, amount, marketer_id INTO v_status, v_amount, v_marketer
  FROM commission_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND             THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;
  IF p_approve THEN
    UPDATE commission_payouts SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = nullif(trim(coalesce(p_note, '')), '') WHERE id = p_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'commission_payout_approved', 'commission_payout', p_id::text,
            jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'note', p_note));
    RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'amount', v_amount);
  ELSE
    IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE commission_payouts SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           rejection_reason = trim(p_note) WHERE id = p_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'commission_payout_rejected', 'commission_payout', p_id::text,
            jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'reason', trim(p_note)));
    RETURN jsonb_build_object('id', p_id, 'status', 'rejected');
  END IF;
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_record_commission_payout(p_id uuid, p_receipt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_receipt IS NULL OR length(trim(p_receipt)) = 0 THEN RAISE EXCEPTION 'RECEIPT_REQUIRED'; END IF;
  SELECT status, amount, marketer_id INTO v_status, v_amount, v_marketer
  FROM commission_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND              THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'NOT_APPROVED: %', v_status; END IF;
  UPDATE commission_payouts SET status = 'paid', mpesa_receipt = trim(p_receipt), paid_at = now() WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'commission_payout_paid', 'commission_payout', p_id::text,
          jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'receipt', trim(p_receipt)));
  RETURN jsonb_build_object('id', p_id, 'status', 'paid', 'mpesa_receipt', trim(p_receipt));
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_set_commission_rate(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_old numeric;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN RAISE EXCEPTION 'INVALID_RATE: must be in [0,1]'; END IF;
  SELECT commission_rate INTO v_old FROM marketing_config WHERE id = true;
  UPDATE marketing_config SET commission_rate = p_rate, updated_by = auth.uid(), updated_at = now() WHERE id = true;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'commission_rate_changed', 'marketing_config', 'commission_rate',
          jsonb_build_object('old', v_old, 'new', p_rate));
  RETURN jsonb_build_object('commission_rate', p_rate);
END $fn$;
--##
CREATE OR REPLACE FUNCTION public._referral_qualify_on_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_min numeric;
BEGIN
  IF NEW.type = 'deposit' AND NEW.status = 'completed' AND NEW.payment_method = 'mpesa' THEN
    SELECT qualifying_deposit_min INTO v_min FROM marketing_config WHERE id = true;
    IF NEW.amount >= coalesce(v_min, 50) THEN
      UPDATE referrals SET status = 'qualified', qualified_at = now(), first_deposit_amount = NEW.amount
       WHERE player_id = NEW.user_id AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
--##
DROP TRIGGER IF EXISTS trg_referral_qualify ON public.transactions;
--##
CREATE TRIGGER trg_referral_qualify
  AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public._referral_qualify_on_deposit();
--##
-- handle_new_user: live body verbatim + referral attribution (verified diff).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  _ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')), '');
  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN RAISE EXCEPTION 'Username is required'; END IF;
  IF char_length(trim(_username)) < 3 THEN RAISE EXCEPTION 'Username must be at least 3 characters'; END IF;
  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer FROM public.profiles
     WHERE referral_code = upper(_ref) AND role = 'marketer' AND id <> NEW.id;
  END IF;
  INSERT INTO public.profiles (id, username, avatar_color, phone_number, referred_by)
    VALUES (NEW.id, trim(_username), _avatar, _phone, _marketer);
  INSERT INTO public.wallets (user_id, balance, currency) VALUES (NEW.id, 500.00, 'KES');
  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed');
  IF _marketer IS NOT NULL THEN
    INSERT INTO public.referrals (marketer_id, player_id, status)
      VALUES (_marketer, NEW.id, 'pending') ON CONFLICT (player_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $fn$;
--##
-- request_withdrawal: live body verbatim + marketer never auto-approved (verified diff).
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_min numeric := coalesce(_game_setting_num('finance.min_withdrawal'), 100);
  v_thr numeric := coalesce(_game_setting_num('finance.auto_approve_threshold'), 5000);
  v_bal numeric; v_auto boolean; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  SELECT balance INTO v_bal FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_bal IS NULL    THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;
  v_auto := (p_amount <= v_thr)
            AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role = 'marketer');
  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, auto_approved)
  VALUES (v_uid, p_amount, v_phone, 'pending', v_auto) RETURNING id INTO v_id;
  RETURN jsonb_build_object('withdrawal_request_id', v_id, 'status', 'pending',
    'auto_approved', v_auto, 'phone', v_phone, 'amount', p_amount);
END $fn$;
--##
DO $fn$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE role = 'marketer' AND referral_code IS NULL LOOP
    PERFORM _ensure_referral_code(r.id);
  END LOOP;
END $fn$;
--##

-- ============================================================================
-- PART 3 - ADMIN AFFILIATE MANAGEMENT (new). All _is_admin gated; rate +
--           promote/demote + qualifying-deposit are super_admin only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_affiliate_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_rate numeric; v_min numeric;
  v_marketers int; v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric; v_paid numeric; v_committed numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate, qualifying_deposit_min INTO v_rate, v_min FROM marketing_config WHERE id = true;
  SELECT count(*) INTO v_marketers FROM profiles WHERE role = 'marketer';
  SELECT count(*), count(*) FILTER (WHERE status = 'qualified') INTO v_referred, v_qualified FROM referrals;
  -- Platform GGR attributable to qualified referrals (sum across marketers).
  SELECT coalesce(sum(g.ggr), 0) INTO v_ggr
  FROM (SELECT _marketer_ggr(p.id) AS ggr FROM profiles p WHERE p.role = 'marketer') g;
  v_earned := round(v_rate * v_ggr, 2);
  SELECT coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0),
         coalesce(sum(amount) FILTER (WHERE status IN ('pending','approved','paid')), 0)
    INTO v_paid, v_committed FROM commission_payouts;
  RETURN jsonb_build_object(
    'marketer_count', v_marketers, 'referred_count', v_referred, 'qualified_count', v_qualified,
    'lifetime_ggr', v_ggr, 'commission_earned', v_earned, 'commission_paid', v_paid,
    'commission_available', greatest(v_earned - v_committed, 0),
    'commission_rate', v_rate, 'qualifying_deposit_min', v_min,
    'can_edit_rate', _is_super_admin());
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_list_affiliates()
RETURNS TABLE(
  marketer_id uuid, username text, referral_code text, is_banned boolean, created_at timestamptz,
  referred_count bigint, qualified_count bigint, lifetime_ggr numeric,
  commission_earned numeric, commission_paid numeric, commission_pending numeric,
  commission_approved numeric, commission_available numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rate numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  RETURN QUERY
  SELECT m.id, m.username, m.referral_code, m.is_banned, m.created_at,
         coalesce(r.referred_count, 0), coalesce(r.qualified_count, 0),
         coalesce(g.ggr, 0) AS lifetime_ggr,
         round(v_rate * coalesce(g.ggr, 0), 2) AS commission_earned,
         coalesce(c.paid, 0), coalesce(c.pending, 0), coalesce(c.approved, 0),
         greatest(round(v_rate * coalesce(g.ggr, 0), 2) - coalesce(c.committed, 0), 0) AS commission_available
  -- NOTE: the RETURNS TABLE column `marketer_id` is an in-scope OUT variable, so any
  -- UNqualified `marketer_id` inside the body collides with the table column of the
  -- same name -> "column reference marketer_id is ambiguous". Every column referenced
  -- in these LATERAL subqueries is therefore table-qualified (rf./cp.).
  FROM profiles m
  LEFT JOIN LATERAL (
    SELECT count(*) AS referred_count, count(*) FILTER (WHERE rf.status = 'qualified') AS qualified_count
    FROM referrals rf WHERE rf.marketer_id = m.id
  ) r ON true
  LEFT JOIN LATERAL (SELECT _marketer_ggr(m.id) AS ggr) g ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(cp.amount) FILTER (WHERE cp.status = 'paid'), 0) AS paid,
           coalesce(sum(cp.amount) FILTER (WHERE cp.status = 'pending'), 0) AS pending,
           coalesce(sum(cp.amount) FILTER (WHERE cp.status = 'approved'), 0) AS approved,
           coalesce(sum(cp.amount) FILTER (WHERE cp.status IN ('pending','approved','paid')), 0) AS committed
    FROM commission_payouts cp WHERE cp.marketer_id = m.id
  ) c ON true
  WHERE m.role = 'marketer'
  ORDER BY commission_available DESC, m.username ASC;
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_affiliate_referrals(p_marketer uuid)
RETURNS TABLE(
  player_id uuid, username text, status text, first_deposit_amount numeric,
  qualified_at timestamptz, created_at timestamptz, player_ggr numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT ref.player_id, p.username, ref.status, ref.first_deposit_amount,
         ref.qualified_at, ref.created_at,
         greatest(coalesce(b.staked, 0) - coalesce(b.won, 0), 0) AS player_ggr
  FROM referrals ref
  JOIN profiles p ON p.id = ref.player_id
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(amount), 0) AS staked, coalesce(sum(winnings), 0) AS won
    FROM bets WHERE user_id = ref.player_id AND is_bot = false
  ) b ON true
  WHERE ref.marketer_id = p_marketer
  ORDER BY ref.created_at DESC
  LIMIT 500;
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_promote_to_marketer(p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_id uuid; v_role text; v_code text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  SELECT id, role INTO v_id, v_role FROM profiles WHERE lower(username) = lower(trim(p_username));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'CANNOT_CONVERT_OPERATOR'; END IF;
  IF v_role = 'marketer' THEN RAISE EXCEPTION 'ALREADY_MARKETER'; END IF;
  UPDATE profiles SET role = 'marketer' WHERE id = v_id;
  v_code := _ensure_referral_code(v_id);
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'marketer_promoted', 'user', v_id::text,
          jsonb_build_object('old', v_role, 'new', 'marketer', 'referral_code', v_code));
  RETURN jsonb_build_object('user_id', v_id, 'username', trim(p_username), 'role', 'marketer', 'referral_code', v_code);
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_demote_marketer(p_marketer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_role text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_marketer = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = p_marketer FOR UPDATE;
  IF NOT FOUND          THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;
  UPDATE profiles SET role = 'player' WHERE id = p_marketer;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'marketer_demoted', 'user', p_marketer::text,
          jsonb_build_object('old', 'marketer', 'new', 'player'));
  RETURN jsonb_build_object('user_id', p_marketer, 'role', 'player');
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_set_qualifying_deposit(p_min numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_old numeric;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_min IS NULL OR p_min < 0 THEN RAISE EXCEPTION 'INVALID_MIN'; END IF;
  SELECT qualifying_deposit_min INTO v_old FROM marketing_config WHERE id = true;
  UPDATE marketing_config SET qualifying_deposit_min = p_min, updated_by = auth.uid(), updated_at = now() WHERE id = true;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'qualifying_deposit_changed', 'marketing_config', 'qualifying_deposit_min',
          jsonb_build_object('old', v_old, 'new', p_min));
  RETURN jsonb_build_object('qualifying_deposit_min', p_min);
END $fn$;
--##

-- ============================================================================
-- PART 4 - PROMOTIONS (new). Admin-managed catalogue of promotional offers.
--           RLS-locked; no public surface yet (managed in admin only).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.promotions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (length(trim(title)) > 0),
  description  text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT 'general'
                 CHECK (category IN ('welcome','deposit_match','cashback','free_bet','tournament','general')),
  reward_kind  text NOT NULL DEFAULT 'percentage'
                 CHECK (reward_kind IN ('percentage','fixed','none')),
  reward_value numeric NOT NULL DEFAULT 0 CHECK (reward_value >= 0),
  min_deposit  numeric NOT NULL DEFAULT 0 CHECK (min_deposit >= 0),
  max_reward   numeric CHECK (max_reward IS NULL OR max_reward >= 0),
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_active    boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.profiles(id),
  updated_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_dates_chk CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT promotions_pct_chk   CHECK (reward_kind <> 'percentage' OR reward_value <= 100)
);
--##
CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions (is_active, display_order);
--##
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
--##
ALTER TABLE public.promotions FORCE ROW LEVEL SECURITY;
--##
CREATE OR REPLACE FUNCTION public.admin_list_promotions(p_filter text DEFAULT 'all')
RETURNS TABLE(
  id uuid, title text, description text, category text, reward_kind text, reward_value numeric,
  min_deposit numeric, max_reward numeric, starts_at timestamptz, ends_at timestamptz,
  is_active boolean, display_order int, runtime_status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT p.id, p.title, p.description, p.category, p.reward_kind, p.reward_value,
         p.min_deposit, p.max_reward, p.starts_at, p.ends_at, p.is_active, p.display_order,
         CASE
           WHEN NOT p.is_active THEN 'inactive'
           WHEN p.starts_at IS NOT NULL AND p.starts_at > now() THEN 'scheduled'
           WHEN p.ends_at   IS NOT NULL AND p.ends_at   < now() THEN 'expired'
           ELSE 'live'
         END AS runtime_status,
         p.created_at, p.updated_at
  FROM promotions p
  WHERE p_filter = 'all'
     OR (p_filter = 'inactive' AND NOT p.is_active)
     OR (p_filter = 'scheduled' AND p.is_active AND p.starts_at IS NOT NULL AND p.starts_at > now())
     OR (p_filter = 'expired'   AND p.is_active AND p.ends_at   IS NOT NULL AND p.ends_at   < now())
     OR (p_filter = 'live'      AND p.is_active
         AND (p.starts_at IS NULL OR p.starts_at <= now())
         AND (p.ends_at   IS NULL OR p.ends_at   >= now()))
  ORDER BY p.display_order ASC, p.created_at DESC;
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_upsert_promotion(p_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid;
  v_title text := nullif(trim(coalesce(p_data->>'title', '')), '');
  v_desc text := coalesce(p_data->>'description', '');
  v_category text := coalesce(p_data->>'category', 'general');
  v_reward_kind text := coalesce(p_data->>'reward_kind', 'percentage');
  v_reward_value numeric := coalesce((p_data->>'reward_value')::numeric, 0);
  v_min_deposit numeric := coalesce((p_data->>'min_deposit')::numeric, 0);
  v_max_reward numeric := nullif(p_data->>'max_reward', '')::numeric;
  v_starts timestamptz := nullif(p_data->>'starts_at', '')::timestamptz;
  v_ends timestamptz := nullif(p_data->>'ends_at', '')::timestamptz;
  v_order int := coalesce((p_data->>'display_order')::int, 0);
  v_active boolean := coalesce((p_data->>'is_active')::boolean, false);
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'TITLE_REQUIRED'; END IF;
  IF v_category NOT IN ('welcome','deposit_match','cashback','free_bet','tournament','general') THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END IF;
  IF v_reward_kind NOT IN ('percentage','fixed','none') THEN RAISE EXCEPTION 'INVALID_REWARD_KIND'; END IF;
  IF v_reward_value < 0 OR v_min_deposit < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF v_reward_kind = 'percentage' AND v_reward_value > 100 THEN RAISE EXCEPTION 'INVALID_PERCENTAGE'; END IF;
  IF v_max_reward IS NOT NULL AND v_max_reward < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF v_starts IS NOT NULL AND v_ends IS NOT NULL AND v_ends < v_starts THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO promotions(title, description, category, reward_kind, reward_value, min_deposit,
                           max_reward, starts_at, ends_at, is_active, display_order, created_by, updated_by)
    VALUES (v_title, v_desc, v_category, v_reward_kind, v_reward_value, v_min_deposit,
            v_max_reward, v_starts, v_ends, v_active, v_order, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'promotion_created', 'promotion', v_id::text, jsonb_build_object('title', v_title));
  ELSE
    UPDATE promotions SET
      title = v_title, description = v_desc, category = v_category, reward_kind = v_reward_kind,
      reward_value = v_reward_value, min_deposit = v_min_deposit, max_reward = v_max_reward,
      starts_at = v_starts, ends_at = v_ends, is_active = v_active, display_order = v_order,
      updated_by = auth.uid(), updated_at = now()
    WHERE id = p_id RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'promotion_updated', 'promotion', v_id::text, jsonb_build_object('title', v_title));
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_set_promotion_active(p_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE promotions SET is_active = p_active, updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), CASE WHEN p_active THEN 'promotion_activated' ELSE 'promotion_deactivated' END,
          'promotion', p_id::text, '{}'::jsonb);
  RETURN jsonb_build_object('id', p_id, 'is_active', p_active);
END $fn$;
--##
CREATE OR REPLACE FUNCTION public.admin_delete_promotion(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_title text;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  DELETE FROM promotions WHERE id = p_id RETURNING title INTO v_title;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'promotion_deleted', 'promotion', p_id::text, jsonb_build_object('title', v_title));
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END $fn$;
--##

-- ============================================================================
-- PART 5 - GRANTS (least privilege). Tables stay RLS-locked with no client
--           grants; only the SECURITY DEFINER RPCs are callable.
-- ============================================================================
REVOKE ALL ON public.referrals FROM anon, authenticated;
--##
REVOKE ALL ON public.commission_payouts FROM anon, authenticated;
--##
REVOKE ALL ON public.marketing_config FROM anon, authenticated;
--##
REVOKE ALL ON public.promotions FROM anon, authenticated;
--##
GRANT EXECUTE ON FUNCTION public._is_marketer() TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.marketer_dashboard() TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.request_commission_payout(numeric, text) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_commission_overview() TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_list_commission_payouts(text, integer, integer) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_review_commission_payout(uuid, boolean, text) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_record_commission_payout(uuid, text) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_set_commission_rate(numeric) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_affiliate_overview() TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_list_affiliates() TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_affiliate_referrals(uuid) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_promote_to_marketer(text) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_demote_marketer(uuid) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_set_qualifying_deposit(numeric) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_list_promotions(text) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_upsert_promotion(uuid, jsonb) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_set_promotion_active(uuid, boolean) TO authenticated, service_role;
--##
GRANT EXECUTE ON FUNCTION public.admin_delete_promotion(uuid) TO authenticated, service_role;
