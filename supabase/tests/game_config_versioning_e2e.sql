-- ============================================================================
-- Stage B e2e: versioned global game config. Self-rolls-back (terminal RAISE).
-- PASS marker: AVIATOR_CONFIG_E2E|ok=t|...
-- ============================================================================
DO $T$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_v0 bigint; v_v1 bigint; v_v2 bigint; v_cfg jsonb; v_round uuid;
  v_gr game_rounds%rowtype; v_log text := ''; v_ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (v_uid, jsonb_build_object('username','cfg_'||substr(v_uid::text,1,8)));
  -- platform_superadmin passes _is_super_admin() and is NOT single-constrained.
  UPDATE profiles SET role='platform_superadmin' WHERE id=v_uid;

  SELECT version INTO v_v0 FROM game_config_meta WHERE id;

  -- C1: baseline feasible
  BEGIN
    PERFORM fn_game_config_check(fn_game_config_snapshot());
    v_log:=v_log||'C1 baseline-feasible ok; ';
  EXCEPTION WHEN OTHERS THEN
    v_ok:=false; v_log:=v_log||'C1 FAIL '||SQLERRM||'; ';
  END;

  -- C2/C3: edit a game key -> version bumps + snapshot reflects it
  PERFORM admin_set_setting('game.house_edge_percent', '7'::jsonb);
  SELECT version INTO v_v1 FROM game_config_meta WHERE id;
  SELECT config INTO v_cfg FROM game_config_versions WHERE version=v_v1;
  IF v_v1 = v_v0+1 AND (v_cfg->>'house_edge_percent')::numeric = 7
    THEN v_log:=v_log||'C2 bump ok; C3 snapshot ok; '
    ELSE v_ok:=false; v_log:=v_log||'C2/C3 FAIL v0='||v_v0||' v1='||v_v1||' he='||coalesce(v_cfg->>'house_edge_percent','-')||'; '; END IF;

  -- C4: non-game edit does NOT bump game config version
  PERFORM admin_set_setting('finance.min_withdrawal', '100'::jsonb);
  SELECT version INTO v_v2 FROM game_config_meta WHERE id;
  IF v_v2 = v_v1 THEN v_log:=v_log||'C4 non-game-no-bump ok; ';
  ELSE v_ok:=false; v_log:=v_log||'C4 FAIL v2='||v_v2||' v1='||v_v1||'; '; END IF;

  -- C5: infeasible combined config rejected by the guard
  BEGIN
    PERFORM fn_game_config_check(jsonb_build_object('house_edge_percent',50,'min_bet',50,'max_bet',1000,'max_crash_point',20,'max_payout',500000,'tick_ms',250,'bots_min',1,'bots_max',2));
    v_ok:=false; v_log:=v_log||'C5 FAIL(no exc); ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INFEASIBLE_CONFIG%' THEN v_log:=v_log||'C5 guard ok; ';
    ELSE v_ok:=false; v_log:=v_log||'C5 FAIL('||SQLERRM||'); '; END IF;
  END;

  -- C6: open_round stamps config_version
  UPDATE crash_queue SET round_id=NULL; DELETE FROM crash_queue;
  DELETE FROM bets; DELETE FROM round_secrets; DELETE FROM game_rounds;
  v_round := open_round();
  SELECT * INTO v_gr FROM game_rounds WHERE id=v_round;
  IF v_gr.config_version = v_v2 THEN v_log:=v_log||'C6 round-stamped ok(v'||v_gr.config_version||'); ';
  ELSE v_ok:=false; v_log:=v_log||'C6 FAIL cv='||coalesce(v_gr.config_version::text,'null')||' exp='||v_v2||'; '; END IF;

  RAISE EXCEPTION 'AVIATOR_CONFIG_E2E|ok=%|%', v_ok, v_log;
END $T$;
