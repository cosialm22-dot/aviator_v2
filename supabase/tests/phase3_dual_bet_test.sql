-- ============================================================================
-- PHASE 3 - REAL DUAL-BET: independent two-slot betting regression test
-- ----------------------------------------------------------------------------
-- Certifies the slot-aware contract: two concurrent bets per player per round
-- (slots 1 & 2), independent stakes/targets, independent manual cash-out, the
-- INVALID_SLOT / ALREADY_BET guards, and the DB-level partial unique index
-- (uniq_bet_round_user_slot) as defense-in-depth behind the RPC. Self-rolls-back
-- via the terminal RAISE; see supabase/tests/README.md.
--
-- PASS marker: AVIATOR_PHASE3_E2E|ok=t|...
-- ============================================================================
DO $T$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_round uuid := gen_random_uuid();
  v_b1 bets%rowtype; v_b2 bets%rowtype; v_bal numeric; v_res jsonb; v_log text:=''; v_ok boolean:=true;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (v_uid, jsonb_build_object('username','e2e_'||substr(v_uid::text,1,8)));
  UPDATE wallets SET real_balance=1000000, bonus_balance=0 WHERE user_id=v_uid;  -- KES 10,000 (balance is derived)
  INSERT INTO game_rounds(id,status,betting_ends_at,seed_hash,source)
    VALUES (v_round,'waiting',now()+interval '5 min','testhash','algorithm');
  INSERT INTO round_secrets(round_id,server_seed,crash_point,crashes_at)
    VALUES (v_round,'testseed',50.00, now()+interval '5 min');

  -- D1: two independent bets, distinct stakes/targets (10000 -> 7000).
  v_res := place_bet(v_round,1000,3.00,1::smallint);
  v_res := place_bet(v_round,2000,5.00,2::smallint);
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_bal=7000 THEN v_log:=v_log||'D1 indep-debit ok; '; ELSE v_ok:=false; v_log:=v_log||'D1 FAIL bal='||v_bal||'; '; END IF;

  -- D2: invalid slot (3) is rejected.
  BEGIN PERFORM place_bet(v_round,500,2.00,3::smallint); v_ok:=false; v_log:=v_log||'D2 FAIL(no exc); ';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE '%INVALID_SLOT%' THEN v_log:=v_log||'D2 ok; '; ELSE v_ok:=false; v_log:=v_log||'D2 FAIL('||SQLERRM||'); '; END IF; END;

  -- D3: duplicate stake on slot 1 -> ALREADY_BET.
  BEGIN PERFORM place_bet(v_round,500,2.00,1::smallint); v_ok:=false; v_log:=v_log||'D3 FAIL(no exc); ';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE '%ALREADY_BET%' THEN v_log:=v_log||'D3 ok; '; ELSE v_ok:=false; v_log:=v_log||'D3 FAIL('||SQLERRM||'); '; END IF; END;

  -- Flight ~7.7s in (live multiplier ~2.0x), not yet crashed.
  UPDATE game_rounds SET status='flying', started_at=now()-interval '7.7 seconds' WHERE id=v_round;

  -- D4: cash out slot 1 only; slot 2 must remain active.
  v_res := cash_out(v_round, 1::smallint);
  SELECT * INTO v_b1 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=1;
  SELECT * INTO v_b2 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=2;
  IF v_b1.status='won' AND v_b1.winnings>1000 AND v_b2.status='active'
     THEN v_log:=v_log||'D4 slot1-cashout-indep ok; ';
     ELSE v_ok:=false; v_log:=v_log||'D4 FAIL b1='||v_b1.status||'/'||coalesce(v_b1.winnings::text,'-')||' b2='||v_b2.status||'; '; END IF;
  -- D5: wallet credited exactly the slot-1 win.
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_bal = 7000 + v_b1.winnings THEN v_log:=v_log||'D5 credit-slot1 ok; '; ELSE v_ok:=false; v_log:=v_log||'D5 FAIL bal='||v_bal||'; '; END IF;

  -- D6: cash out slot 2 independently; both slots won with their own multipliers.
  v_res := cash_out(v_round, 2::smallint);
  SELECT * INTO v_b2 FROM bets WHERE round_id=v_round AND user_id=v_uid AND slot=2;
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  IF v_b2.status='won' AND v_b2.winnings>2000 AND v_bal = 7000 + v_b1.winnings + v_b2.winnings
     THEN v_log:=v_log||'D6 slot2-cashout-indep ok; ';
     ELSE v_ok:=false; v_log:=v_log||'D6 FAIL b2='||v_b2.status||'/'||coalesce(v_b2.winnings::text,'-')||' bal='||v_bal||'; '; END IF;

  -- D7: DB-level uniqueness (defense beyond the RPC guard).
  BEGIN
    INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot)
    VALUES (v_round,v_uid,'dup','#fff',100,2.00,'active',false,1::smallint);
    v_ok:=false; v_log:=v_log||'D7 FAIL(no exc); ';
  EXCEPTION WHEN unique_violation THEN v_log:=v_log||'D7 unique-index ok; ';
           WHEN others THEN v_ok:=false; v_log:=v_log||'D7 FAIL('||SQLERRM||'); '; END;

  RAISE EXCEPTION 'AVIATOR_PHASE3_E2E|ok=%|%', v_ok, v_log;
END $T$;
