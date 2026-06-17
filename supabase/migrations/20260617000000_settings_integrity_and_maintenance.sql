-- ============================================================================
-- AVIATOR V2 - SETTINGS INTEGRITY + MAINTENANCE MODE (end-to-end)
-- ============================================================================
-- Closes three correctness/security gaps in the admin Settings surface:
--
--   1. MAINTENANCE MODE was a dead toggle. `system.maintenance_mode` was written
--      by the UI but read by NOTHING, so flipping it did nothing - players kept
--      betting. We make it authoritative at the only place a wager is created
--      (place_bet) and expose a public is_maintenance() so the client can lock
--      the betting UI. In-flight bets stay cashable; the round driver is
--      untouched, so existing bets settle normally and the game simply stops
--      accepting NEW player bets.
--
--   2. SETTINGS WRITES were unvalidated. The client wrote system_settings rows
--      directly (RLS allowed admins) and logged the audit row separately on a
--      best-effort basis. A bad value (e.g. min_bet > max_bet, house edge 50%)
--      saved silently. We introduce admin_set_setting(): a super-admin-only,
--      SECURITY DEFINER RPC that validates type, bounds, and cross-field
--      invariants and writes value + audit atomically. Direct client writes to
--      system_settings are then REVOKED, making the RPC the single write path.
--
--   3. DEAD GAME SETTINGS. The crash engine is PARAMETRIC (constant house edge);
--      the six crash-distribution bands were "analytics-only and unused", the
--      `crash_source` select duplicated the `queue_enabled` toggle, and
--      `growth_rate_per_ms` is a protocol constant hardcoded identically in the
--      client and the server curve functions - editing it did nothing. We drop
--      these 8 rows so the table is honest and they stop surfacing in the UI.
--
--   Also corrects the live house edge (50% -> 18%) per operator confirmation.
--
-- Idempotent and safe to re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Public maintenance flag reader. SECURITY DEFINER so anon/authenticated can
--    read just this one boolean without exposing the system_settings table.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_maintenance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((SELECT (value #>> '{}')::boolean FROM system_settings WHERE key = 'system.maintenance_mode'), false);
$function$;

REVOKE ALL ON FUNCTION public.is_maintenance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_maintenance() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Maintenance gate in the authoritative bet path. place_bet is the ONLY way
--    a real wager is created, so blocking here makes maintenance real. Operators
--    are blocked further down anyway (OPERATORS_CANNOT_PLAY); this stops players
--    and marketers the instant the toggle is on. Body is otherwise byte-for-byte
--    the current definition (verified against the live DB) plus the single gate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric, p_slot smallint DEFAULT 1)
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
  -- Maintenance mode: refuse all new wagers while the platform is closed.
  IF public.is_maintenance() THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
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
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid AND slot=p_slot) THEN
    RAISE EXCEPTION 'ALREADY_BET';
  END IF;
  SELECT username, avatar_color, role INTO v_username, v_color, v_role FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE wallets SET balance=balance-p_amount, updated_at=now() WHERE user_id=v_uid;
  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false,p_slot)
  RETURNING id INTO v_bet_id;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number||' (slot '||p_slot||')','completed');
  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'slot',p_slot,'balance',v_bal-p_amount);
END $function$;

