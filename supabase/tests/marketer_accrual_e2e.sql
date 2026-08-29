-- e2e for marketer accrual economy (expense netting + unified balance + ledger). Rolled back.
DO $a$
DECLARE
  m   uuid;
  p   uuid;
  adm uuid;
  site uuid := '00000000-0000-0000-0000-000000000001';
  r uuid := gen_random_uuid();
  v_earned numeric; v_avail numeric; v_exp numeric; v_res jsonb; v_led jsonb; v_row public.marketer_expenses;
BEGIN
  m := '11111111-2222-3333-4444-555555555001'; p := '11111111-2222-3333-4444-555555555002';
  SELECT id INTO adm FROM profiles WHERE role='super_admin' ORDER BY created_at LIMIT 1;
  IF adm IS NULL THEN RAISE EXCEPTION 'no super_admin present'; END IF;

  -- marketer with a referral code
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (m,'{"username":"accr_mktr"}');
  UPDATE profiles SET role='marketer', referral_code='ACCRUAL1' WHERE id=m;
  -- referred player attributed to the marketer
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (p,'{"username":"accr_player","referral_code":"ACCRUAL1"}');
  IF NOT EXISTS(SELECT 1 FROM referrals WHERE marketer_id=m AND player_id=p) THEN RAISE EXCEPTION 'A0 referral not created'; END IF;

  -- player deposits (qualifies the referral) then bets and loses -> GGR for the marketer
  INSERT INTO transactions(user_id,type,amount,payment_method,reference,description,status)
    VALUES (p,'deposit',1000,'mpesa','ACC-DEP','M-Pesa deposit','completed');
  IF (SELECT status FROM referrals WHERE marketer_id=m AND player_id=p) <> 'qualified' THEN RAISE EXCEPTION 'A1 referral not qualified'; END IF;
  INSERT INTO game_rounds(id,round_number,status,betting_ends_at,site_id) VALUES (r,996001,'waiting',now()+interval '1 hour',site);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p)::text, true);
  v_res := place_bet(r,500::numeric,NULL,1::smallint);   -- KES500 stake
  UPDATE game_rounds SET status='flying', started_at=now()-interval '1 second' WHERE id=r;
  INSERT INTO round_secrets(round_id,crash_point,server_seed,site_id) VALUES (r,2.0,'seed',site);
  PERFORM crash_round(r);   -- loss -> GGR = 500 - 0

  v_earned := _marketer_commission_earned(m);
  IF v_earned <= 0 THEN RAISE EXCEPTION 'A2 no commission earned (got %)',v_earned; END IF;

  -- balance with no expenses: available == earned
  SELECT available, expenses INTO v_avail, v_exp FROM fn_marketer_balance(m);
  IF v_avail <> v_earned OR v_exp <> 0 THEN RAISE EXCEPTION 'A3 avail=% exp=% (want %/0)',v_avail,v_exp,v_earned; END IF;

  -- admin logs an expense (advance) -> nets out of available
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm)::text, true);
  v_row := admin_add_marketer_expense(m,'advance',10000::bigint,'cash advance');  -- KES100
  SELECT available, expenses INTO v_avail, v_exp FROM fn_marketer_balance(m);
  IF v_exp <> 100 OR v_avail <> (v_earned - 100) THEN RAISE EXCEPTION 'A4 after expense avail=% exp=% (want %/100)',v_avail,v_exp,v_earned-100; END IF;

  -- payout capped at NET available: requesting full earned must fail; small amount ok
  PERFORM set_config('request.jwt.claims', json_build_object('sub',m)::text, true);
  BEGIN
    v_res := request_commission_payout(trunc(v_earned)::numeric, '254712345678');
    RAISE EXCEPTION 'A5 payout of full earned should exceed net available';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%INSUFFICIENT_COMMISSION%' THEN RAISE EXCEPTION 'A5 wrong error: %',SQLERRM; END IF;
  END;
  v_res := request_commission_payout(1::numeric, '254712345678');   -- within net
  IF (v_res->>'status') <> 'pending' THEN RAISE EXCEPTION 'A6 small payout not pending'; END IF;

  -- committed now includes the pending 1 (no double-pay): available = earned - 100 - 1
  SELECT available INTO v_avail FROM fn_marketer_balance(m);
  IF v_avail <> (v_earned - 100 - 1) THEN RAISE EXCEPTION 'A7 avail after pending=% (want %)',v_avail,v_earned-101; END IF;

  -- toggle expense-recovery OFF -> expenses no longer reduce available
  UPDATE marketing_config SET expenses_reduce_commission=false WHERE id=true;
  SELECT available, expenses INTO v_avail, v_exp FROM fn_marketer_balance(m);
  IF v_exp <> 0 OR v_avail <> (v_earned - 1) THEN RAISE EXCEPTION 'A8 toggle-off avail=% exp=% (want %/0)',v_avail,v_exp,v_earned-1; END IF;
  UPDATE marketing_config SET expenses_reduce_commission=true WHERE id=true;

  -- ledger statement (as marketer): summary + entries (payout + expense)
  v_led := fn_marketer_ledger(m, 50);
  IF (v_led->>'earned')::numeric <> v_earned THEN RAISE EXCEPTION 'A9 ledger earned mismatch'; END IF;
  IF jsonb_array_length(v_led->'entries') < 2 THEN RAISE EXCEPTION 'A10 ledger should have payout+expense entries'; END IF;

  -- dashboard runs and surfaces expenses + net available
  v_res := marketer_dashboard();
  IF (v_res->>'commission_expenses')::numeric <> 100 THEN RAISE EXCEPTION 'A11 dashboard expenses missing'; END IF;

  RAISE NOTICE '================= MARKETER ACCRUAL ECONOMY PASSED (earned=% avail_net=%) =================',v_earned,(v_earned-101);
END
$a$;
