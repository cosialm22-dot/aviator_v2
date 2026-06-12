-- ============================================================================
-- AVIATOR V2 — PHASE 3: REALTIME PUBLICATION FOR THE SHARED GAME
-- ============================================================================
-- Publishes game_rounds (round lifecycle the client renders) and bets (live
-- board). Idempotent. round_secrets is intentionally NOT published (hidden).
-- ============================================================================
DO $rt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='game_rounds') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
  END IF;
END $rt$;
