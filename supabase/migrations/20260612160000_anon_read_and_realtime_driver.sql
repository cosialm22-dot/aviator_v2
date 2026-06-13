-- ============================================================================
-- AVIATOR V2 - Public spectator reads + in-DB 250ms game driver
-- ----------------------------------------------------------------------------
-- 1. Allow logged-out (anon) clients to READ the live round + bet board so the
--    plane and live bets render before sign-in. Writes remain RPC-only; the
--    hidden crash point (round_secrets) stays locked and crash_multiplier is
--    NULL until reveal, so provable fairness is unaffected.
-- 2. Drive the server-authoritative round lifecycle (game_tick) at a 250ms
--    cadence entirely in-database via pg_cron - no Edge Function / pg_net
--    dependency. game_tick() is idempotent (advisory xact lock), so the small
--    overlap between consecutive burst runs is safe.
-- ============================================================================

-- ---- 1. Public (anon) read access -----------------------------------------
DROP POLICY IF EXISTS "Public can read game rounds" ON public.game_rounds;
CREATE POLICY "Public can read game rounds" ON public.game_rounds
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public can read bets" ON public.bets;
CREATE POLICY "Public can read bets" ON public.bets
  FOR SELECT TO anon USING (true);

-- ---- 2. In-DB 250ms driver -------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Bursts game_tick() every 250ms for ~p_seconds, committing each tick so
-- Realtime broadcasts round/bet changes immediately. Returns when the window
-- elapses; pg_cron restarts it (keepalive / self-healing).
CREATE OR REPLACE PROCEDURE public.game_drive(p_seconds integer DEFAULT 11)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_seconds);
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() >= v_deadline;
    PERFORM public.game_tick();
    COMMIT;
    PERFORM pg_sleep(0.25);
  END LOOP;
END;
$$;

-- Retire the Phase-4 Edge Function keepalive driver so this in-DB 250ms driver
-- is the SOLE round driver. Without this, a fresh `supabase db reset` would
-- schedule BOTH 'aviator-game-loop' (Phase 4) and 'aviator-drive', producing
-- competing round drivers. Idempotent: a no-op if it was never scheduled
-- (the live DB already runs only 'aviator-drive').
SELECT cron.unschedule('aviator-game-loop')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aviator-game-loop');

-- Re-schedule idempotently. An 11s burst every 10s gives continuous coverage
-- with a small, safe overlap (advisory lock dedupes concurrent ticks).
SELECT cron.unschedule('aviator-drive')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aviator-drive');

SELECT cron.schedule('aviator-drive', '10 seconds', $$ CALL public.game_drive(11); $$);
