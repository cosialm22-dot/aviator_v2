-- e2e for admin_adjust_balance_kind (run inside a rolled-back tx).
DO $e2e$
DECLARE
  adm uuid := '44444444-4444-4444-4444-444444444444';
  ply uuid := '55555555-5555-5555-5555-555555555555';
  v_real bigint; v_bonus bigint; v_lb bigint; v_res jsonb;
BEGIN
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (adm,'{"username":"admin_t"}');
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (ply,'{"username":"player_t"}');
  UPDATE profiles SET role='admin' WHERE id=adm;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm)::text, true);
  v_res := admin_adjust_balance_kind(ply, 5::numeric, 'bonus', 'goodwill');   -- +KES5 bonus
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=ply;
  IF v_bonus<>20500 THEN RAISE EXCEPTION 'K1 bonus expected 20500 (welcome20000+500) got %',v_bonus; END IF;
  IF NOT EXISTS(SELECT 1 FROM ledger_entries WHERE user_id=ply AND type='adjustment'
               AND balance_kind='bonus' AND amount=500) THEN RAISE EXCEPTION 'K2 ledger row missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM admin_audit_log WHERE admin_id=adm AND action='balance_adjust_kind')
    THEN RAISE EXCEPTION 'K3 audit row missing'; END IF;

  BEGIN
    v_res := admin_adjust_balance_kind(ply, -1000::numeric, 'bonus', 'x');   -- would go negative
    RAISE EXCEPTION 'K4 negative adjust should be blocked';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%NEGATIVE_BALANCE%' THEN RAISE EXCEPTION 'K4 wrong error: %',SQLERRM; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',ply)::text, true);   -- non-admin
  BEGIN
    v_res := admin_adjust_balance_kind(ply, 5::numeric, 'bonus', 'x');
    RAISE EXCEPTION 'K5 non-admin should be FORBIDDEN';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN RAISE EXCEPTION 'K5 wrong error: %',SQLERRM; END IF;
  END;

  SELECT bonus_balance INTO v_bonus FROM wallets WHERE user_id=ply;
  SELECT coalesce(sum(amount) FILTER (WHERE balance_kind='bonus'),0) INTO v_lb FROM ledger_entries WHERE user_id=ply;
  IF v_bonus<>v_lb THEN RAISE EXCEPTION 'K6 conservation b% vs ledger%',v_bonus,v_lb; END IF;

  RAISE NOTICE '================= ADMIN BONUS-ADJUST E2E PASSED =================';
END
$e2e$;
