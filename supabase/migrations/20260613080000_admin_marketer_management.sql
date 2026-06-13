-- ============================================================================
-- AVIATOR V2 - ADMIN MARKETER MANAGEMENT
-- ============================================================================
-- Builds the admin surface for managing marketers end to end, on top of the
-- affiliate system (20260613070000). Adds:
--   * profiles.commission_rate_override - optional per-marketer rate (NULL =
--     use the global marketing_config.commission_rate). super_admin-controlled.
--   * effective-rate plumbing so dashboard + earnings honour the override.
--   * admin_list_marketers()  - roster + per-marketer performance/commission.
--   * admin_get_marketer(uuid) - one marketer's full detail (referrals, ledger,
--     payouts) the admin client cannot assemble directly under RLS lockdown.
--   * admin_set_marketer_status(uuid,boolean) - promote a PLAYER to marketer
--     (provisions a referral code) / demote a marketer to player (guarded
--     against outstanding commission payouts). super_admin only.
--   * admin_set_marketer_rate(uuid,numeric) - set/clear a marketer's rate
--     override. super_admin only.
--
-- AUTHORIZATION: reads gate on _is_admin(); every mutation gates on
-- _is_super_admin() (role/terms changes are an owner concern), mirroring the
-- existing admin_set_role / admin_set_commission_rate contracts. All mutations
-- write admin_audit_log.
--
-- ORDERING: must run AFTER 20260613070000_marketing_affiliate_system.sql.
-- Idempotent and additive; safe to re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Per-marketer commission rate override (NULL => fall back to global rate).
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS commission_rate_override numeric
  CHECK (commission_rate_override IS NULL OR (commission_rate_override >= 0 AND commission_rate_override <= 1));

-- ----------------------------------------------------------------------------
-- 2. Effective rate = per-marketer override, else the global rate. Single
--    source of truth reused by earnings + the dashboard + the admin roster.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._marketer_effective_rate(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT commission_rate_override FROM profiles        WHERE id = p_marketer),
    (SELECT commission_rate          FROM marketing_config WHERE id = true)
  );
$$;

-- Redefine earnings to use the effective (override-aware) rate.
CREATE OR REPLACE FUNCTION public._marketer_commission_earned(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(public._marketer_effective_rate(p_marketer) * public._marketer_ggr(p_marketer), 2);
$$;

-- ----------------------------------------------------------------------------
-- 3. Redefine marketer_dashboard so the marketer sees their EFFECTIVE rate.
--    Identical to 20260613070000 except v_rate is the effective rate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketer_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_rate numeric;
  v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric;
  v_committed numeric;
  v_paid numeric; v_pending numeric; v_approved numeric;
  v_payouts jsonb;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT referral_code INTO v_code FROM profiles WHERE id = v_uid;
  IF v_code IS NULL THEN v_code := _ensure_referral_code(v_uid); END IF;

  v_rate := _marketer_effective_rate(v_uid);

  SELECT count(*), count(*) FILTER (WHERE status = 'qualified')
    INTO v_referred, v_qualified
  FROM referrals WHERE marketer_id = v_uid;

  v_ggr    := _marketer_ggr(v_uid);
  v_earned := _marketer_commission_earned(v_uid);

  SELECT
    coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0),
    coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
    coalesce(sum(amount) FILTER (WHERE status = 'approved'), 0)
    INTO v_paid, v_pending, v_approved
  FROM commission_payouts WHERE marketer_id = v_uid;

  v_committed := v_paid + v_pending + v_approved;

  SELECT coalesce(jsonb_agg(p ORDER BY p.created_at DESC), '[]'::jsonb) INTO v_payouts
  FROM (
    SELECT id, amount, phone_number, status, mpesa_receipt, rejection_reason,
           reviewed_at, paid_at, created_at
    FROM commission_payouts WHERE marketer_id = v_uid
    ORDER BY created_at DESC LIMIT 50
  ) p;

  RETURN jsonb_build_object(
    'referral_code',        v_code,
    'commission_rate',      v_rate,
    'referred_count',       v_referred,
    'qualified_count',      v_qualified,
    'lifetime_ggr',         v_ggr,
    'commission_earned',    v_earned,
    'commission_paid',      v_paid,
    'commission_pending',   v_pending,
    'commission_approved',  v_approved,
    'commission_available', greatest(v_earned - v_committed, 0),
    'payouts',              v_payouts
  );
