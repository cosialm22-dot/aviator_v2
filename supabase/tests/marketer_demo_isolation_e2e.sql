-- ============================================================================
-- MARKETER DEMO-ISOLATION e2e (the safety guarantee behind Streamer Mode):
-- a marketer betting "live on camera" must move ONLY non-withdrawable demo money,
-- never real money; a normal player on the SAME round moves real money.
-- Self-rolls-back (terminal RAISE). PASS: AVIATOR_MARKETER_ISO_E2E|ok=t|...
-- ============================================================================
DO $T$
DECLARE
  v_def uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_mkt uuid := gen_random_uuid();
  v_ply uuid := gen_random_uuid();
  v_round uuid; v_cp numeric;
  m_real0 bigint; m_demo0 bigint; p_real0 bigint;
  m_real bigint; m_demo bigint; p_real bigint;
  v_mbet bets%rowtype; v_pbet bets%rowtype;
  v_log text := ''; v_ok boolean := true;
BEGIN
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (v_mkt, jsonb_build_object('username','mkt_'||substr(v_mkt::text,1,8)));
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (v_ply, jsonb_build_object('username','ply_'||substr(v_ply::text,1,8)));
  DELETE FROM bonuses WHERE user_id IN (v_mkt, v_ply);
  UPDATE profiles SET role='marketer' WHERE id=v_mkt;
  UPDATE wallets SET real_balance=1000000, bonus_balance=0, demo_balance=1000000, balance=10000 WHERE user_id=v_mkt;
  UPDATE wallets SET real_balance=1000000, bonus_balance=0, demo_balance=0,       balance=10000 WHERE user_id=v_ply;
  SELECT real_balance, demo_balance INTO m_real0, m_demo0 FROM wallets WHERE user_id=v_mkt;
  SELECT real_balance INTO p_real0 FROM wallets WHERE user_id=v_ply;

  UPDATE game_rounds SET queue_id=NULL; UPDATE crash_queue SET round_id=NULL;
  DELETE FROM bets; DELETE FROM round_secrets; DELETE FROM game_rounds; DELETE FROM crash_queue;
  v_round := open_round();
  SELECT crash_point INTO v_cp FROM round_secrets WHERE round_id=v_round;
  IF v_cp < 1.5 THEN UPDATE round_secrets SET crash_point=5.00 WHERE round_id=v_round; v_cp:=5.00; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_mkt::text,'role','authenticated')::text, true);
  PERFORM place_bet(v_round, 1000, 2.00, 1::smallint);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_ply::text,'role','authenticated')::text, true);
  PERFORM place_bet(v_round, 1000, 2.00, 1::smallint);

  SELECT real_balance, demo_balance INTO m_real, m_demo FROM wallets WHERE user_id=v_mkt;
  IF m_real = m_real0 AND m_demo = m_demo0 - 100000 THEN
    v_log := v_log || 'M1 marketer-demo-debit ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'M1 FAIL real ' || m_real0 || '->' || m_real || ' demo ' || m_demo0 || '->' || m_demo || '; ';
  END IF;

  SELECT real_balance INTO p_real FROM wallets WHERE user_id=v_ply;
  IF p_real = p_real0 - 100000 THEN
    v_log := v_log || 'M2 player-real-debit ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'M2 FAIL p_real ' || p_real0 || '->' || p_real || '; ';
  END IF;

  UPDATE game_rounds SET status='flying', started_at=now() WHERE id=v_round;
  PERFORM _settle_flight(v_round, 2.50, v_cp);

  SELECT * INTO v_mbet FROM bets WHERE round_id=v_round AND user_id=v_mkt;
  SELECT * INTO v_pbet FROM bets WHERE round_id=v_round AND user_id=v_ply;

  SELECT real_balance, demo_balance INTO m_real, m_demo FROM wallets WHERE user_id=v_mkt;
  IF v_mbet.status='won' AND m_real = m_real0 AND m_demo = m_demo0 - 100000 + 200000 THEN
    v_log := v_log || 'M3 marketer-demo-payout ok(real untouched); ';
  ELSE
    v_ok := false;
    v_log := v_log || 'M3 FAIL st=' || coalesce(v_mbet.status,'-') || ' real=' || m_real || ' demo=' || m_demo || '; ';
  END IF;

  SELECT real_balance INTO p_real FROM wallets WHERE user_id=v_ply;
  IF v_pbet.status='won' AND p_real = p_real0 - 100000 + 200000 THEN
    v_log := v_log || 'M4 player-real-payout ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'M4 FAIL st=' || coalesce(v_pbet.status,'-') || ' p_real=' || p_real || '; ';
  END IF;

  IF m_real = m_real0 THEN
    v_log := v_log || 'M5 marketer-real-never-moved ok; ';
  ELSE
    v_ok := false;
    v_log := v_log || 'M5 FAIL real moved ' || m_real0 || '->' || m_real || '; ';
  END IF;

  RAISE EXCEPTION 'AVIATOR_MARKETER_ISO_E2E|ok=%|%', v_ok, v_log;
END $T$;
