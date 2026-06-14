-- ============================================================================
-- AVIATOR V2 - FIX: marketer_dashboard must not write on read
-- ============================================================================
-- BUG: marketer_dashboard() is declared STABLE, so PostgREST executes it inside
-- a READ ONLY transaction. It also lazily generated the caller's referral_code
-- via _ensure_referral_code() (an UPDATE) when the code was NULL. For a marketer
-- without a code this raised:
--     "cannot execute UPDATE in a read-only transaction"
--
-- ROOT CAUSE of the missing code: a user can become a marketer via two paths.
--   * admin_promote_to_marketer() - already calls _ensure_referral_code().  OK
--   * admin_set_role(user, 'marketer') - did NOT generate a code.            GAP
--
-- FIX (side-effect-free read path):
--   1. marketer_dashboard() becomes a PURE read - it no longer writes. The
--      referral_code is read directly and is guaranteed non-NULL by (2)+(3).
--   2. admin_set_role() now generates the referral_code whenever it sets a
--      user's role to 'marketer' (closing the gap; idempotent).
--   3. Backfill: generate a code for every existing marketer missing one.
--
-- Idempotent and additive. CREATE OR REPLACE preserves existing privileges, so
-- no re-GRANT is required. Mirrors the live definitions verbatim except for the
-- changes described above.
-- ============================================================================

BEGIN;

-- 1. Pure-read marketer dashboard (no UPDATE; safe under PostgREST STABLE/read-only).
CREATE OR REPLACE FUNCTION public.marketer_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_rate numeric;
  v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric; v_committed numeric;
  v_paid numeric; v_pending numeric; v_approved numeric;
  v_payouts jsonb;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- Pure read. The code is provisioned at promotion time (admin_promote_to_marketer
  -- / admin_set_role) and backfilled below, so it is always present here.
  SELECT referral_code INTO v_code FROM profiles WHERE id = v_uid;
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
END $function$;

-- 2. admin_set_role now provisions a referral code when promoting to marketer.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_role NOT IN ('player','admin','super_admin','marketer') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF p_role = 'super_admin' THEN RAISE EXCEPTION 'SUPER_ADMIN_LOCKED'; END IF;            -- no promotion to super admin
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF p_user_id = _root_super_admin() THEN RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED'; END IF;

  SELECT role INTO v_old FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_old = p_role THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false);
  END IF;

  UPDATE profiles SET role = p_role WHERE id = p_user_id;
  -- Marketers need a referral code to function; provision it here so the
  -- marketer dashboard stays a pure read (mirrors admin_promote_to_marketer).
  IF p_role = 'marketer' THEN PERFORM _ensure_referral_code(p_user_id); END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'role_changed', 'user', p_user_id::text, jsonb_build_object('old', v_old, 'new', p_role));

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END $function$;

-- 3. Backfill: ensure every existing marketer has a referral code.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE role = 'marketer' AND referral_code IS NULL LOOP
    PERFORM _ensure_referral_code(r.id);
  END LOOP;
END $$;

COMMIT;