END $$;

-- ----------------------------------------------------------------------------
-- 4. admin_list_marketers - roster with performance + commission accounting.
--    earned computed ONCE per marketer in the CTE (no duplicated math).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_marketers()
RETURNS TABLE(
  id                       uuid,
  username                 text,
  avatar_color             text,
  referral_code            text,
  is_banned                boolean,
  created_at               timestamptz,
  commission_rate_override numeric,
  effective_rate           numeric,
  referred_count           bigint,
  qualified_count          bigint,
  lifetime_ggr             numeric,
  commission_earned        numeric,
  commission_paid          numeric,
  commission_pending       numeric,
  commission_approved      numeric,
  commission_available     numeric,
  has_outstanding_payout   boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT
      m.id, m.username, m.avatar_color, m.referral_code, m.is_banned, m.created_at,
      m.commission_rate_override,
      _marketer_effective_rate(m.id)    AS eff_rate,
      coalesce(rc.referred, 0)          AS referred,
      coalesce(rc.qualified, 0)         AS qualified,
      _marketer_ggr(m.id)               AS ggr,
      _marketer_commission_earned(m.id) AS earned,
      coalesce(pc.paid, 0)              AS paid,
      coalesce(pc.pending, 0)           AS pending,
      coalesce(pc.approved, 0)          AS approved
    FROM profiles m
    LEFT JOIN (
      SELECT marketer_id,
             count(*)                                AS referred,
             count(*) FILTER (WHERE status='qualified') AS qualified
      FROM referrals GROUP BY marketer_id
    ) rc ON rc.marketer_id = m.id
    LEFT JOIN (
      SELECT marketer_id,
             sum(amount) FILTER (WHERE status='paid')     AS paid,
             sum(amount) FILTER (WHERE status='pending')  AS pending,
             sum(amount) FILTER (WHERE status='approved') AS approved
      FROM commission_payouts GROUP BY marketer_id
    ) pc ON pc.marketer_id = m.id
    WHERE m.role = 'marketer'
  )
  SELECT b.id, b.username, b.avatar_color, b.referral_code, b.is_banned, b.created_at,
         b.commission_rate_override, b.eff_rate, b.referred, b.qualified, b.ggr,
         b.earned, b.paid, b.pending, b.approved,
         greatest(b.earned - (b.paid + b.pending + b.approved), 0) AS available,
         (b.pending + b.approved) > 0 AS has_outstanding_payout
  FROM base b
  ORDER BY b.earned DESC, b.username ASC;
END $$;

-- ----------------------------------------------------------------------------
-- 5. admin_get_marketer - one marketer's full detail.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_marketer(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text;
  v_eff numeric; v_earned numeric;
  v_paid numeric; v_pending numeric; v_approved numeric;
  v_profile jsonb; v_referrals jsonb; v_payouts jsonb;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT role INTO v_role FROM profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;

  v_eff    := _marketer_effective_rate(p_user_id);
  v_earned := _marketer_commission_earned(p_user_id);
  SELECT coalesce(sum(amount) FILTER (WHERE status='paid'),0),
         coalesce(sum(amount) FILTER (WHERE status='pending'),0),
         coalesce(sum(amount) FILTER (WHERE status='approved'),0)
    INTO v_paid, v_pending, v_approved
  FROM commission_payouts WHERE marketer_id = p_user_id;

  SELECT to_jsonb(x) INTO v_profile FROM (
    SELECT id, username, avatar_color, referral_code, is_banned, ban_reason,
           phone_number, created_at, commission_rate_override
    FROM profiles WHERE id = p_user_id
  ) x;

  -- per-referral breakdown incl. that player's net GGR (may be negative)
  SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_referrals
  FROM (
    SELECT rf.player_id, p.username AS player_username, rf.status,
           rf.first_deposit_amount, rf.qualified_at, rf.created_at,
           coalesce((SELECT sum(b.amount) - sum(coalesce(b.winnings,0))
                     FROM bets b WHERE b.user_id = rf.player_id AND b.is_bot = false), 0) AS player_ggr
    FROM referrals rf
    JOIN profiles p ON p.id = rf.player_id
    WHERE rf.marketer_id = p_user_id
    ORDER BY rf.created_at DESC LIMIT 200
  ) r;

  SELECT coalesce(jsonb_agg(c ORDER BY c.created_at DESC), '[]'::jsonb) INTO v_payouts
  FROM (
    SELECT id, amount, phone_number, status, mpesa_receipt, rejection_reason,
           review_note, reviewed_at, paid_at, created_at
    FROM commission_payouts WHERE marketer_id = p_user_id
    ORDER BY created_at DESC LIMIT 100
  ) c;

  RETURN jsonb_build_object(
    'profile',              v_profile,
    'effective_rate',       v_eff,
    'lifetime_ggr',         _marketer_ggr(p_user_id),
    'commission_earned',    v_earned,
    'commission_paid',      v_paid,
    'commission_pending',   v_pending,
    'commission_approved',  v_approved,
    'commission_available', greatest(v_earned - (v_paid + v_pending + v_approved), 0),
    'has_outstanding_payout', (v_pending + v_approved) > 0,
    'referrals',            v_referrals,
    'payouts',              v_payouts,
    'can_manage',           _is_super_admin()
  );
