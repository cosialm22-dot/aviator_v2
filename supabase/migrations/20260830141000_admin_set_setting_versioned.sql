-- ============================================================================
-- Stage B (part 2): hook the versioned config record into admin_set_setting so
-- every game.* write bumps the version, snapshots the whole config, runs the
-- feasibility guard, and fires game_config_changed. Replaces admin_set_setting
-- with an identical body plus a trailing record step for game.* keys.
-- ============================================================================
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
  v_ver    bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT value INTO v_old FROM system_settings WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_SETTING: %', p_key; END IF;
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

  -- Stage B: a game.* change re-versions + snapshots + feasibility-checks + notifies.
  IF p_key LIKE 'game.%' THEN
    v_ver := public.fn_game_config_record(v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'value', v_norm, 'config_version', v_ver);
END $function$;
