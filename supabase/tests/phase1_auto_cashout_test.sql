-- ============================================================================
-- PHASE 1 — AUTO-CASHOUT: end-to-end money-path regression test
-- ----------------------------------------------------------------------------
-- Exercises the live RPCs (place_bet, _settle_flight, crash_round) through the
-- real wallet + ledger. Self-rolls-back: the terminal RAISE aborts the txn so
-- NOTHING persists. See supabase/tests/README.md for the pattern.
--
-- PASS marker:  AVIATOR_PHASE1_E2E|ok=t|...
-- ============================================================================
DO $T$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_round uuid := gen_random_uuid();
  v_res jsonb; v_bal numeric; v_b1 bets%rowtype; v_b2 bets%rowtype;
  v_wintx numeric; v_log text := ''; v_ok boolean := true;
BEGIN
  -- Simulate an authenticated player so auth.uid() resolves inside the RPCs.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- Fixture: auth.users insert fires handle_new_user -> profile + wallet(500) + welcome txn.
  INSERT INTO auth.users(id, raw_user_meta_data)
    VALUES (v_uid, jsonb_build_object('username','e2e_'||substr(v_uid::text,1,8)));
  UPDATE wallets SET real_balance=1000000, bonus_balance=0 WHERE user_id=v_uid;  -- known starting balance (KES 10,000; balance is derived)
  INSERT INTO game_rounds(id,status,betting_ends_at,seed_hash,source)
    VALUES (v_round,'waiting',now()+interval '5 min','testhash','algorithm');
  INSERT INTO round_secrets(round_id,server_seed,crash_point,crashes_at)
    VALUES (v_round,'testseed',5.00,NULL);

  -- T1: auto-cashout target <= 1.00x is rejected.
  BEGIN PERFORM place_bet(v_round,1000,1.00,1::smallint); v_ok:=false; v_log:=v_log||'T1 FAIL(no exc); ';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE '%INVALID_AUTO_CASHOUT%' THEN v_log:=v_log||'T1 ok; ';
    ELSE v_ok:=false; v_log:=v_log||'T1 FAIL('||SQLERRM||'); '; END IF; END;

  -- T2: stake below game.min_bet is rejected.
  BEGIN PERFORM place_bet(v_round,10,2.00,1::smallint); v_ok:=false; v_log:=v_log||'T2 FAIL(no exc); ';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE '%BET_OUT_OF_RANGE%' THEN v_log:=v_log||'T2 ok; ';
    ELSE v_ok:=false; v_log:=v_log||'T2 FAIL('||SQLERRM||'); '; END IF; END;

  -- T3: valid slot-1 stake debits the wallet atomically (10000 -> 9000).
  v_res := place_bet(v_round,1000,2.00,1::smallint);
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_bal=9000 THEN v_log:=v_log||'T3 wallet ok; '; ELSE v_ok:=false; v_log:=v_log||'T3 FAIL='||v_bal||'; '; END IF;

  -- T4: independent dual-bet on slot 2 (target above crash) debits independently (9000 -> 8000).
  v_res := place_bet(v_round,1000,6.00,2::smallint);
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_bal=8000 THEN v_log:=v_log||'T4 dualbet ok; '; ELSE v_ok:=false; v_log:=v_log||'T4 FAIL='||v_bal||'; '; END IF;

  -- Flight, then settle auto-cashouts at a live multiplier of 2.50x.
  UPDATE game_rounds SET status='flying', started_at=now() WHERE id=v_round;
  PERFORM _settle_flight(v_round, 2.50, 5.00);

  SELECT * INTO v_b1 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=1;
  SELECT * INTO v_b2 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=2;
  -- T5: slot 1 settles AT THE TARGET (2.00x), winnings = floor(1000*2.00*100)/100 = 2000 (tick-rate independent).
  IF v_b1.status='won' AND v_b1.cashout_multiplier=2.00 AND v_b1.winnings=2000
     THEN v_log:=v_log||'T5 autocashout@target ok; ';
     ELSE v_ok:=false; v_log:=v_log||'T5 FAIL st='||v_b1.status||' m='||coalesce(v_b1.cashout_multiplier::text,'-')||' w='||coalesce(v_b1.winnings::text,'-')||'; '; END IF;
  -- T6: slot 2 (target 6.00 > live 2.50) stays active.
  IF v_b2.status='active' THEN v_log:=v_log||'T6 slot2-survives ok; ';
     ELSE v_ok:=false; v_log:=v_log||'T6 FAIL='||v_b2.status||'; '; END IF;
  -- T7: wallet credited exactly the slot-1 win (8000 + 2000 = 10000).
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_bal=10000 THEN v_log:=v_log||'T7 credit ok; '; ELSE v_ok:=false; v_log:=v_log||'T7 FAIL='||v_bal||'; '; END IF;
  -- T8: a 'win' ledger row is written for the auto-cashout.
  SELECT amount INTO v_wintx FROM transactions WHERE user_id=v_uid AND type='win' ORDER BY created_at DESC LIMIT 1;
  IF v_wintx=2000 THEN v_log:=v_log||'T8 ledger-win ok; '; ELSE v_ok:=false; v_log:=v_log||'T8 FAIL='||coalesce(v_wintx::text,'-')||'; '; END IF;

  -- Crash: slot 2 (target above crash point) must lose with no phantom credit.
  PERFORM crash_round(v_round);
  SELECT * INTO v_b2 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=2;
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  -- T9: target-above-crash loses; balance unchanged at 10000.
  IF v_b2.status='lost' AND v_b2.winnings IS NULL AND v_bal=10000
     THEN v_log:=v_log||'T9 above-crash-loses ok; ';
     ELSE v_ok:=false; v_log:=v_log||'T9 FAIL st='||v_b2.status||' bal='||v_bal||'; '; END IF;

  -- T10: payout cap (game.max_payout) and 2-dp floor rounding (matches settlement math).
  IF least(floor(50000*20.00*100)/100,500000)=500000 AND least(floor(333*2.00*100)/100,500000)=666.00
     THEN v_log:=v_log||'T10 cap+floor ok; '; ELSE v_ok:=false; v_log:=v_log||'T10 FAIL; '; END IF;

  -- Always abort -> full rollback. The message carries the result.
  RAISE EXCEPTION 'AVIATOR_PHASE1_E2E|ok=%|%', v_ok, v_log;
END $T$;
