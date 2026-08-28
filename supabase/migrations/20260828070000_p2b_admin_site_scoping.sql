-- =====================================================================
-- P2b: admin_* function site-scoping (cross-brand admin isolation)
-- =====================================================================
-- Companion to P2 (20260828050000_p2_roles_guards.sql).
--
-- P2 added the RLS "second dimension" (_can_admin_site) so a brand-scoped
-- admin can only SELECT their own site's rows via PostgREST. But the
-- admin_* mutating RPCs are SECURITY DEFINER and bypass RLS as table
-- owner -- so RLS alone does NOT stop a scoped brand admin from mutating
-- another brand's users/records through those RPCs.
--
-- P2b closes that gap: every mutating admin_* function now resolves the
-- TARGET row's site_id and calls _can_admin_site(<target_site>), raising
-- FORBIDDEN_SITE on any cross-brand attempt. platform_superadmin remains
-- unrestricted (sees/acts across all brands).
--
-- Site resolution per function:
--   * by profiles.site_id (user_id):  admin_adjust_balance, admin_assess_player_risk,
--       admin_demote_marketer, admin_get_user, admin_grant_free_bet,
--       admin_set_ban, admin_set_role
--   * by profiles.site_id (username): admin_promote_to_marketer
--   * by withdrawal_requests.site_id: admin_approve_withdrawal, admin_reject_withdrawal
--   * by commission_payouts.site_id:  admin_record_commission_payout, admin_review_commission_payout
--
-- Guard ordering note: role-privilege checks (_is_admin / _is_super_admin ->
-- FORBIDDEN) run BEFORE the site check (_can_admin_site -> FORBIDDEN_SITE),
-- so an under-privileged caller gets FORBIDDEN, a wrong-brand caller gets
-- FORBIDDEN_SITE.
--
-- Verified e2e: all 12 functions return FORBIDDEN_SITE cross-brand; same-brand
-- succeeds; platform_superadmin (root) succeeds across brands.
-- All statements are CREATE OR REPLACE -> idempotent / non-breaking.
-- =====================================================================

BEGIN;

-- ---------- admin_adjust_balance ----------
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_delta numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_real bigint; v_delta_c bigint; v_new numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'INVALID_DELTA'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  v_delta_c := round(p_delta*100)::bigint;
  SELECT real_balance INTO v_real FROM wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_real IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_real + v_delta_c < 0 THEN RAISE EXCEPTION 'NEGATIVE_BALANCE'; END IF;
  PERFORM public._wallet_move(p_user_id, v_delta_c, 'real', 'adjustment', 'admin', auth.uid()::text);
  SELECT balance INTO v_new FROM wallets WHERE user_id = p_user_id;
  INSERT INTO transactions(user_id, type, amount, description, status)
  VALUES (p_user_id, 'adjustment', p_delta, 'Admin: ' || p_reason, 'completed');
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'balance_adjust', 'user', p_user_id::text,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'new_balance', v_new));
  RETURN jsonb_build_object('balance', v_new, 'delta', p_delta);
END $function$;

-- ---------- admin_approve_withdrawal ----------
CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text; v_amount numeric; v_phone text; v_user uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.withdrawal_requests WHERE id = p_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;

  SELECT status, amount, phone_number, user_id
    INTO v_status, v_amount, v_phone, v_user
  FROM withdrawal_requests WHERE id = p_id FOR UPDATE;

  IF NOT FOUND            THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;

  UPDATE withdrawal_requests
     SET reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), '')
   WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'withdrawal_approved', 'withdrawal', p_id::text,
          jsonb_build_object('amount', v_amount, 'phone', v_phone,
                             'user_id', v_user, 'note', p_note));

  RETURN jsonb_build_object(
    'withdrawal_request_id', p_id,
    'amount',               v_amount,
    'phone_number',         v_phone,
    'user_id',              v_user,
    'status',               'pending'
  );
END $function$;

-- ---------- admin_assess_player_risk ----------
CREATE OR REPLACE FUNCTION public.admin_assess_player_risk(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  RETURN assess_player_risk(p_user_id);
END $function$;

-- ---------- admin_demote_marketer ----------
CREATE OR REPLACE FUNCTION public.admin_demote_marketer(p_marketer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_marketer)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_marketer = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = p_marketer FOR UPDATE;
  IF NOT FOUND          THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role <> 'marketer' THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;
  UPDATE profiles SET role = 'player' WHERE id = p_marketer;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'marketer_demoted', 'user', p_marketer::text,
          jsonb_build_object('old', 'marketer', 'new', 'player'));
  RETURN jsonb_build_object('user_id', p_marketer, 'role', 'player');