END $$;

-- ----------------------------------------------------------------------------
-- 6. admin_set_marketer_status - promote a player / demote a marketer.
--    Promote: PLAYER -> marketer, provisions a referral code. Refuses to
--    convert an operator (admin/super_admin) - demote them via admin_set_role
--    first. Demote: marketer -> player, blocked while payouts are outstanding
--    (pending/approved) so no in-flight commission is orphaned.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_marketer_status(p_user_id uuid, p_make boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_role text; v_code text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_user_id IS NULL          THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_user_id = auth.uid()     THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  SELECT role INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF p_make THEN
    IF v_role = 'marketer' THEN
      RETURN jsonb_build_object('user_id', p_user_id, 'role', 'marketer', 'changed', false);
    END IF;
    IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'CANNOT_CONVERT_OPERATOR'; END IF;
    UPDATE profiles SET role = 'marketer' WHERE id = p_user_id;
    v_code := _ensure_referral_code(p_user_id);
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'marketer_promoted', 'user', p_user_id::text,
            jsonb_build_object('referral_code', v_code));
    RETURN jsonb_build_object('user_id', p_user_id, 'role', 'marketer', 'changed', true, 'referral_code', v_code);
  ELSE
    IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;
    IF EXISTS (SELECT 1 FROM commission_payouts
                WHERE marketer_id = p_user_id AND status IN ('pending','approved')) THEN
      RAISE EXCEPTION 'OUTSTANDING_PAYOUTS';
    END IF;
    UPDATE profiles SET role = 'player' WHERE id = p_user_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'marketer_demoted', 'user', p_user_id::text, '{}'::jsonb);
    RETURN jsonb_build_object('user_id', p_user_id, 'role', 'player', 'changed', true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. admin_set_marketer_rate - set (or clear, with NULL) a marketer's rate
--    override. super_admin only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_marketer_rate(p_user_id uuid, p_rate numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_old numeric;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 1) THEN RAISE EXCEPTION 'INVALID_RATE: must be in [0,1]'; END IF;

  SELECT role, commission_rate_override INTO v_role, v_old FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND          THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;

  UPDATE profiles SET commission_rate_override = p_rate WHERE id = p_user_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'marketer_rate_set', 'user', p_user_id::text,
          jsonb_build_object('old', v_old, 'new', p_rate));
  RETURN jsonb_build_object('user_id', p_user_id, 'commission_rate_override', p_rate,
                            'effective_rate', _marketer_effective_rate(p_user_id));
END $$;

-- ----------------------------------------------------------------------------
-- 8. GRANTS - reads for admins, mutations self-gate to super_admin.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._marketer_effective_rate(uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_marketers()                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_marketer(uuid)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_marketer_status(uuid,boolean)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_marketer_rate(uuid,numeric)        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_marketers()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_marketer(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_marketer_status(uuid,boolean)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_marketer_rate(uuid,numeric)       TO authenticated, service_role;

COMMIT;
