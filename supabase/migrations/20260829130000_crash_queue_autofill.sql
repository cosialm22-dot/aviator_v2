-- ============================================================================
-- Crash-queue autofill (Option A1): keep >= N pending crash points so admins can
-- SEE and CONTROL the next N outcomes. Points are generated with the SAME RNG
-- (_crash_point_from_seed) the organic algorithm uses, so queued outcomes are
-- statistically identical to organic ones (house edge + distribution preserved).
-- The admin merely gains foresight + the ability to override via existing RPCs.
--
-- Design notes:
--   * fn_queue_autofill() is SECURITY DEFINER, advisory-locked, and idempotent.
--     It tops the queue up to system_settings 'game.queue_autofill_min' (def 10),
--     honouring 'game.max_crash_point'. It never removes or reorders manual rows;
--     it only APPENDS after the current max(position).
--   * game_drive() calls it once per loop iteration (cheap no-op when full), so
--     the queue self-heals to >= N within one tick of being consumed/cleared.
--   * open_round() is UNCHANGED: it consumes the next pending row only when
--     'game.queue_enabled' is true. Autofill merely guarantees rows exist.
--   * Master switches: autofill runs only when game.driver_enabled is true; the
--     queue is only CONSUMED when game.queue_enabled is true. Both default safe.
-- ============================================================================

-- Depth knob (default 10). Insert only if the key does not already exist.
INSERT INTO public.system_settings(key, value)
SELECT 'game.queue_autofill_min', '10'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'game.queue_autofill_min');

-- ---------------------------------------------------------------------------
-- fn_queue_autofill(): append RNG-authentic pending points up to the target depth.
-- Returns the number of rows added. Safe to call concurrently (advisory lock).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_queue_autofill()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_min     int     := greatest(1, coalesce(_game_setting_num('game.queue_autofill_min'), 10)::int);
  v_maxcp   numeric := coalesce(_game_setting_num('game.max_crash_point'), 1000000);
  v_he      numeric := coalesce(_game_setting_num('game.house_edge_percent'), 18) / 100.0;
  v_pending int;
  v_pos     int;
  v_need    int;
  v_added   int := 0;
  v_cp      numeric;
BEGIN
  -- Serialize concurrent autofillers; a second caller is a cheap no-op.
  IF NOT pg_try_advisory_xact_lock(778813) THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_pending FROM crash_queue WHERE status = 'pending';
  v_need := v_min - v_pending;
  IF v_need <= 0 THEN
    RETURN 0;
  END IF;

  SELECT coalesce(max(position), 0) INTO v_pos FROM crash_queue;

  WHILE v_added < v_need LOOP
    -- Fresh random seed per point; nonce = position keeps inputs distinct.
    v_cp := _crash_point_from_seed(encode(gen_random_bytes(32), 'hex'), (v_pos + 1)::bigint, v_he);
    v_cp := least(greatest(v_cp, 1.00), v_maxcp);
    v_pos := v_pos + 1;
    INSERT INTO crash_queue(crash_multiplier, position, status, source, created_by)
    VALUES (v_cp, v_pos, 'pending', 'autofill', NULL);
    v_added := v_added + 1;
  END LOOP;

  RETURN v_added;
END
$function$;

-- ---------------------------------------------------------------------------
-- Wire autofill into the singleton driver so the queue self-maintains.
-- Only the body of game_drive changes: one extra PERFORM per loop iteration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.game_drive(IN p_seconds integer DEFAULT NULL::integer)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_cfg        record;
  v_deadline   timestamptz;
  v_sleep      double precision;
  v_i          integer := 0;
BEGIN
  SELECT * INTO v_cfg FROM public._driver_config();
  IF NOT v_cfg.enabled THEN
    RETURN;                              -- master switch off
  END IF;

  -- Singleton guard: if another worker holds the lock, exit immediately (cheap watchdog no-op).
  IF NOT pg_try_advisory_lock(778812) THEN
    RETURN;
  END IF;

  v_deadline := clock_timestamp()
              + make_interval(secs => coalesce(p_seconds, v_cfg.max_seconds));
  v_sleep    := greatest(v_cfg.tick_ms, 50) / 1000.0;

  LOOP
    EXIT WHEN clock_timestamp() >= v_deadline;

    -- Keep the crash queue topped up so admins can see/control the next N points.
    -- Cheap no-op when already at depth; isolated so a failure never kills the loop.
    BEGIN
      PERFORM public.fn_queue_autofill();
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'game_drive: autofill error: %', SQLERRM;
    END;

    -- isolate a bad tick (subtransaction) so the worker survives transient errors
    BEGIN
      PERFORM public.game_tick();
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'game_drive: tick error: %', SQLERRM;
    END;

    COMMIT;                              -- release xact advisory lock in game_tick + publish changes

    -- refresh control flags every ~5s (20 ticks) for live pause / retune
    v_i := v_i + 1;
    IF v_i % 20 = 0 THEN
      SELECT * INTO v_cfg FROM public._driver_config();
      EXIT WHEN NOT v_cfg.enabled;
      v_sleep := greatest(v_cfg.tick_ms, 50) / 1000.0;
    END IF;

    PERFORM pg_sleep(v_sleep);
  END LOOP;

  PERFORM pg_advisory_unlock(778812);
END
$procedure$;

-- Lock down the seeder: only the driver (postgres/service role) should run it.
REVOKE EXECUTE ON FUNCTION public.fn_queue_autofill() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_queue_autofill() FROM anon, authenticated;
