-- e2e money-conservation + behavior tests for the bonus & wagering engine.
-- Every assertion RAISEs on failure; run under ON_ERROR_STOP so any failure
-- aborts the whole run. Designed to run inside a transaction that is ROLLED BACK.
DO $e2e$
DECLARE
  p1 uuid := '11111111-1111-1111-1111-111111111111';
  p2 uuid := '22222222-2222-2222-2222-222222222222';
  site uuid := '00000000-0000-0000-0000-000000000001';
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  v_real bigint; v_bonus bigint; v_demo bigint; v_wagered bigint; v_status text;
  v_lr bigint; v_lb bigint; v_ld bigint; v_bid uuid; v_res jsonb; u uuid;
BEGIN
  -- ================= A. signup -> restricted welcome bonus (handle_new_user) =================
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (p1, '{"username":"tester_p1"}');
  SELECT real_balance,bonus_balance,demo_balance INTO v_real,v_bonus,v_demo FROM wallets WHERE user_id=p1;
  IF v_real<>0 OR v_bonus<>20000 OR v_demo<>0 THEN
    RAISE EXCEPTION 'A1 welcome expected r0/b20000/d0 got r%/b%/d%',v_real,v_bonus,v_demo; END IF;
  IF NOT EXISTS(SELECT 1 FROM bonuses WHERE user_id=p1 AND type='welcome' AND status='active'
               AND amount=20000 AND wagering_x=3) THEN RAISE EXCEPTION 'A2 welcome bonus row wrong'; END IF;
  IF (SELECT balance FROM wallets WHERE user_id=p1) <> 200.00 THEN RAISE EXCEPTION 'A3 cache<>200'; END IF;

  -- ================= B. bonus-first staking + wagering accrual =================
  INSERT INTO game_rounds(id,round_number,status,betting_ends_at,site_id)
    VALUES (r1,900001,'waiting',now()+interval '1 hour',site);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p1)::text, true);
  v_res := place_bet(r1,150::numeric,NULL,1::smallint);   -- 15000c, all from bonus
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p1;
  IF v_real<>0 OR v_bonus<>5000 THEN RAISE EXCEPTION 'B1 bonus-first stake got r%/b%',v_real,v_bonus; END IF;
  SELECT wagered INTO v_wagered FROM bonuses WHERE user_id=p1 AND type='welcome';
  IF v_wagered<>15000 THEN RAISE EXCEPTION 'B2 wagered expected 15000 got %',v_wagered; END IF;

  -- ================= C. stake spanning bonus + real =================
  PERFORM _wallet_move(p1,100000,'real','deposit','test','topup');   -- +KES1000 real (simulated deposit)
  INSERT INTO game_rounds(id,round_number,status,betting_ends_at,site_id)
    VALUES (r2,900002,'waiting',now()+interval '1 hour',site);
  v_res := place_bet(r2,200::numeric,NULL,1::smallint);   -- 20000c = 5000 bonus + 15000 real
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p1;
  IF v_bonus<>0 OR v_real<>85000 THEN RAISE EXCEPTION 'C1 span stake got r%/b%',v_real,v_bonus; END IF;
  SELECT wagered INTO v_wagered FROM bonuses WHERE user_id=p1 AND type='welcome';
  IF v_wagered<>35000 THEN RAISE EXCEPTION 'C2 wagered expected 35000 got %',v_wagered; END IF;

  -- ================= D. bonus is NON-withdrawable (real only) =================
  BEGIN
    v_res := request_withdrawal(900::numeric,'254712345678');   -- real only KES850 -> must fail
    RAISE EXCEPTION 'D1 withdrawal 900 should have failed';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%INSUFFICIENT_BALANCE%' THEN RAISE EXCEPTION 'D1 wrong error: %',SQLERRM; END IF;
  END;
  v_res := request_withdrawal(800::numeric,'254712345678');     -- <= real -> ok (small + low risk: approved at once)
  IF (v_res->>'status') NOT IN ('pending','approved') THEN RAISE EXCEPTION 'D2 withdrawal 800 not accepted: %', v_res; END IF;
  -- the amount is held from REAL money only (bonus untouched)
  IF (SELECT real_balance FROM wallets WHERE user_id = p1) <> 5000 THEN RAISE EXCEPTION 'D3 real after hold expected 5000 got %', (SELECT real_balance FROM wallets WHERE user_id = p1); END IF;

  -- ================= E. nonzero FIFO conversion (manual bonus wx=0.5) via loss path =================
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (p2,'{"username":"tester_p2"}');
  UPDATE bonuses SET status='void' WHERE user_id=p2 AND type='welcome';
  PERFORM _wallet_move(p2,-20000,'bonus','test_void','test','x');    -- isolate: clear welcome funds
  INSERT INTO bonuses(user_id,site_id,type,amount,wagering_x,status)
    VALUES (p2,site,'manual',20000,0.5,'active') RETURNING id INTO v_bid;
  PERFORM _wallet_move(p2,20000,'bonus','bonus','bonuses',v_bid::text);
  INSERT INTO game_rounds(id,round_number,status,betting_ends_at,site_id)
    VALUES (r3,900003,'waiting',now()+interval '1 hour',site);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p2)::text, true);
  v_res := place_bet(r3,150::numeric,NULL,1::smallint);   -- 15000c bonus-first: bonus->5000, wagered 15000>=req 10000
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p2;
  IF v_real<>0 OR v_bonus<>5000 THEN RAISE EXCEPTION 'E1 got r%/b%',v_real,v_bonus; END IF;
  UPDATE game_rounds SET status='flying', started_at=now()-interval '1 second' WHERE id=r3;
  INSERT INTO round_secrets(round_id,crash_point,server_seed,site_id) VALUES (r3,2.0,'seed',site);
  PERFORM crash_round(r3);   -- loss path -> _convert_cleared_bonuses(p2)
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p2;
  SELECT status INTO v_status FROM bonuses WHERE id=v_bid;
  IF v_real<>5000 OR v_bonus<>0 THEN RAISE EXCEPTION 'E3 conversion expected r5000/b0 got r%/b%',v_real,v_bonus; END IF;
  IF v_status<>'cleared' THEN RAISE EXCEPTION 'E4 bonus not cleared: %',v_status; END IF;

  -- ================= F. GLOBAL money conservation: wallet balances == sum(ledger) per kind =================
  FOR u IN SELECT unnest(ARRAY[p1,p2]) LOOP
    SELECT real_balance,bonus_balance,demo_balance INTO v_real,v_bonus,v_demo FROM wallets WHERE user_id=u;
    SELECT coalesce(sum(amount) FILTER (WHERE balance_kind='real'),0),
           coalesce(sum(amount) FILTER (WHERE balance_kind='bonus'),0),
           coalesce(sum(amount) FILTER (WHERE balance_kind='demo'),0)
      INTO v_lr,v_lb,v_ld FROM ledger_entries WHERE user_id=u;
    IF v_real<>v_lr OR v_bonus<>v_lb OR v_demo<>v_ld THEN
      RAISE EXCEPTION 'F money-conservation broken for %: wallet r%/b%/d% vs ledger r%/b%/d%',
        u,v_real,v_bonus,v_demo,v_lr,v_lb,v_ld; END IF;
  END LOOP;

  -- ================= G. fn_wallet_bonus_status returns own active bonuses =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p1)::text, true);
  IF (SELECT count(*) FROM fn_wallet_bonus_status()) < 1 THEN RAISE EXCEPTION 'G status returned nothing for p1'; END IF;

  RAISE NOTICE '================= ALL E2E TESTS PASSED =================';
END
$e2e$;
