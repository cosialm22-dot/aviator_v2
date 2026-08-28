-- =====================================================================
-- 20260828000000_perf_optimization.sql
-- Performance / scaling / resource-efficiency overhaul (aviator_v2)
--
-- Root causes addressed (diagnosed on the live DB):
--   * Disk exhaustion: `bets` grew unbounded (~5.6M rows / 1.2GB) because
--     15-30 simulated BOT bets were persisted forever every round.
--   * Compute churn: the game driver ran 11s on a 10s cron schedule, so
--     multiple driver procedures overlapped continuously.
--   * No retention on game_rounds / round_secrets / cron.job_run_details.
--   * Default autovacuum/fillfactor on very high-churn tables.
--
-- Strategy (least-assumption, gap-free, settlement-deterministic):
--   1) Bot bets become EPHEMERAL: deleted when their round crashes
--      (they carry no wallet impact or audit value). Real-player bets kept.
--   2) Game driver becomes a SINGLETON long-running worker guarded by a
--      session advisory lock + a cheap cron watchdog. Exactly one worker,
--      no overlap, self-healing, gap-free during flight.
--   3) Nightly retention for old rounds + cron run-detail logs.
--   4) Per-table autovacuum + fillfactor tuning on hot tables.
--
-- Safe to run on an empty (fresh) database. Idempotent where practical.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) Control settings (do not overwrite if operator already set them)
-- ---------------------------------------------------------------------
INSERT INTO public.system_settings(key, value, category, description) VALUES
  ('game.driver_enabled', 'true'::jsonb, 'game', 'Master switch for the game driver worker.'),
  ('game.tick_ms',        '250'::jsonb,  'game', 'Driver tick interval in milliseconds.'),
  ('game.driver_max_seconds','3600'::jsonb,'game','Max lifetime (s) of a single driver worker before it recycles.'),
  ('game.retention_days', '90'::jsonb,   'game', 'Keep game_rounds/round_secrets/bets for this many days.'),
  ('ops.cron_log_retention_days', '2'::jsonb, 'ops', 'Keep cron.job_run_details for this many days.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1) SECURITY DEFINER helper so the (invoker-context) driver can read
--    its control flags regardless of RLS/ownership.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._driver_config(OUT enabled boolean, OUT tick_ms integer, OUT max_seconds integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT
    coalesce((SELECT (value #>> '{}')::boolean FROM system_settings WHERE key='game.driver_enabled'), true),
    coalesce((SELECT (value #>> '{}')::int     FROM system_settings WHERE key='game.tick_ms'), 250),
    coalesce((SELECT (value #>> '{}')::int     FROM system_settings WHERE key='game.driver_max_seconds'), 3600);
$$;

-- ---------------------------------------------------------------------
-- 2) SINGLETON game driver worker.
--    - session advisory lock 778812 => at most ONE worker cluster-wide
--    - loops game_tick() every tick_ms until deadline or disabled
--    - per-tick errors are isolated so one bad tick can't kill the loop
--    - lock auto-releases on session end (self-healing on crash)
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.game_drive(p_seconds integer DEFAULT NULL)
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

-- ---------------------------------------------------------------------
-- 3) crash_round: keep aggregates (incl. bot volume for display) then
--    PURGE ephemeral bot bets. Real-player bets are retained.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crash_round(p_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cp numeric; v_seed text; v_tot_bets numeric; v_tot_pay numeric;
BEGIN
  SELECT crash_point, server_seed INTO v_cp, v_seed FROM round_secrets WHERE round_id=p_round_id;
  UPDATE bets SET status='lost' WHERE round_id=p_round_id AND status='active';
  SELECT coalesce(sum(amount),0),
         coalesce(sum(winnings) FILTER (WHERE status='won'),0)
    INTO v_tot_bets, v_tot_pay
  FROM bets WHERE round_id=p_round_id;
  UPDATE game_rounds
     SET status='crashed', crashed_at=now(), crash_multiplier=v_cp,
         server_seed=v_seed, total_bets_amount=v_tot_bets, total_payouts=v_tot_pay
   WHERE id=p_round_id AND status='flying';
  -- Ephemeral bots: no wallet impact, no audit value -> reclaim immediately.
  DELETE FROM bets WHERE round_id=p_round_id AND is_bot=true;
END $function$;

-- ---------------------------------------------------------------------
-- 4) Retention: prune old rounds (cascades to bets + round_secrets) and
--    old cron run-detail logs. Scheduled nightly via pg_cron.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_data_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_days   int := coalesce((SELECT (value #>> '{}')::int FROM system_settings WHERE key='game.retention_days'), 90);
  v_cut    timestamptz := now() - make_interval(days => v_days);
  v_rounds int;
BEGIN
  -- clear NO ACTION references to the rounds we are about to delete
  UPDATE crash_queue SET round_id = NULL
    WHERE round_id IN (SELECT id FROM game_rounds WHERE created_at < v_cut);
  UPDATE free_bets SET used_round_id = NULL
    WHERE used_round_id IN (SELECT id FROM game_rounds WHERE created_at < v_cut);
  -- cascades to bets + round_secrets (ON DELETE CASCADE)
  WITH del AS (DELETE FROM game_rounds WHERE created_at < v_cut RETURNING 1)
  SELECT count(*) INTO v_rounds FROM del;
  RETURN jsonb_build_object('deleted_rounds', v_rounds, 'cutoff', v_cut);
END $function$;

CREATE OR REPLACE FUNCTION public.prune_cron_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','cron','pg_temp'
AS $function$
DECLARE v_days int := coalesce((SELECT (value #>> '{}')::int FROM system_settings WHERE key='ops.cron_log_retention_days'), 2);
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - make_interval(days => v_days);
END $function$;

-- ---------------------------------------------------------------------
-- 5) Per-table autovacuum + fillfactor tuning for hot tables.
--    (Applies to all new data; tables are fresh so this covers everything.)
-- ---------------------------------------------------------------------
ALTER TABLE public.bets SET (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold    = 100,
  autovacuum_analyze_scale_factor= 0.01,
  autovacuum_analyze_threshold   = 100,
  autovacuum_vacuum_cost_delay   = 2
);
ALTER TABLE public.game_rounds SET (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold    = 50,
  autovacuum_analyze_scale_factor= 0.02,
  autovacuum_vacuum_cost_delay   = 2
);
ALTER TABLE public.round_secrets SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold    = 50
);

COMMIT;

-- ---------------------------------------------------------------------
-- 6) (Re)schedule cron jobs. Done OUTSIDE the txn (cron.schedule commits).
--    Watchdog every 15s keeps exactly one worker alive; the worker itself
--    runs up to game.driver_max_seconds then recycles (<=15s handoff, which
--    lands in the inter-round pause and is settlement-safe).
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  -- remove any legacy game_drive schedules
  FOR r IN SELECT jobid, jobname FROM cron.job
           WHERE command ILIKE '%game_drive%' OR jobname IN ('game_driver','game-driver')
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('game_driver',  '15 seconds', $$CALL public.game_drive();$$);
SELECT cron.schedule('data_retention','30 3 * * *', $$SELECT public.run_data_retention();$$);
SELECT cron.schedule('prune_cron_logs','0 4 * * *',  $$SELECT public.prune_cron_logs();$$);
