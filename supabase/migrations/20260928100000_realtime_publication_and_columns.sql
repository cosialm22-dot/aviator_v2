-- ============================================================================
-- Second step of the realtime move (clients now use the "game" broadcast topic):
--   * game_rounds and bets leave the supabase_realtime publication, so Realtime no longer
--     decodes and RLS-checks every round/bet change for every subscriber (its WAL reader was
--     the #1 statement by total time).
--   * Clients can no longer SELECT the round's secret/operator columns at all: crashes_at
--     (crash instant, BUGLOG #17), is_override / override_reason / source / queue_id (how the
--     crash point was chosen) and config_version. The engine and admin RPCs are SECURITY
--     DEFINER and unaffected.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='game_rounds') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.game_rounds;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bets') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.bets;
  END IF;
END $$;

REVOKE SELECT ON public.game_rounds FROM anon, authenticated;
GRANT SELECT (id, round_number, crash_multiplier, status, started_at, crashed_at, created_at,
              total_bets_amount, total_payouts, betting_ends_at, seed_hash, server_seed, site_id)
  ON public.game_rounds TO anon, authenticated;

COMMIT;
