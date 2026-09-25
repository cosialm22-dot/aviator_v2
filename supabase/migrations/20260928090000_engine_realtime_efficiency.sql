-- ============================================================================
-- Engine + realtime efficiency (owner authorised engine changes, 2026-09-25). BUGLOG #18–#21.
--
-- 1. Game events go out as Supabase Realtime BROADCAST on one public topic "game"
--    (realtime.send), not postgres_changes. postgres_changes decodes WAL and checks RLS per
--    subscriber on a single thread (its WAL reader was the #1 statement by total time); broadcast
--    fans out a message we build ourselves, so no secret column can ever leak through it.
-- 2. Crash-time exploit (#17): start_round no longer copies crashes_at onto the public row.
-- 3. Bots cost nothing: no bot rows are written (they were ~80% of all row changes and WAL).
--    The board already showed real players only, so nothing visible changes.
-- 4. Event-driven driver: instead of waking every 250 ms, the driver sleeps until the next
--    event (betting closes, the next auto-cashout target, the crash instant, the next round).
--    Fewer wake-ups, and a crash is processed within a few ms of its instant instead of up to
--    250 ms late.
-- 5. server_time() for client clock sync; crash_queue retention; queue FK index.
-- Game rules, odds, money movements and settlement maths are unchanged.
-- ============================================================================
BEGIN;

-- ── 1. Broadcast of round and bet events ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rt_round_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime, pg_temp AS $$
BEGIN
  -- Only lifecycle changes (new round, take-off, crash) — not bookkeeping updates.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'id', NEW.id, 'round_number', NEW.round_number, 'status', NEW.status,
        'created_at', NEW.created_at, 'betting_ends_at', NEW.betting_ends_at,
        'started_at', NEW.started_at, 'crashed_at', NEW.crashed_at, 'seed_hash', NEW.seed_hash,
        -- revealed only once the round is over
        'crash_multiplier', CASE WHEN NEW.status = 'crashed' THEN NEW.crash_multiplier END,
        'server_seed',      CASE WHEN NEW.status = 'crashed' THEN NEW.server_seed END,
        'sent_at', clock_timestamp()),
      'round', 'game', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '_rt_round_event: %', SQLERRM;   -- never let a broadcast failure stop the game
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._rt_bet_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime, pg_temp AS $$
BEGIN
  IF NEW.is_bot THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.cashout_multiplier IS NOT DISTINCT FROM OLD.cashout_multiplier THEN RETURN NULL; END IF;
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'id', NEW.id, 'round_id', NEW.round_id, 'user_id', NEW.user_id, 'username', NEW.username,
        'avatar_color', NEW.avatar_color, 'amount', NEW.amount, 'auto_cashout', NEW.auto_cashout,
        'cashout_multiplier', NEW.cashout_multiplier, 'winnings', NEW.winnings, 'status', NEW.status,
        'slot', NEW.slot, 'is_bot', false, 'is_free', NEW.is_free, 'created_at', NEW.created_at),
      'bet', 'game', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '_rt_bet_event: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_rt_round_event ON public.game_rounds;
CREATE TRIGGER trg_rt_round_event AFTER INSERT OR UPDATE ON public.game_rounds
  FOR EACH ROW EXECUTE FUNCTION public._rt_round_event();
DROP TRIGGER IF EXISTS trg_rt_bet_event ON public.bets;
CREATE TRIGGER trg_rt_bet_event AFTER INSERT OR UPDATE ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public._rt_bet_event();

