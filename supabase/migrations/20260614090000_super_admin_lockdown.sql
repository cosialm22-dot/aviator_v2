-- ============================================================================
-- AVIATOR V2 - SUPER ADMIN LOCKDOWN + STAFF-CANNOT-PLAY
-- ============================================================================
-- Enforces, at the database layer (the authoritative gate), four invariants the
-- application must never violate:
--
--   1. STAFF CANNOT PLAY. Only role='player' accounts may place bets. Admins,
--      super admins and marketers are operational/affiliate accounts, not
--      customers, and must never wager. Enforced in place_bet().
--
--   2. EXACTLY ONE SUPER ADMIN. There is a single, designated super admin
--      (zrinok). Enforced by a partial unique index (cardinality <= 1) AND a
--      trigger that only permits the designated UUID to hold the role.
--
--   3. THE SUPER ADMIN IS IMMUTABLE. It cannot be demoted, banned, deleted, or
--      role-changed by any code path. Enforced by a BEFORE INSERT/UPDATE/DELETE
--      trigger on profiles, with clean RPC-level guards layered on top.
--
--   4. NO ONE CAN BE PROMOTED TO SUPER ADMIN, and the designated account always
--      resolves to super_admin (even if its profile row is (re)created on
--      signup). Enforced by the same trigger + admin_set_role guard.
--
-- The designated super admin's wallet is also zeroed (staff hold no balance).
--
-- Idempotent: every statement is CREATE OR REPLACE / IF (NOT) EXISTS / guarded
-- so the file is safe to re-apply. Statements are separated by `--##` so they
-- can be applied one-by-one (the deploy path forbids multi-command scripts).
-- ============================================================================

-- ---- 1. Designated super admin (single source of truth) --------------------
CREATE OR REPLACE FUNCTION public._root_super_admin()
RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT 'b220d3a4-f552-4fa3-a477-a9a77dec31c4'::uuid $$;
--##

-- ---- 2. Pin the designated account to super_admin & unbanned ---------------
UPDATE public.profiles
   SET role = 'super_admin', is_banned = false, ban_reason = NULL, banned_at = NULL
 WHERE id = public._root_super_admin();
--##

-- ---- 3. Clear the super admin's wallet balance (ledger-consistent) ----------
-- Record the clearing as a transaction so the wallet movement is auditable.
INSERT INTO public.transactions(user_id, type, amount, description, status)
SELECT public._root_super_admin(), 'adjustment', -w.balance,
       'Super admin account balance cleared (staff cannot play)', 'completed'
  FROM public.wallets w
 WHERE w.user_id = public._root_super_admin() AND w.balance <> 0;
--##

INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details)
SELECT public._root_super_admin(), 'balance_cleared', 'user', public._root_super_admin()::text,
       jsonb_build_object('cleared_amount', w.balance)
  FROM public.wallets w
 WHERE w.user_id = public._root_super_admin() AND w.balance <> 0;
--##

UPDATE public.wallets SET balance = 0, updated_at = now()
 WHERE user_id = public._root_super_admin() AND balance <> 0;
--##

-- ---- 4. Trigger: super-admin identity lock & promotion block ----------------
CREATE OR REPLACE FUNCTION public._enforce_super_admin_lock()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = public._root_super_admin() THEN
      RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED: the super admin cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The designated account is ALWAYS super_admin, however its row is created
    -- (e.g. handle_new_user inserts with the default 'player'); force it here.
    IF NEW.id = public._root_super_admin() THEN
      NEW.role := 'super_admin'; NEW.is_banned := false; NEW.ban_reason := NULL; NEW.banned_at := NULL;
      RETURN NEW;
    END IF;
    IF NEW.role = 'super_admin' THEN
      RAISE EXCEPTION 'SUPER_ADMIN_LOCKED: only the designated super admin may hold this role';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.id = public._root_super_admin() THEN
    IF NEW.role <> 'super_admin' THEN
      RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED: the super admin role cannot be changed';
    END IF;
    IF coalesce(NEW.is_banned, false) THEN
      RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED: the super admin cannot be banned';
    END IF;
    RETURN NEW; -- benign column updates (last_active_at, notes, etc.) are allowed
  END IF;

  IF NEW.role = 'super_admin' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_LOCKED: only the designated super admin may hold this role';
  END IF;
  RETURN NEW;
END $fn$;
--##

DROP TRIGGER IF EXISTS trg_super_admin_lock ON public.profiles;
--##

CREATE TRIGGER trg_super_admin_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._enforce_super_admin_lock();
--##

-- ---- 5. Declarative cardinality guarantee: at most one super_admin ----------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_super_admin
  ON public.profiles ((role)) WHERE role = 'super_admin';
--##

-- ---- 6. place_bet: only players may play -----------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bal numeric; v_bet_id uuid; v_username text; v_color text; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_amount IS NULL OR p_amount < v_min OR p_amount > v_max THEN
    RAISE EXCEPTION 'BET_OUT_OF_RANGE: % not in [%, %]', p_amount, v_min, v_max;
  END IF;
  IF p_auto_cashout IS NOT NULL AND p_auto_cashout <= 1.00 THEN
    RAISE EXCEPTION 'INVALID_AUTO_CASHOUT';
  END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'waiting' OR now() >= v_round.betting_ends_at THEN
    RAISE EXCEPTION 'BETTING_CLOSED';
  END IF;
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'ALREADY_BET';
  END IF;

  SELECT username, avatar_color, role INTO v_username, v_color, v_role FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  -- Staff / affiliate accounts are not customers and must never wager.
  IF v_role <> 'player' THEN RAISE EXCEPTION 'STAFF_CANNOT_PLAY'; END IF;

  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE wallets SET balance=balance-p_amount, updated_at=now() WHERE user_id=v_uid;
  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false)
  RETURNING id INTO v_bet_id;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number,'completed');

  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'balance',v_bal-p_amount);
END $function$;
--##

-- ---- 7. admin_set_role: no promotion to super_admin; root is protected ------
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
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'role_changed', 'user', p_user_id::text, jsonb_build_object('old', v_old, 'new', p_role));

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END $function$;
--##

-- ---- 8. admin_set_ban: the super admin cannot be banned --------------------
CREATE OR REPLACE FUNCTION public.admin_set_ban(p_user_id uuid, p_ban boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role text; v_was_banned boolean;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
