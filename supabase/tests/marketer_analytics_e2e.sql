-- e2e for marketer analytics (affiliate_clicks + marketer_expenses + funnel). Rolled back.
DO $e2e$
DECLARE
  m   uuid := '66666666-6666-6666-6666-666666666666';  -- marketer
  a   uuid := '77777777-7777-7777-7777-777777777777';  -- referred, deposits (FTD)
  b   uuid := '88888888-8888-8888-8888-888888888888';  -- referred, no deposit
  adm uuid := '99999999-9999-9999-9999-999999999999';  -- admin
  v_ok boolean; v_clicks bigint; v_regs bigint; v_ftds bigint; v_exp bigint; v_row public.marketer_expenses;
BEGIN
  -- marketer with a known referral code
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (m,'{"username":"mktr_one"}');
  UPDATE profiles SET role='marketer', referral_code='TESTM1' WHERE id=m;
  -- admin
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (adm,'{"username":"admin_one"}');
  UPDATE profiles SET role='admin' WHERE id=adm;
  -- two referred players (referral_code in signup meta -> handle_new_user attributes them)
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (a,'{"username":"ref_a","referral_code":"TESTM1"}');
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (b,'{"username":"ref_b","referral_code":"TESTM1"}');
  IF (SELECT count(*) FROM referrals WHERE marketer_id=m) <> 2 THEN RAISE EXCEPTION 'M0 expected 2 referrals'; END IF;
  -- player A makes a deposit (FTD)
  INSERT INTO transactions(user_id,type,amount,payment_method,reference,description,status)
    VALUES (a,'deposit',1000,'mpesa','FTD-A','M-Pesa deposit','completed');

  -- clicks: valid code records; unknown code is a silent no-op
  SELECT fn_record_affiliate_click('testm1', NULL) INTO v_ok;   -- case-insensitive
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'M1 valid click should return true'; END IF;
  SELECT fn_record_affiliate_click('NOPE999', NULL) INTO v_ok;
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'M2 unknown click should return false'; END IF;
  IF (SELECT count(*) FROM affiliate_clicks WHERE affiliate_id=m) <> 1 THEN RAISE EXCEPTION 'M3 expected 1 click row'; END IF;

  -- admin logs an expense (audited)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm)::text, true);
  v_row := admin_add_marketer_expense(m, 'promo', 50000::bigint, 'tiktok promo');
  IF v_row.amount_cents <> 50000 THEN RAISE EXCEPTION 'M4 expense not logged'; END IF;
  IF NOT EXISTS(SELECT 1 FROM admin_audit_log WHERE admin_id=adm AND action='marketer_expense_add') THEN
    RAISE EXCEPTION 'M5 expense audit missing'; END IF;

  -- funnel (as admin): clicks=1, registrations=2, ftds=1, expenses=50000
  SELECT clicks,registrations,ftds,expenses_cents INTO v_clicks,v_regs,v_ftds,v_exp FROM fn_marketer_funnel(m);
  IF v_clicks<>1 OR v_regs<>2 OR v_ftds<>1 OR v_exp<>50000 THEN
    RAISE EXCEPTION 'M6 funnel got clicks=%/regs=%/ftds=%/exp=%',v_clicks,v_regs,v_ftds,v_exp; END IF;

  -- authorization: non-admin, non-owner cannot read another marketer's funnel or add expenses
  PERFORM set_config('request.jwt.claims', json_build_object('sub',a)::text, true);   -- player A
  BEGIN
    PERFORM * FROM fn_marketer_funnel(m);
    RAISE EXCEPTION 'M7 non-owner funnel should be FORBIDDEN';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN RAISE EXCEPTION 'M7 wrong error: %',SQLERRM; END IF;
  END;
  BEGIN
    v_row := admin_add_marketer_expense(m, 'promo', 100::bigint, 'x');
    RAISE EXCEPTION 'M8 non-admin expense should be FORBIDDEN';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN RAISE EXCEPTION 'M8 wrong error: %',SQLERRM; END IF;
  END;

  -- owner CAN read own funnel
  PERFORM set_config('request.jwt.claims', json_build_object('sub',m)::text, true);
  IF (SELECT clicks FROM fn_marketer_funnel(m)) <> 1 THEN RAISE EXCEPTION 'M9 owner funnel read failed'; END IF;

  RAISE NOTICE '================= MARKETER ANALYTICS E2E PASSED =================';
END
$e2e$;