-- ----------------------------------------------------------------------------
-- 3. Validating settings writer. Single, server-authoritative write path for
--    system_settings: super-admin only, whitelisted keys, typed bounds, and
--    cross-field invariants (min<=max). Writes the value and the audit row in
--    one transaction so the trail can never drift from the change.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_old    jsonb;
  v_num    numeric;
  v_bool   boolean;
  v_other  numeric;
  v_norm   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT value INTO v_old FROM system_settings WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_SETTING: %', p_key; END IF;

  -- Validate + normalise by key. Numeric keys are stored as JSON numbers,
  -- toggles as JSON booleans.
  CASE p_key
    WHEN 'system.maintenance_mode' THEN
      v_bool := (p_value #>> '{}')::boolean;  v_norm := to_jsonb(v_bool);
    WHEN 'game.queue_enabled' THEN
      v_bool := (p_value #>> '{}')::boolean;  v_norm := to_jsonb(v_bool);

    WHEN 'game.betting_ms' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 1000 THEN RAISE EXCEPTION 'INVALID_RANGE: betting window must be >= 1000ms'; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'game.post_crash_ms' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: pause must be >= 0ms'; END IF;
      v_norm := to_jsonb(v_num);

    WHEN 'game.min_bet' THEN
      v_num := (p_value #>> '{}')::numeric;
      v_other := coalesce(_game_setting_num('game.max_bet'), v_num);
      IF v_num < 1 THEN RAISE EXCEPTION 'INVALID_RANGE: minimum bet must be >= 1'; END IF;
      IF v_num > v_other THEN RAISE EXCEPTION 'INVALID_RANGE: minimum bet (%) cannot exceed maximum bet (%)', v_num, v_other; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'game.max_bet' THEN
      v_num := (p_value #>> '{}')::numeric;
      v_other := coalesce(_game_setting_num('game.min_bet'), v_num);
      IF v_num < 1 THEN RAISE EXCEPTION 'INVALID_RANGE: maximum bet must be >= 1'; END IF;
      IF v_num < v_other THEN RAISE EXCEPTION 'INVALID_RANGE: maximum bet (%) cannot be below minimum bet (%)', v_num, v_other; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'game.max_payout' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: payout cap must be >= 0'; END IF;
      v_norm := to_jsonb(v_num);

    WHEN 'game.house_edge_percent' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 0 OR v_num > 40 THEN RAISE EXCEPTION 'INVALID_RANGE: house edge must be between 0 and 40 percent'; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'game.max_crash_point' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 1 THEN RAISE EXCEPTION 'INVALID_RANGE: max crash point must be >= 1'; END IF;
      v_norm := to_jsonb(v_num);

    WHEN 'game.bots_min' THEN
      v_num := (p_value #>> '{}')::numeric;
      v_other := coalesce(_game_setting_num('game.bots_max'), v_num);
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: minimum bots must be >= 0'; END IF;
      IF v_num > v_other THEN RAISE EXCEPTION 'INVALID_RANGE: minimum bots (%) cannot exceed maximum bots (%)', v_num, v_other; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'game.bots_max' THEN
      v_num := (p_value #>> '{}')::numeric;
      v_other := coalesce(_game_setting_num('game.bots_min'), v_num);
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: maximum bots must be >= 0'; END IF;
      IF v_num < v_other THEN RAISE EXCEPTION 'INVALID_RANGE: maximum bots (%) cannot be below minimum bots (%)', v_num, v_other; END IF;
      v_norm := to_jsonb(v_num);

    WHEN 'finance.min_withdrawal' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: minimum withdrawal must be >= 0'; END IF;
      v_norm := to_jsonb(v_num);
    WHEN 'finance.auto_approve_threshold' THEN
      v_num := (p_value #>> '{}')::numeric;
      IF v_num < 0 THEN RAISE EXCEPTION 'INVALID_RANGE: auto-approve threshold must be >= 0'; END IF;
      v_norm := to_jsonb(v_num);

    ELSE
      RAISE EXCEPTION 'SETTING_NOT_EDITABLE: %', p_key;
  END CASE;

  UPDATE system_settings
     SET value = v_norm, updated_by = v_uid, updated_at = now()
   WHERE key = p_key;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'setting_updated', 'setting', p_key, jsonb_build_object('old', v_old, 'new', v_norm));

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'value', v_norm);
END $function$;

REVOKE ALL ON FUNCTION public.admin_set_setting(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_setting(text, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Make the RPC the SOLE write path: revoke direct client writes to the table.
--    Reads (SELECT) remain so the Settings page can render current values.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.system_settings FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. Drop the dead/duplicated settings so the table - and the admin UI that
--    renders straight from it - stop lying. These are confirmed unused:
--      * crash-distribution bands: engine is parametric (constant house edge)
--      * crash_source: duplicated by game.queue_enabled (the real control)
--      * growth_rate_per_ms: protocol constant, hardcoded in client + server
-- ----------------------------------------------------------------------------
DELETE FROM public.system_settings
 WHERE key IN (
   'game.instant_crash_pct','game.low_crash_pct','game.mid_crash_pct',
   'game.high_crash_pct','game.epic_crash_pct','game.jackpot_crash_pct',
   'game.crash_source','game.growth_rate_per_ms'
 );

-- ----------------------------------------------------------------------------
-- 6. Correct the live house edge (was 50% = 50% RTP) back into the 18-20% band.
-- ----------------------------------------------------------------------------
UPDATE public.system_settings
   SET value = to_jsonb(18::numeric), updated_at = now()
 WHERE key = 'game.house_edge_percent' AND (value #>> '{}')::numeric > 40;

COMMIT;
