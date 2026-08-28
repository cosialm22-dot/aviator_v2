-- =====================================================================
-- P2b-2: admin_* READ/LIST/OVERVIEW site scoping (cross-brand read isolation)
-- =====================================================================
-- Companion to P2b (20260828070000). P2b scoped the *mutating* admin_* RPCs.
-- The *read* admin_* RPCs are SECURITY DEFINER and bypass RLS, so a
-- brand-scoped admin could still SEE every brand's rows/aggregates through
-- them. P2b-2 adds a site predicate to each so a scoped admin only sees their
-- own site; platform_superadmin (root) still sees all brands.
--
-- Predicate injected (verbatim bodies otherwise unchanged):
--   (_is_platform_superadmin() OR <table>.site_id = current_site())
--
-- Scoped functions (10):
--   Lists:     admin_list_transactions, admin_list_withdrawals,
--              admin_list_commission_payouts, admin_list_fraud_alerts,
--              admin_list_affiliates, admin_list_promotions
--   Overviews: admin_affiliate_overview, admin_affiliate_referrals,
--              admin_commission_overview, admin_finance_summary
--
-- Non-breaking today: the only current admin caller is the root
-- platform_superadmin (v_all=true -> sees everything). Scoping only bites
-- once real per-brand admins are onboarded (P4 console).
-- NOTE: commission_rate in the affiliate/commission overviews is still read
-- from the global marketing_config (a pre-P3 display source); left unchanged
-- here to keep P2b-2 scoped to row/aggregate *visibility* only.
-- All statements are CREATE OR REPLACE -> idempotent.
-- =====================================================================

BEGIN;

-- ---------- admin_list_transactions ----------
CREATE OR REPLACE FUNCTION public.admin_list_transactions(p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, username text, type text, amount numeric, payment_method text, reference text, description text, status text, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT tr.id, tr.user_id, p.username, tr.type, tr.amount, tr.payment_method,
           tr.reference, tr.description, tr.status, tr.created_at
    FROM transactions tr
    JOIN profiles p ON p.id = tr.user_id
    WHERE (_is_platform_superadmin() OR tr.site_id = current_site())
      AND (p_type   IS NULL OR tr.type   = p_type)
      AND (p_status IS NULL OR tr.status = p_status)
      AND (p_from   IS NULL OR tr.created_at >= p_from)
      AND (p_to     IS NULL OR tr.created_at <  p_to)
      AND (v_search IS NULL
           OR p.username  ILIKE '%' || v_search || '%'
           OR tr.reference ILIKE '%' || v_search || '%')
  )
  SELECT f.id, f.user_id, f.username, f.type, f.amount, f.payment_method,
         f.reference, f.description, f.status, f.created_at,
         count(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 100), 10000))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $function$;