END $function$;

-- ---------- admin_get_user ----------
CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile jsonb; v_balance numeric; v_bets jsonb; v_txns jsonb;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;

  SELECT to_jsonb(x) INTO v_profile FROM (
    SELECT id, username, avatar_color, role, is_banned, ban_reason, banned_at,
           phone_number, created_at, last_active_at,
           total_deposited, total_withdrawn, total_wagered, total_won, risk_score, admin_notes
    FROM profiles WHERE id = p_user_id
  ) x;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT balance INTO v_balance FROM wallets WHERE user_id = p_user_id;

  SELECT coalesce(jsonb_agg(b), '[]'::jsonb) INTO v_bets FROM (
    SELECT id, amount, cashout_multiplier, winnings, status, created_at
    FROM bets WHERE user_id = p_user_id AND is_bot = false
    ORDER BY created_at DESC LIMIT 30
  ) b;

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_txns FROM (
    SELECT id, type, amount, description, status, created_at
    FROM transactions WHERE user_id = p_user_id
    ORDER BY created_at DESC LIMIT 30
  ) t;

  RETURN jsonb_build_object(
    'profile',          v_profile,
    'wallet_balance',   v_balance,
    'bets',             v_bets,
    'transactions',     v_txns,
    'can_manage_roles', _is_super_admin(),
    'is_self',          (p_user_id = auth.uid())
  );
END $function$;

-- ---------- admin_grant_free_bet ----------
CREATE OR REPLACE FUNCTION public.admin_grant_free_bet(p_user_id uuid, p_amount numeric, p_expires_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO free_bets(user_id, amount, source, granted_by, expires_at)
  VALUES (p_user_id, round(p_amount,2), 'grant', auth.uid(),
          CASE WHEN coalesce(p_expires_days,0) > 0 THEN now() + (p_expires_days||' days')::interval ELSE NULL END)
  RETURNING id INTO v_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'free_bet_granted', 'user', p_user_id::text,
          jsonb_build_object('amount', round(p_amount,2), 'free_bet_id', v_id));
  RETURN jsonb_build_object('free_bet_id', v_id, 'user_id', p_user_id, 'amount', round(p_amount,2));
END $function$;

-- ---------- admin_promote_to_marketer ----------
CREATE OR REPLACE FUNCTION public.admin_promote_to_marketer(p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_role text; v_code text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE lower(username) = lower(trim(p_username)))) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
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
END $function$;

-- ---------- admin_record_commission_payout ----------
CREATE OR REPLACE FUNCTION public.admin_record_commission_payout(p_id uuid, p_receipt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.commission_payouts WHERE id = p_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
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
END $function$;

-- ---------- admin_reject_withdrawal ----------
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text; v_amount numeric; v_user uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.withdrawal_requests WHERE id = p_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT status, amount, user_id INTO v_status, v_amount, v_user
  FROM withdrawal_requests WHERE id = p_id FOR UPDATE;

  IF NOT FOUND            THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;

  UPDATE withdrawal_requests
     SET status           = 'rejected',
         rejection_reason = trim(p_reason),
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'withdrawal_rejected', 'withdrawal', p_id::text,
          jsonb_build_object('amount', v_amount, 'user_id', v_user, 'reason', trim(p_reason)));

  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'rejected');
END $function$;

-- ---------- admin_review_commission_payout ----------
CREATE OR REPLACE FUNCTION public.admin_review_commission_payout(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.commission_payouts WHERE id = p_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
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
END $function$;

-- ---------- admin_set_ban ----------
CREATE OR REPLACE FUNCTION public.admin_set_ban(p_user_id uuid, p_ban boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role text; v_was_banned boolean;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF p_user_id = _root_super_admin() THEN RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED'; END IF;

  SELECT role, is_banned INTO v_role, v_was_banned FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role IN ('admin','super_admin') AND NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN_TARGET'; END IF;

  IF p_ban THEN
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE profiles SET is_banned = true, ban_reason = trim(p_reason), banned_at = now() WHERE id = p_user_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'user_banned', 'user', p_user_id::text, jsonb_build_object('reason', trim(p_reason)));
  ELSE
    UPDATE profiles SET is_banned = false, ban_reason = NULL, banned_at = NULL WHERE id = p_user_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'user_unbanned', 'user', p_user_id::text, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object('user_id', p_user_id, 'is_banned', p_ban);
END $function$;

-- ---------- admin_set_role ----------
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
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

COMMIT;
