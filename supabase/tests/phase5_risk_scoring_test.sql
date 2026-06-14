-- ============================================================================
-- PHASE 5 - RISK-SCORING ENGINE: assess_player_risk E2E regression test
-- ----------------------------------------------------------------------------
-- Runs AFTER 20260614120000_risk_scoring_engine.sql is deployed (it calls the
-- live assess_player_risk and reads the live device_fingerprints table). Drives
-- two crafted players through the engine and asserts the exact weighted factor
-- blend, fraud flags, score cache, and profiles.risk_score sync. Self-rolls-back
-- via the terminal RAISE; see supabase/tests/README.md.
--
-- PASS marker: AVIATOR_PHASE5_E2E|ok=t|...
-- ============================================================================
DO $T$
DECLARE
  vA uuid := gen_random_uuid();   -- clean new account
  vB uuid := gen_random_uuid();   -- risky (multi-account + financial + velocity)
  vO1 uuid := gen_random_uuid();  -- shares a device with B
  vO2 uuid := gen_random_uuid();
  r jsonb; v_log text:=''; v_ok boolean:=true; v_cache int; v_pr int;
BEGIN
  INSERT INTO auth.users(id,raw_user_meta_data) VALUES
    (vA, jsonb_build_object('username','rkA_'||substr(vA::text,1,6))),
    (vB, jsonb_build_object('username','rkB_'||substr(vB::text,1,6))),
    (vO1,jsonb_build_object('username','rkO1_'||substr(vO1::text,1,6))),
    (vO2,jsonb_build_object('username','rkO2_'||substr(vO2::text,1,6)));

  -- Scenario B: 1-day-old account, withdrew 500 with 0 deposits, shared device
  -- (2 other accounts), and a rapid deposit->withdraw cycle within the hour.
  UPDATE profiles SET created_at=now()-interval '1 day', total_deposited=0, total_withdrawn=500, total_wagered=0 WHERE id=vB;
  INSERT INTO device_fingerprints(user_id,fingerprint) VALUES (vB,'FP'),(vO1,'FP'),(vO2,'FP');
  INSERT INTO transactions(user_id,type,amount,description,status) VALUES (vB,'deposit',500,'dep','completed');
  INSERT INTO withdrawal_requests(user_id,amount,phone_number,status) VALUES (vB,500,'254700000000','pending');

  r := assess_player_risk(vB);
  -- score = round(financial 100*.15 + age ~96.67*.10 + multi 100*.15 + velocity 40*.15) = 46 -> medium
  IF (r->>'score')::int = 46 AND r->>'level'='medium' THEN v_log:=v_log||'B score/level ok; ';
     ELSE v_ok:=false; v_log:=v_log||'B FAIL score='||(r->>'score')||' lvl='||(r->>'level')||'; '; END IF;
  IF (r->'factors'->>'multi_account')::int=100 AND (r->'factors'->>'financial')::int=100
     AND (r->'factors'->>'velocity')::int=40 AND (r->'factors'->>'win_rate')::int=0
     AND (r->'factors'->>'bet_pattern')::int=0 AND (r->'factors'->>'session')::int=0
     AND (r->'factors'->>'account_age')::int BETWEEN 96 AND 97
     THEN v_log:=v_log||'B factors ok; ';
     ELSE v_ok:=false; v_log:=v_log||'B FAIL factors='||(r->'factors')::text||'; '; END IF;
  IF (r->'flags') @> '["shared_device"]' AND (r->'flags') @> '["rapid_deposit_withdraw"]'
     AND jsonb_array_length(r->'flags')=2 THEN v_log:=v_log||'B flags ok; ';
     ELSE v_ok:=false; v_log:=v_log||'B FAIL flags='||(r->'flags')::text||'; '; END IF;
  SELECT score INTO v_cache FROM player_risk_scores WHERE user_id=vB;
  SELECT risk_score INTO v_pr FROM profiles WHERE id=vB;
  IF v_cache=46 AND v_pr=46 THEN v_log:=v_log||'B cache+sync ok; ';
     ELSE v_ok:=false; v_log:=v_log||'B FAIL cache='||coalesce(v_cache::text,'-')||' pr='||coalesce(v_pr::text,'-')||'; '; END IF;

  -- Scenario A: brand-new clean account -> only the account-age factor fires.
  r := assess_player_risk(vA);
  IF (r->>'score')::int = 10 AND r->>'level'='low' AND jsonb_array_length(r->'flags')=0
     THEN v_log:=v_log||'A clean ok; ';
     ELSE v_ok:=false; v_log:=v_log||'A FAIL score='||(r->>'score')||' lvl='||(r->>'level')||' flags='||(r->'flags')::text||'; '; END IF;

  RAISE EXCEPTION 'AVIATOR_PHASE5_E2E|ok=%|%', v_ok, v_log;
END $T$;