-- ---------- admin_list_withdrawals ----------
CREATE OR REPLACE FUNCTION public.admin_list_withdrawals(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, username text, phone_number text, amount numeric, status text, auto_approved boolean, risk_score integer, risk_flags jsonb, rejection_reason text, review_note text, reviewed_by uuid, reviewer_username text, reviewed_at timestamp with time zone, created_at timestamp with time zone, completed_at timestamp with time zone, mpesa_receipt text, wallet_balance numeric, total_deposited numeric, total_withdrawn numeric, total_wagered numeric, total_won numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  SELECT
    w.id, w.user_id, p.username, w.phone_number, w.amount, w.status,
    w.auto_approved, w.risk_score, w.risk_flags, w.rejection_reason,
    w.review_note, w.reviewed_by, r.username, w.reviewed_at,
    w.created_at, w.completed_at, w.mpesa_receipt,
    wal.balance,
    p.total_deposited, p.total_withdrawn, p.total_wagered, p.total_won
  FROM withdrawal_requests w
  JOIN profiles  p   ON p.id = w.user_id
  LEFT JOIN wallets  wal ON wal.user_id = w.user_id
  LEFT JOIN profiles r   ON r.id = w.reviewed_by
  WHERE (_is_platform_superadmin() OR w.site_id = current_site())
    AND (p_status IS NULL OR w.status = p_status)
  ORDER BY
    (w.status = 'pending') DESC,
    CASE WHEN w.status = 'pending' THEN w.created_at END ASC,
    w.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $function$;

-- ---------- admin_list_commission_payouts ----------
CREATE OR REPLACE FUNCTION public.admin_list_commission_payouts(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, marketer_id uuid, marketer_username text, amount numeric, phone_number text, status text, review_note text, rejection_reason text, mpesa_receipt text, reviewed_by uuid, reviewer_username text, reviewed_at timestamp with time zone, paid_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT c.id, c.marketer_id, m.username, c.amount, c.phone_number, c.status,
         c.review_note, c.rejection_reason, c.mpesa_receipt,
         c.reviewed_by, r.username, c.reviewed_at, c.paid_at, c.created_at
  FROM commission_payouts c
  JOIN profiles m ON m.id = c.marketer_id
  LEFT JOIN profiles r ON r.id = c.reviewed_by
  WHERE (_is_platform_superadmin() OR c.site_id = current_site())
    AND (p_status IS NULL OR c.status = p_status)
  ORDER BY (c.status = 'pending') DESC,
    CASE WHEN c.status = 'pending' THEN c.created_at END ASC, c.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $function$;

-- ---------- admin_list_fraud_alerts ----------
CREATE OR REPLACE FUNCTION public.admin_list_fraud_alerts(p_min_level text DEFAULT 'high'::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, username text, risk_level text, score integer, flags jsonb, last_assessed_at timestamp with time zone, total_deposited numeric, total_withdrawn numeric, total_wagered numeric, total_won numeric, wallet_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_min int;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_min := CASE lower(coalesce(p_min_level,'high'))
             WHEN 'low' THEN 0 WHEN 'medium' THEN 31 WHEN 'high' THEN 51 WHEN 'critical' THEN 71
             ELSE 51 END;
  RETURN QUERY
  SELECT r.user_id, p.username, r.risk_level, r.score, r.flags, r.last_assessed_at,
         p.total_deposited, p.total_withdrawn, p.total_wagered, p.total_won, w.balance
  FROM player_risk_scores r
  JOIN profiles p ON p.id = r.user_id
  LEFT JOIN wallets w ON w.user_id = r.user_id
  WHERE (_is_platform_superadmin() OR r.site_id = current_site())
    AND r.score >= v_min
  ORDER BY r.score DESC, r.last_assessed_at DESC
  LIMIT greatest(1, least(coalesce(p_limit,50), 200));
END $function$;

-- ---------- admin_list_affiliates ----------
CREATE OR REPLACE FUNCTION public.admin_list_affiliates()
 RETURNS TABLE(marketer_id uuid, username text, referral_code text, is_banned boolean, created_at timestamp with time zone, referred_count bigint, qualified_count bigint, lifetime_ggr numeric, commission_earned numeric, commission_paid numeric, commission_pending numeric, commission_approved numeric, commission_available numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND (_is_platform_superadmin() OR m.site_id = current_site())
  ORDER BY commission_available DESC, m.username ASC;
END $function$;

-- ---------- admin_list_promotions ----------
CREATE OR REPLACE FUNCTION public.admin_list_promotions(p_filter text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, title text, description text, category text, reward_kind text, reward_value numeric, min_deposit numeric, max_reward numeric, starts_at timestamp with time zone, ends_at timestamp with time zone, is_active boolean, display_order integer, runtime_status text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  WHERE (_is_platform_superadmin() OR p.site_id = current_site())
    AND (p_filter = 'all'
     OR (p_filter = 'inactive' AND NOT p.is_active)
     OR (p_filter = 'scheduled' AND p.is_active AND p.starts_at IS NOT NULL AND p.starts_at > now())
     OR (p_filter = 'expired'   AND p.is_active AND p.ends_at   IS NOT NULL AND p.ends_at   < now())
     OR (p_filter = 'live'      AND p.is_active
         AND (p.starts_at IS NULL OR p.starts_at <= now())
         AND (p.ends_at   IS NULL OR p.ends_at   >= now())))
  ORDER BY p.display_order ASC, p.created_at DESC;
END $function$;

-- ---------- admin_affiliate_overview ----------
CREATE OR REPLACE FUNCTION public.admin_affiliate_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rate numeric; v_min numeric;
  v_marketers int; v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric; v_paid numeric; v_committed numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate, qualifying_deposit_min INTO v_rate, v_min FROM marketing_config WHERE id = true;
  SELECT count(*) INTO v_marketers FROM profiles WHERE role = 'marketer' AND (_is_platform_superadmin() OR site_id = current_site());
  SELECT count(*), count(*) FILTER (WHERE status = 'qualified') INTO v_referred, v_qualified FROM referrals WHERE (_is_platform_superadmin() OR site_id = current_site());
  -- Platform GGR attributable to qualified referrals (sum across marketers).
  SELECT coalesce(sum(g.ggr), 0) INTO v_ggr
  FROM (SELECT _marketer_ggr(p.id) AS ggr FROM profiles p WHERE p.role = 'marketer' AND (_is_platform_superadmin() OR p.site_id = current_site())) g;
  v_earned := round(v_rate * v_ggr, 2);
  SELECT coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0),
         coalesce(sum(amount) FILTER (WHERE status IN ('pending','approved','paid')), 0)
    INTO v_paid, v_committed FROM commission_payouts WHERE (_is_platform_superadmin() OR site_id = current_site());
  RETURN jsonb_build_object(
    'marketer_count', v_marketers, 'referred_count', v_referred, 'qualified_count', v_qualified,
    'lifetime_ggr', v_ggr, 'commission_earned', v_earned, 'commission_paid', v_paid,
    'commission_available', greatest(v_earned - v_committed, 0),
    'commission_rate', v_rate, 'qualifying_deposit_min', v_min,
    'can_edit_rate', _is_super_admin());
END $function$;

-- ---------- admin_affiliate_referrals ----------
CREATE OR REPLACE FUNCTION public.admin_affiliate_referrals(p_marketer uuid)
 RETURNS TABLE(player_id uuid, username text, status text, first_deposit_amount numeric, qualified_at timestamp with time zone, created_at timestamp with time zone, player_ggr numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND (_is_platform_superadmin() OR ref.site_id = current_site())
  ORDER BY ref.created_at DESC
  LIMIT 500;
END $function$;

-- ---------- admin_commission_overview ----------
CREATE OR REPLACE FUNCTION public.admin_commission_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rate numeric; v_pending_count int; v_pending_amount numeric; v_paid_total numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  SELECT count(*) FILTER (WHERE status = 'pending'),
         coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
         coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)
    INTO v_pending_count, v_pending_amount, v_paid_total
  FROM commission_payouts
  WHERE (_is_platform_superadmin() OR site_id = current_site());
  RETURN jsonb_build_object('commission_rate', v_rate, 'pending_count', v_pending_count,
    'pending_amount', v_pending_amount, 'paid_total', v_paid_total, 'can_edit_rate', _is_super_admin());
END $function$;

-- ---------- admin_finance_summary ----------
CREATE OR REPLACE FUNCTION public.admin_finance_summary(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(deposit_count bigint, deposit_total numeric, mpesa_deposit_count bigint, mpesa_deposit_total numeric, bonus_deposit_total numeric, withdrawal_paid_count bigint, withdrawal_paid_total numeric, withdrawal_pending_count bigint, withdrawal_pending_total numeric, withdrawal_failed_count bigint, withdrawal_failed_total numeric, withdrawal_reversed_total numeric, net_cashflow numeric, bet_count bigint, bet_volume numeric, win_count bigint, win_total numeric, ggr numeric, adjustment_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  WITH t AS (
    SELECT type, amount, status, payment_method
    FROM transactions
    WHERE (_is_platform_superadmin() OR site_id = current_site())
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to   IS NULL OR created_at <  p_to)
  )
  SELECT
    count(*)                                                                                                          FILTER (WHERE type = 'deposit' AND status = 'completed'),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method = 'mpesa'),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method = 'mpesa'), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method IS DISTINCT FROM 'mpesa'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status IN ('pending','processing')),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status IN ('pending','processing')), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status = 'failed'),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'failed'), 0),
    coalesce(-sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount < 0), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0)
      - coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'bet'),
    coalesce(sum(abs(amount)) FILTER (WHERE type = 'bet'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'win'),
    coalesce(sum(amount) FILTER (WHERE type = 'win'), 0),
    coalesce(sum(abs(amount)) FILTER (WHERE type = 'bet'), 0)
      - coalesce(sum(amount) FILTER (WHERE type = 'win'), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'adjustment'), 0)
  FROM t;
END $function$;

COMMIT;
