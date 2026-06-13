-- ============================================================================
-- AVIATOR V2 - RBAC: canonical four-role model + staff/player separation
-- ============================================================================
-- Establishes ONE authoritative role set and the authorisation rules around it,
-- consolidating the (never-implemented) 8-role design in docs/11-rbac.md down to
-- four roles by explicit product decision:
--
--   player       - the customer; the only role that may place bets.
--   marketer     - growth/affiliate staff; analytics visibility only for now
--                  (affiliate/bonus modules are not built yet, so no operational
--                   powers are granted - none are fabricated here).
--   admin        - operations staff; manages players, game, withdrawals, finance.
--   super_admin  - platform owner; everything admin can do PLUS system settings
--                  and role/staff management. Cannot act on its own account for
--                  ban (self-lockout guard) and cannot be the last one demoted.
--
-- Why a DB-level model (not just UI): the Phase-1 lockdown already centralises
-- every privileged write in _is_admin()/_is_super_admin()-gated SECURITY DEFINER
-- RPCs. Roles are therefore the single lever for authorisation; constraining the
-- column and the role-mutation RPC is the minimal, tamper-proof way to enforce
-- the matrix. The frontend gating is convenience; this migration is the contract.
--
-- Idempotent & guarded: normalises existing data BEFORE adding the CHECK so it
-- cannot fail on legacy rows; all objects use CREATE OR REPLACE / IF (NOT) EXISTS.
-- ============================================================================

BEGIN;

-- ---- 1. Normalise existing role data to the four canonical values -----------
-- The app only ever wrote {player, admin, super_admin}; marketer is new. Any
-- legacy/unknown value (including NULL) collapses to the safe default 'player',
-- except clearly growth-oriented labels which map to 'marketer'. This guarantees
-- the CHECK below succeeds and no account is left in an unrecognised state.
UPDATE public.profiles
   SET role = CASE
     WHEN role IN ('player','admin','super_admin','marketer') THEN role
     WHEN role IN ('marketing','marketing_manager','affiliate','affiliate_manager') THEN 'marketer'
     ELSE 'player'
   END
 WHERE role IS NULL OR role NOT IN ('player','admin','super_admin','marketer');

-- ---- 2. Lock the column: NOT NULL, sane default, exhaustive CHECK -----------
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'player';
UPDATE public.profiles SET role = 'player' WHERE role IS NULL;
ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player','admin','super_admin','marketer'));

COMMIT;

-- ---- 3. Role predicates (single source of truth for the RPC layer) ----------
-- _is_admin() and _is_super_admin() already exist (admin_rpcs / admin_user_mgmt).
-- _is_staff() recognises any non-player role; used by the no-bet guard below and
-- available to future staff-scoped reads (e.g. marketer analytics).
CREATE OR REPLACE FUNCTION public._is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','marketer'));
$$;
REVOKE ALL ON FUNCTION public._is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_staff() TO authenticated, service_role;

-- ---- 4. admin_set_role: accept the four roles + protect the super_admin floor
-- Super_admin only (role management is exclusively theirs). Cannot target self
-- (prevents self-demotion lockout). Refuses to demote the LAST super_admin so the
-- platform can never be left without an owner. No-op (changed=false) when equal.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

-- ---- 5. admin_set_ban: staff (any non-player) are super_admin-protected ------
-- Unchanged semantics except the protected set now includes 'marketer': only a
-- super_admin may ban/unban another staff member; admins may still ban players.
-- Self-ban remains blocked for everyone (no self-lockout).
CREATE OR REPLACE FUNCTION public.admin_set_ban(p_user_id uuid, p_ban boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  SELECT role INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role IN ('admin','super_admin','marketer') AND NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN_TARGET'; END IF;

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

-- ---- 6. Staff are not players: block staff from placing human bets ----------
-- Root-cause enforcement of "admins/super_admins/marketers are not players and
-- must not accrue betting history". A single BEFORE INSERT guard on `bets` is
-- used (rather than editing place_bet) so it is path-independent (defends every
-- write path) and leaves the large, audited place_bet body untouched. Bot rows
-- (is_bot = true, user_id NULL) and all non-human inserts are unaffected. Fully
-- reversible: DROP TRIGGER trg_block_staff_bets ON public.bets;
CREATE OR REPLACE FUNCTION public.block_staff_bets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_bot = false AND NEW.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id AND role IN ('admin','super_admin','marketer')) THEN
    RAISE EXCEPTION 'STAFF_CANNOT_BET';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_staff_bets ON public.bets;
CREATE TRIGGER trg_block_staff_bets
  BEFORE INSERT ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.block_staff_bets();

-- ---- grants ----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_set_role(uuid,text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ban(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid,text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_ban(uuid,boolean,text) TO authenticated, service_role;
