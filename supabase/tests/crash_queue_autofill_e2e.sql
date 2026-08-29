-- ============================================================================
-- CRASH-QUEUE AUTOFILL e2e (Option A1). Self-rolls-back: terminal RAISE aborts
-- the txn so NOTHING persists. PASS marker: AVIATOR_QUEUE_E2E|ok=t|...
--
-- Covers:
--   Q1  autofill tops an empty queue up to the target depth (default 10)
--   Q2  every queued point respects [1.00, game.max_crash_point]
--   Q3  positions are strictly increasing and contiguous after max(position)
--   Q4  autofill is idempotent (second call adds 0)
--   Q5  autofill preserves existing manual rows (appends, never reorders/removes)
--   Q6  with queue_enabled=true, open_round() consumes the next pending point IN
--       ORDER and marks it used (admin foresight == actual outcome)
--   Q7  consumed point's crash_multiplier == the queued value (exact)
--   Q8  after consumption, autofill refills to depth (self-heal)
--   Q9  with queue_enabled=false, open_round() ignores the queue (algorithm path)
-- ============================================================================
DO $T$
DECLARE
  v_min int := 10;
  v_maxcp numeric;
  v_added int; v_pending int; v_first_cp numeric; v_first_pos int;
  v_round uuid; v_gr game_rounds%rowtype; v_q crash_queue%rowtype;
  v_cnt int; v_bad int; v_minpos int; v_maxpos int; v_distinct_pos int;
  v_log text := ''; v_ok boolean := true;
BEGIN
  -- Clean slate for deterministic assertions.
  DELETE FROM crash_queue;
  DELETE FROM round_secrets;
  DELETE FROM bets;
  DELETE FROM game_rounds;
  UPDATE system_settings SET value='10'::jsonb WHERE key='game.queue_autofill_min';
  SELECT coalesce(_game_setting_num('game.max_crash_point'),1000000) INTO v_maxcp;

  -- Q1: fill empty queue to depth.
  v_added := fn_queue_autofill();
  SELECT count(*) INTO v_pending FROM crash_queue WHERE status='pending';
  IF v_added = v_min AND v_pending = v_min THEN v_log:=v_log||'Q1 fill='||v_added||' ok; ';
  ELSE v_ok:=false; v_log:=v_log||'Q1 FAIL added='||v_added||' pending='||v_pending||'; '; END IF;

  -- Q2: range check.
  SELECT count(*) INTO v_bad FROM crash_queue WHERE status='pending'
    AND (crash_multiplier < 1.00 OR crash_multiplier > v_maxcp);
  IF v_bad=0 THEN v_log:=v_log||'Q2 range ok; '; ELSE v_ok:=false; v_log:=v_log||'Q2 FAIL bad='||v_bad||'; '; END IF;

  -- Q3: positions contiguous 1..N.
  SELECT min(position), max(position), count(DISTINCT position) INTO v_minpos, v_maxpos, v_distinct_pos
    FROM crash_queue WHERE status='pending';
  IF v_minpos=1 AND v_maxpos=v_min AND v_distinct_pos=v_min THEN v_log:=v_log||'Q3 positions ok; ';
  ELSE v_ok:=false; v_log:=v_log||'Q3 FAIL min='||v_minpos||' max='||v_maxpos||' distinct='||v_distinct_pos||'; '; END IF;

  -- Q4: idempotent.
  v_added := fn_queue_autofill();
  IF v_added=0 THEN v_log:=v_log||'Q4 idempotent ok; '; ELSE v_ok:=false; v_log:=v_log||'Q4 FAIL added='||v_added||'; '; END IF;

  -- Q5: manual row preserved; autofill appends after it.
  DELETE FROM crash_queue;
  INSERT INTO crash_queue(crash_multiplier, position, status, source, created_by)
    VALUES (7.77, 1, 'pending', 'manual', NULL);
  v_added := fn_queue_autofill();
  SELECT count(*) INTO v_pending FROM crash_queue WHERE status='pending';
  IF v_added = v_min-1 AND v_pending = v_min
     AND EXISTS(SELECT 1 FROM crash_queue WHERE status='pending' AND source='manual' AND crash_multiplier=7.77 AND position=1)
    THEN v_log:=v_log||'Q5 manual-preserved ok; ';
    ELSE v_ok:=false; v_log:=v_log||'Q5 FAIL added='||v_added||' pending='||v_pending||'; '; END IF;

  -- Q6/Q7: queue_enabled=true -> open_round consumes next pending IN ORDER, exact value.
  UPDATE system_settings SET value='true'::jsonb WHERE key='game.queue_enabled';
  SELECT crash_multiplier, position INTO v_first_cp, v_first_pos
    FROM crash_queue WHERE status='pending' ORDER BY position ASC LIMIT 1;   -- expect 7.77 @ pos1
  v_round := open_round();
  SELECT * INTO v_gr FROM game_rounds WHERE id=v_round;
  SELECT * INTO v_q FROM crash_queue WHERE position=v_first_pos;
  IF v_round IS NOT NULL AND v_gr.crash_multiplier IS NULL  -- not revealed until crash
     AND v_q.status='used' AND v_q.round_id=v_round
     AND EXISTS(SELECT 1 FROM round_secrets WHERE round_id=v_round AND crash_point=v_first_cp)
    THEN v_log:=v_log||'Q6 consume-in-order ok; Q7 exact-cp='||v_first_cp||' ok; ';
    ELSE v_ok:=false; v_log:=v_log||'Q6/Q7 FAIL round='||coalesce(v_round::text,'null')
           ||' qstatus='||coalesce(v_q.status,'-')||' first_cp='||coalesce(v_first_cp::text,'-')||'; '; END IF;

  -- Q8: after consuming one, autofill refills pending back to depth.
  v_added := fn_queue_autofill();
  SELECT count(*) INTO v_pending FROM crash_queue WHERE status='pending';
  IF v_pending = v_min THEN v_log:=v_log||'Q8 self-heal ok(added='||v_added||'); ';
  ELSE v_ok:=false; v_log:=v_log||'Q8 FAIL pending='||v_pending||' added='||v_added||'; '; END IF;

  -- Q9: queue_enabled=false -> open_round ignores queue (source='algorithm', no queue_id).
  DELETE FROM round_secrets; DELETE FROM bets; DELETE FROM game_rounds;
  UPDATE system_settings SET value='false'::jsonb WHERE key='game.queue_enabled';
  v_round := open_round();
  SELECT * INTO v_gr FROM game_rounds WHERE id=v_round;
  IF v_gr.source='algorithm' AND v_gr.queue_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM crash_queue WHERE status='used' AND round_id=v_round)
    THEN v_log:=v_log||'Q9 queue-bypassed ok; ';
    ELSE v_ok:=false; v_log:=v_log||'Q9 FAIL src='||coalesce(v_gr.source,'-')||' qid='||coalesce(v_gr.queue_id::text,'-')||'; '; END IF;

  RAISE EXCEPTION 'AVIATOR_QUEUE_E2E|ok=%|%', v_ok, v_log;
END $T$;
