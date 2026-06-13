-- ============================================================================
-- AVIATOR V2 - MILESTONE 2: ADMIN USER MANAGEMENT
-- ============================================================================
-- Under the Phase-1 lockdown, profiles has NO admin RLS policy (only
-- "update own"), so the dashboard's direct ban/role writes to other users
-- silently fail (0 rows, RLS-denied). wallets and transactions are likewise
-- admin-unreadable. These SECURITY DEFINER RPCs are the sanctioned admin paths
-- and centralise authorisation + audit, mirroring the existing admin_* RPCs.
--
--   _is_super_admin()    : role gate for privileged actions (role management).
--   admin_set_ban        : ban / unban (admins; only super_admins may target
--                          admin/super_admin accounts; cannot target self).
--   admin_set_role       : change a user's role (super_admin only; validated
--                          against {player,admin,super_admin}; cannot target self).
--   admin_get_user       : single authoritative detail payload (profile, wallet
--                          balance, recent bets + transactions) that the admin
--                          client cannot read directly (wallets/transactions RLS).
--
-- Also folds in two corrections discovered during this work:
--   * handle_new_user() existed only in the live DB (untracked drift) and wrote
--     an em dash into every signup's welcome-bonus transaction. It is captured
--     here verbatim with the em dash replaced by a hyphen. (The on-auth trigger
--     remains as-is in the live DB; this only (re)defines the function.)
--   * One-time cleanup of the 21 historical transaction descriptions that
--     already contain em/en dashes.
-- Additive & idempotent: safe to apply on a live database.
-- ============================================================================

-- ---- role gate --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin');
$$;

-- ---- admin_set_ban ----------------------------------------------------------
-- Bans or unbans a user. A reason is mandatory when banning. Admins may act on
-- players; only super_admins may act on admin/super_admin accounts. An admin
-- can never ban themselves (prevents accidental self-lockout on the player side).
CREATE OR REPLACE FUNCTION public.admin_set_ban(p_user_id uuid, p_ban boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_was_banned boolean;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

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
END $$;

-- ---- admin_set_role ---------------------------------------------------------
-- Changes a user's role. Restricted to super_admins. Cannot target self (avoids
-- self-demotion lockout). No-op (changed=false) if the role is unchanged.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_role NOT IN ('player','admin','super_admin') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  SELECT role INTO v_old FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_old = p_role THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false);
  END IF;

  UPDATE profiles SET role = p_role WHERE id = p_user_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'role_changed', 'user', p_user_id::text, jsonb_build_object('old', v_old, 'new', p_role));

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END $$;

-- ---- admin_get_user ---------------------------------------------------------
-- One authorised call returning everything the detail page needs, bypassing the
-- wallets/transactions RLS that blocks the admin client for other users.
CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_balance numeric; v_bets jsonb; v_txns jsonb;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

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
END $$;

-- ---- handle_new_user (capture untracked drift + de-em-dash) ------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username text; _phone text; _avatar text;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF char_length(trim(_username)) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;
  INSERT INTO public.profiles (id, username, avatar_color, phone_number)
    VALUES (NEW.id, trim(_username), _avatar, _phone);
  INSERT INTO public.wallets (user_id, balance, currency)
    VALUES (NEW.id, 500.00, 'KES');
  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed');
  RETURN NEW;
END;
$$;

-- ---- one-time data cleanup: de-em-dash historical transaction descriptions ---
UPDATE public.transactions
   SET description = replace(replace(description, chr(8212), '-'), chr(8211), '-')
 WHERE description LIKE '%' || chr(8212) || '%'
    OR description LIKE '%' || chr(8211) || '%';

-- ---- grants: admins are 'authenticated'; each fn self-checks its role -------
REVOKE ALL ON FUNCTION public._is_super_admin()                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ban(uuid,boolean,text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_role(uuid,text)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user(uuid)                    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_super_admin()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_ban(uuid,boolean,text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid,text)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid)                   TO authenticated, service_role;
