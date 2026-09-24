-- ============================================================================
-- Database memory pressure (BUGLOG #16).
--
-- The instance (0.5 GB RAM) was swapping constantly: ~160 pages/s swapped in, ~335 major page
-- faults/s and ~4 MiB/s of disk reads around the clock, with ~500 MB of the 1 GB swap in use.
-- The main cause was two unindexed engine lookups that read whole tables many times a minute:
--   SELECT max(crashed_at) FROM game_rounds WHERE status='crashed'   (game_tick, every tick of the
--        post-crash pause: ~1.35M full scans so far, 76.7 billion rows read, 5,357 pages each)
--   SELECT coalesce(max(position),0) FROM crash_queue                  (fn_queue_autofill, every round)
-- Both tables grow by ~4,400 rows a day, so the cost kept rising whatever else was tuned.
-- The indexes below turn each into a 5-page index lookup. No engine code is changed.
--
-- On production the indexes were built with CREATE INDEX CONCURRENTLY (no write lock) before
-- this file was recorded; IF NOT EXISTS makes the file a no-op there and correct on a fresh DB.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_game_rounds_crashed_at ON public.game_rounds (crashed_at DESC) WHERE status = 'crashed';
CREATE INDEX IF NOT EXISTS idx_crash_queue_position ON public.crash_queue (position DESC);
-- Player "Top" tab: highest multipliers in a period (was a sort over every crashed round).
CREATE INDEX IF NOT EXISTS idx_game_rounds_top_crashed ON public.game_rounds (crash_multiplier DESC) WHERE status = 'crashed';

BEGIN;

-- The Deposits screen read the last reconcile run with a join + sort over the whole (bloated)
-- cron.job_run_details table; under memory pressure that hit the 120 s statement timeout.
-- Newest run by primary key instead: a few index pages.
SELECT public._patch_fn('public.fn_admin_megapay_overview(uuid)',
  $x$  SELECT d.status, d.start_time INTO v_last
    FROM cron.job_run_details d JOIN cron.job j USING (jobid)
   WHERE j.jobname = 'megapay_reconcile' ORDER BY d.start_time DESC LIMIT 1;$x$,
  $x$  SELECT d.status, d.start_time INTO v_last
    FROM cron.job_run_details d
   WHERE d.jobid = (SELECT jobid FROM cron.job WHERE jobname = 'megapay_reconcile')
   ORDER BY d.runid DESC LIMIT 1;$x$);

-- Runs that never recorded an end time (killed sessions, restarts) were never pruned.
CREATE OR REPLACE FUNCTION public.prune_cron_logs()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
DECLARE v_days int := coalesce((SELECT (value #>> '{}')::int FROM system_settings WHERE key='ops.cron_log_retention_days'), 2);
BEGIN
  DELETE FROM cron.job_run_details WHERE coalesce(end_time, start_time) < now() - make_interval(days => v_days);
END $function$;

-- The game driver loops until game.driver_max_seconds (3600) but the platform statement timeout is
-- 120 s, so every run was killed mid-loop: ~720 "canceling statement due to statement timeout"
-- errors a day, each cancelling whatever tick was in flight. Ending the loop at 110 s lets it
-- finish cleanly; the 15-second cron watchdog starts the next run exactly as before.
UPDATE public.system_settings SET value = '110'::jsonb, updated_at = now()
 WHERE key = 'game.driver_max_seconds' AND (value #>> '{}')::int > 110;

COMMIT;