-- ── 2. Crash-time exploit: stop publishing crashes_at ───────────────────────
CREATE OR REPLACE FUNCTION public.start_round(p_round_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cp numeric; v_ms double precision; v_started timestamptz;
BEGIN
  UPDATE game_rounds SET status='flying', started_at=now()
   WHERE id=p_round_id AND status='waiting'
  RETURNING started_at INTO v_started;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT crash_point INTO v_cp FROM round_secrets WHERE round_id=p_round_id;
  v_ms := _time_ms_at_multiplier(v_cp);
  -- The crash instant stays secret (round_secrets only). It used to be copied to the public
  -- game_rounds row, which let anyone compute the crash point during the flight (BUGLOG #17).
  UPDATE round_secrets SET crashes_at = v_started + (v_ms || ' milliseconds')::interval
   WHERE round_id=p_round_id;
END $function$;
UPDATE public.game_rounds SET crashes_at = NULL WHERE crashes_at IS NOT NULL AND status IN ('waiting','flying');

-- ── 3. Bots cost nothing ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_round()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rn bigint; v_seed text; v_he numeric; v_cp numeric; v_betms numeric;
  v_round_id uuid; v_q crash_queue%rowtype; v_cfgver bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM game_rounds WHERE status IN ('waiting','flying')) THEN
    RETURN NULL;
  END IF;
  v_rn    := nextval('game_rounds_round_number_seq');
  v_seed  := encode(gen_random_bytes(32), 'hex');
  v_he    := coalesce(_game_setting_num('game.house_edge_percent'), 18) / 100.0;
  v_betms := coalesce(_game_setting_num('game.betting_ms'), 6000);
  v_cfgver := public.fn_game_config_version();

  IF coalesce((SELECT (value #>> '{}')::boolean FROM system_settings WHERE key='game.queue_enabled'), false) THEN
    SELECT * INTO v_q FROM crash_queue WHERE status='pending'
      ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN v_cp := v_q.crash_multiplier; END IF;
  END IF;
  IF v_cp IS NULL THEN
    v_cp := _crash_point_from_seed(v_seed, v_rn, v_he);
  END IF;

  INSERT INTO game_rounds(round_number, status, betting_ends_at, seed_hash, source, crash_multiplier, queue_id, config_version)
  VALUES (v_rn, 'waiting', now() + (v_betms || ' milliseconds')::interval,
          encode(digest(v_seed, 'sha256'), 'hex'),
          CASE WHEN v_q.id IS NOT NULL THEN 'queue' ELSE 'algorithm' END, NULL, v_q.id, v_cfgver)
  RETURNING id INTO v_round_id;

  INSERT INTO round_secrets(round_id, server_seed, crash_point)
  VALUES (v_round_id, v_seed, v_cp);

  IF v_q.id IS NOT NULL THEN
    UPDATE crash_queue SET status='used', used_at=now(), round_id=v_round_id WHERE id=v_q.id;
  END IF;
  -- No bot rows (they were ~80% of all writes and never shown on the board).
  RETURN v_round_id;
END $function$;

CREATE OR REPLACE FUNCTION public._settle_flight(p_round_id uuid, p_now_mult numeric, p_crash_point numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  rec record; w numeric; v_kind text;
BEGIN
  -- real players (credit wallet + ledger atomically; free bets pay net only)
  FOR rec IN
    SELECT * FROM bets
     WHERE round_id=p_round_id AND is_bot=false AND status='active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point
     FOR UPDATE
  LOOP
    w := _bet_credit(rec.amount, rec.auto_cashout, rec.is_free, v_maxpay);
    UPDATE bets SET status='won', cashout_multiplier=rec.auto_cashout, winnings=w WHERE id=rec.id;
    v_kind := CASE WHEN public.fn_is_marketer_account(rec.user_id) THEN 'demo' ELSE 'real' END;
    PERFORM public._wallet_move(rec.user_id, round(w*100)::bigint, v_kind, 'payout', 'bets', rec.id::text);
    INSERT INTO transactions(user_id,type,amount,description,status)
    VALUES (rec.user_id,'win',w,
      CASE WHEN rec.is_free THEN 'Free-bet auto cashout at ' ELSE 'Auto cashout at ' END
        || to_char(rec.auto_cashout,'FM999990.00')||'x','completed');
    IF v_kind = 'real' THEN PERFORM public._convert_cleared_bonuses(rec.user_id); END IF;
  END LOOP;
END $function$;

DELETE FROM public.bets WHERE is_bot;

-- ── 4. Event-driven driver ──────────────────────────────────────────────────
-- game_tick keeps every rule; it now also returns wake_at = the next instant anything can happen.
CREATE OR REPLACE FUNCTION public.game_tick()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype;
  v_now_mult numeric; v_post numeric; v_last_crash timestamptz; v_new uuid;
  v_next_auto numeric; v_wake timestamptz;
BEGIN
  IF NOT pg_try_advisory_xact_lock(778811) THEN
    RETURN jsonb_build_object('action','skipped_locked');
  END IF;

  SELECT * INTO v_round FROM game_rounds
   WHERE status IN ('waiting','flying') ORDER BY round_number DESC LIMIT 1;

  IF NOT FOUND THEN
    v_post := coalesce(_game_setting_num('game.post_crash_ms'), 3000);
    SELECT max(crashed_at) INTO v_last_crash FROM game_rounds WHERE status='crashed';
    IF v_last_crash IS NULL OR now() >= v_last_crash + (v_post || ' milliseconds')::interval THEN
      v_new := open_round();
      SELECT betting_ends_at INTO v_wake FROM game_rounds WHERE id = v_new;
      RETURN jsonb_build_object('action','opened','round_id',v_new,'wake_at',v_wake);
    END IF;
    RETURN jsonb_build_object('action','post_crash_pause','wake_at', v_last_crash + (v_post || ' milliseconds')::interval);
  END IF;

  IF v_round.status='waiting' THEN
    IF now() >= v_round.betting_ends_at THEN
      PERFORM start_round(v_round.id);
      SELECT crashes_at INTO v_wake FROM round_secrets WHERE round_id = v_round.id;
      -- first auto-cashout target may come before the crash
      SELECT min(auto_cashout) INTO v_next_auto FROM bets
       WHERE round_id = v_round.id AND is_bot = false AND status = 'active' AND auto_cashout IS NOT NULL;
      IF v_next_auto IS NOT NULL THEN
        v_wake := least(v_wake, now() + (_time_ms_at_multiplier(v_next_auto) || ' milliseconds')::interval);  -- started_at = now()
      END IF;
      RETURN jsonb_build_object('action','started','round_id',v_round.id,'wake_at',v_wake);
    END IF;
    RETURN jsonb_build_object('action','waiting','round_id',v_round.id,'wake_at',v_round.betting_ends_at);
  END IF;

  -- flying
  SELECT * INTO v_secret FROM round_secrets WHERE round_id=v_round.id;
  v_now_mult := _multiplier_at(extract(epoch from (clock_timestamp()-v_round.started_at))*1000.0);
  PERFORM _settle_flight(v_round.id, v_now_mult, v_secret.crash_point);
  IF clock_timestamp() >= v_secret.crashes_at OR v_now_mult >= v_secret.crash_point THEN
    PERFORM crash_round(v_round.id);
    v_post := coalesce(_game_setting_num('game.post_crash_ms'), 3000);
    RETURN jsonb_build_object('action','crashed','round_id',v_round.id,'crash_point',v_secret.crash_point,
                              'wake_at', clock_timestamp() + (v_post || ' milliseconds')::interval);
  END IF;
  v_wake := v_secret.crashes_at;
  SELECT min(auto_cashout) INTO v_next_auto FROM bets
   WHERE round_id = v_round.id AND is_bot = false AND status = 'active' AND auto_cashout IS NOT NULL;
  IF v_next_auto IS NOT NULL THEN
    v_wake := least(v_wake, v_round.started_at + (_time_ms_at_multiplier(v_next_auto) || ' milliseconds')::interval);
  END IF;
  RETURN jsonb_build_object('action','flying','round_id',v_round.id,'multiplier',v_now_mult,'wake_at',v_wake);
END $function$;

CREATE OR REPLACE PROCEDURE public.game_drive(IN p_seconds integer DEFAULT NULL::integer)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_cfg        record;
  v_deadline   timestamptz;
  v_tick       double precision;   -- upper bound on any sleep, seconds
  v_res        jsonb;
  v_wake       timestamptz;
  v_sleep      double precision;
  v_cfg_at     timestamptz := clock_timestamp();
  v_action     text;
BEGIN
  SELECT * INTO v_cfg FROM public._driver_config();
  IF NOT v_cfg.enabled THEN RETURN; END IF;
  IF NOT pg_try_advisory_lock(778812) THEN RETURN; END IF;   -- singleton

  v_deadline := clock_timestamp() + make_interval(secs => coalesce(p_seconds, v_cfg.max_seconds));
  v_tick     := greatest(v_cfg.tick_ms, 50) / 1000.0;
  PERFORM public.fn_queue_autofill();
  COMMIT;

  LOOP
    EXIT WHEN clock_timestamp() >= v_deadline;
    v_res := NULL;
    BEGIN
      v_res := public.game_tick();
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'game_drive: tick error: %', SQLERRM;
    END;
    v_action := v_res->>'action';
    -- Keep the crash queue topped up once per round (it only drains when a round opens).
    IF v_action IN ('opened','crashed') THEN
      BEGIN
        PERFORM public.fn_queue_autofill();
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'game_drive: autofill error: %', SQLERRM;
      END;
    END IF;
    COMMIT;   -- publish this tick (and its broadcasts)

    -- refresh control flags every ~5 s for live pause / retune
    IF clock_timestamp() - v_cfg_at > interval '5 seconds' THEN
      SELECT * INTO v_cfg FROM public._driver_config();
      EXIT WHEN NOT v_cfg.enabled;
      v_tick := greatest(v_cfg.tick_ms, 50) / 1000.0;
      v_cfg_at := clock_timestamp();
    END IF;

    -- Sleep until the next event (+2 ms so the multiplier has reached it), never longer than
    -- one second (so config changes and admin actions are picked up), never shorter than 3 ms.
    -- Unknown state (e.g. a skipped or failed tick) → one tick.
    v_wake := (v_res->>'wake_at')::timestamptz;
    v_sleep := CASE WHEN v_wake IS NULL THEN v_tick
                    ELSE extract(epoch FROM (v_wake - clock_timestamp())) + 0.002 END;
    v_sleep := least(greatest(v_sleep, 0.003), 1.0);
    v_sleep := least(v_sleep, greatest(extract(epoch FROM (v_deadline - clock_timestamp())), 0.003));
    PERFORM pg_sleep(v_sleep);
    -- Start a fresh transaction AFTER sleeping: game_tick stamps started_at / crashed_at /
    -- betting_ends_at with now() (= transaction start), which would otherwise be the time
    -- before the sleep — up to a full sleep early.
    COMMIT;
  END LOOP;

  PERFORM pg_advisory_unlock(778812);
END
$procedure$;

-- ── 5. Clock sync, retention, indexes ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.server_time()
RETURNS double precision LANGUAGE sql VOLATILE AS $$ SELECT extract(epoch FROM clock_timestamp()) * 1000.0 $$;
REVOKE ALL ON FUNCTION public.server_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.server_time() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_data_retention()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_days   int := coalesce((SELECT (value #>> '{}')::int FROM system_settings WHERE key='game.retention_days'), 90);
  v_cut    timestamptz := now() - make_interval(days => v_days);
  v_rounds int; v_queue int;
BEGIN
  UPDATE crash_queue SET round_id = NULL
    WHERE round_id IN (SELECT id FROM game_rounds WHERE created_at < v_cut);
  UPDATE free_bets SET used_round_id = NULL
    WHERE used_round_id IN (SELECT id FROM game_rounds WHERE created_at < v_cut);
  -- cascades to bets + round_secrets (ON DELETE CASCADE)
  WITH del AS (DELETE FROM game_rounds WHERE created_at < v_cut RETURNING 1)
  SELECT count(*) INTO v_rounds FROM del;
  -- used crash points were never removed, so the queue grew forever
  WITH del AS (DELETE FROM crash_queue WHERE status = 'used' AND used_at < v_cut
                 AND NOT EXISTS (SELECT 1 FROM game_rounds g WHERE g.queue_id = crash_queue.id) RETURNING 1)
  SELECT count(*) INTO v_queue FROM del;
  RETURN jsonb_build_object('deleted_rounds', v_rounds, 'deleted_queue', v_queue, 'cutoff', v_cut);
END $function$;

-- lock down the new internal functions (default grants were removed in 20260928080000)
REVOKE ALL ON FUNCTION public._rt_round_event(), public._rt_bet_event(), public.game_tick(), public.start_round(uuid),
  public.open_round(), public._settle_flight(uuid, numeric, numeric), public.run_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_tick(), public.run_data_retention() TO service_role;

COMMIT;
