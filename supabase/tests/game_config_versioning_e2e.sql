-- ============================================================================
-- Stage B e2e: versioned global game config. Self-rolls-back (terminal RAISE).
-- PASS marker: AVIATOR_CONFIG_E2E|ok=t|...
-- Exercises the versioned-config machinery directly (snapshot / check / record /
-- round-stamp). The admin_set_setting hook is role-gated, so the test drives the
-- same record path the hook calls (fn_game_config_record) after a settings write.
-- ============================================================================
DO $T$
DECLARE
  v_v0 bigint; v_v1 bigint; v_v2 bigint; v_cfg jsonb; v_round uuid;
  v_gr game_rounds%rowtype; v_log text := ''; v_ok boolean := true;
BEGIN
  SELECT version INTO v_v0 FROM game_config_meta WHERE id;

  -- C1: baseline feasible
  BEGIN
    PERFORM fn_game_config_check(fn_game_config_snapshot());
    v_log := v_log || 'C1 baseline-feasible ok; ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_log := v_log || 'C1 FAIL ' || SQLERRM || '; ';
  END;

  -- C2/C3: a game.* write + record -> version bumps + snapshot reflects the value
  UPDATE system_settings SET value = '7'::jsonb WHERE key = 'game.house_edge_percent';
  v_v1 := fn_game_config_record(NULL);
  SELECT config INTO v_cfg FROM game_config_versions WHERE version = v_v1;
  IF v_v1 = v_v0 + 1 AND (v_cfg->>'house_edge_percent')::numeric = 7 THEN
    v_log := v_log || 'C2 bump ok; C3 snapshot ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'C2/C3 FAIL v0=' || v_v0 || ' v1=' || v_v1 || '; ';
  END IF;

  -- C4: a non-game write (no record call) does NOT bump the game config version
  UPDATE system_settings SET value = '100'::jsonb WHERE key = 'finance.min_withdrawal';
  SELECT version INTO v_v2 FROM game_config_meta WHERE id;
  IF v_v2 = v_v1 THEN
    v_log := v_log || 'C4 non-game-no-bump ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'C4 FAIL v2=' || v_v2 || ' v1=' || v_v1 || '; ';
  END IF;

  -- C5: infeasible combined config rejected by the guard
  BEGIN
    PERFORM fn_game_config_check(jsonb_build_object('house_edge_percent',50,'min_bet',50,'max_bet',1000,'max_crash_point',20,'max_payout',500000,'tick_ms',250,'bots_min',1,'bots_max',2));
    v_ok := false;
    v_log := v_log || 'C5 FAIL(no exc); ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INFEASIBLE_CONFIG%' THEN
      v_log := v_log || 'C5 guard ok; ';
    ELSE
      v_ok := false;
      v_log := v_log || 'C5 FAIL(' || SQLERRM || '); ';
    END IF;
  END;

  -- C6: open_round stamps config_version with the live version
  -- Clear in FK-safe order: rounds reference crash_queue (queue_id) and
  -- crash_queue references rounds (round_id); null both links first.
  UPDATE game_rounds SET queue_id = NULL;
  UPDATE crash_queue SET round_id = NULL;
  DELETE FROM bets;
  DELETE FROM round_secrets;
  DELETE FROM game_rounds;
  DELETE FROM crash_queue;
  v_round := open_round();
  SELECT * INTO v_gr FROM game_rounds WHERE id = v_round;
  IF v_gr.config_version = v_v2 THEN
    v_log := v_log || 'C6 round-stamped ok(v' || v_gr.config_version || '); ';
  ELSE
    v_ok := false;
    v_log := v_log || 'C6 FAIL cv=' || coalesce(v_gr.config_version::text,'null') || ' exp=' || v_v2 || '; ';
  END IF;

  RAISE EXCEPTION 'AVIATOR_CONFIG_E2E|ok=%|%', v_ok, v_log;
END $T$;
