-- e2e for the M-Pesa deposit-credit fix (run inside a rolled-back tx).
DO $e2e$
DECLARE
  p3 uuid := '33333333-3333-3333-3333-333333333333';
  v_real bigint; v_bonus bigint; v_demo bigint; v_lr bigint; v_lb bigint; v_ld bigint; v_txid uuid;
BEGIN
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (p3,'{"username":"tester_p3"}');
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p3;
  IF v_real<>0 OR v_bonus<>20000 THEN RAISE EXCEPTION 'D0 welcome r%/b%',v_real,v_bonus; END IF;

  -- completed M-Pesa deposit KES 1000 -> real +100000 (fix) + first_deposit_match +50000 (bonus engine)
  INSERT INTO transactions(user_id,type,amount,payment_method,reference,description,status)
    VALUES (p3,'deposit',1000,'mpesa','RCPT12345','M-Pesa deposit','completed') RETURNING id INTO v_txid;
  SELECT real_balance,bonus_balance INTO v_real,v_bonus FROM wallets WHERE user_id=p3;
  IF v_real<>100000 THEN RAISE EXCEPTION 'D1 deposit real expected 100000 got %',v_real; END IF;
  IF v_bonus<>70000 THEN RAISE EXCEPTION 'D2 bonus expected 70000 (welcome+fdm) got %',v_bonus; END IF;
  IF NOT EXISTS(SELECT 1 FROM bonuses WHERE user_id=p3 AND type='first_deposit_match'
               AND amount=50000 AND wagering_x=3 AND deposit_tx_id=v_txid AND status='active')
    THEN RAISE EXCEPTION 'D3 first_deposit_match row wrong'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ledger_entries WHERE user_id=p3 AND type='deposit' AND balance_kind='real'
               AND amount=100000 AND ref_id=v_txid::text) THEN RAISE EXCEPTION 'D4 deposit ledger row missing'; END IF;

  -- PERSISTENCE: the original bug erased the deposit on the next money move.
  PERFORM _wallet_move(p3,-1,'real','test','x','y');
  SELECT real_balance INTO v_real FROM wallets WHERE user_id=p3;
  IF v_real<>99999 THEN RAISE EXCEPTION 'D5 deposit not persisted after resync, got %',v_real; END IF;

  -- money conservation
  SELECT real_balance,bonus_balance,demo_balance INTO v_real,v_bonus,v_demo FROM wallets WHERE user_id=p3;
  SELECT coalesce(sum(amount) FILTER (WHERE balance_kind='real'),0),
         coalesce(sum(amount) FILTER (WHERE balance_kind='bonus'),0),
         coalesce(sum(amount) FILTER (WHERE balance_kind='demo'),0)
    INTO v_lr,v_lb,v_ld FROM ledger_entries WHERE user_id=p3;
  IF v_real<>v_lr OR v_bonus<>v_lb OR v_demo<>v_ld THEN
    RAISE EXCEPTION 'D6 conservation wallet r%/b%/d% vs ledger r%/b%/d%',v_real,v_bonus,v_demo,v_lr,v_lb,v_ld; END IF;

  -- idempotency: duplicate receipt must fail (unique index) -> no double credit
  BEGIN
    INSERT INTO transactions(user_id,type,amount,payment_method,reference,description,status)
      VALUES (p3,'deposit',1000,'mpesa','RCPT12345','M-Pesa deposit','completed');
    RAISE EXCEPTION 'D7 duplicate receipt should have failed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE '================= DEPOSIT-FIX E2E PASSED =================';
END
$e2e$;
