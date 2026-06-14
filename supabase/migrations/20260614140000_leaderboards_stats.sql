-- ============================================================================
-- AVIATOR V2 - PLAYER LEADERBOARDS + PERSONAL STATISTICS
-- ============================================================================
-- Server-side aggregation for the player-facing "Top" leaderboard and a
-- player's own stats. Read-only over the existing bets/profiles data; bots are
-- always excluded. Rolling windows: day = last 24h, week = last 7d, all = all
-- time. Metrics: winnings (sum of payouts on wins), profit (net = payouts -
-- stakes), multiplier (best winning cashout).
--
-- Additive/idempotent. Leaderboard is public (also granted to anon) so it can
-- be shown pre-login as social proof; personal stats require auth.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_period text DEFAULT 'day',
  p_metric text DEFAULT 'winnings',
  p_limit  integer DEFAULT 20
)
RETURNS TABLE(rank integer, user_id uuid, username text, avatar_color text, value numeric, rounds integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_since timestamptz := CASE lower(coalesce(p_period,'day'))
                           WHEN 'week' THEN now() - interval '7 days'
                           WHEN 'all'  THEN NULL
                           ELSE now() - interval '24 hours'
                         END;
  v_metric text := lower(coalesce(p_metric,'winnings'));
  v_limit  int := greatest(1, least(coalesce(p_limit,20), 100));
BEGIN
  RETURN QUERY
  WITH agg AS (
    SELECT b.user_id,
           sum(b.winnings) FILTER (WHERE b.status = 'won')                 AS total_win,
           sum(coalesce(b.winnings,0)) - sum(b.amount)                     AS profit,
           max(b.cashout_multiplier) FILTER (WHERE b.status = 'won')       AS max_mult,
           count(*) FILTER (WHERE b.status IN ('won','lost'))              AS played
    FROM bets b
    WHERE b.is_bot = false AND b.user_id IS NOT NULL
      AND (v_since IS NULL OR b.created_at >= v_since)
    GROUP BY b.user_id
  ),
  scored AS (
    SELECT a.user_id, a.played,
           CASE v_metric WHEN 'profit' THEN a.profit
                         WHEN 'multiplier' THEN a.max_mult
                         ELSE a.total_win END AS val
    FROM agg a
  )
  SELECT row_number() OVER (ORDER BY s.val DESC NULLS LAST)::int AS rank,
         s.user_id, p.username, p.avatar_color, round(s.val, 2) AS value, s.played::int AS rounds
  FROM scored s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.val IS NOT NULL
    AND (v_metric = 'profit' OR s.val > 0)   -- profit may be negative; others must be positive
  ORDER BY s.val DESC NULLS LAST
  LIMIT v_limit;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT
    count(*) FILTER (WHERE status IN ('won','lost'))            AS played,
    count(*) FILTER (WHERE status = 'won')                      AS wins,
    count(*) FILTER (WHERE status = 'lost')                     AS losses,
    coalesce(sum(amount) FILTER (WHERE status IN ('won','lost')),0) AS wagered,
    coalesce(sum(winnings) FILTER (WHERE status = 'won'),0)     AS won,
    coalesce(sum(coalesce(winnings,0)) FILTER (WHERE status IN ('won','lost')),0)
      - coalesce(sum(amount) FILTER (WHERE status IN ('won','lost')),0) AS net,
    coalesce(max(winnings) FILTER (WHERE status = 'won'),0)     AS biggest_win,
    coalesce(max(cashout_multiplier) FILTER (WHERE status = 'won'),0) AS biggest_mult
  INTO r
  FROM bets WHERE user_id = v_uid AND is_bot = false;

  RETURN jsonb_build_object(
    'played', r.played, 'wins', r.wins, 'losses', r.losses,
    'win_rate', CASE WHEN r.played > 0 THEN round(r.wins::numeric / r.played * 100, 1) ELSE 0 END,
    'total_wagered', r.wagered, 'total_won', r.won, 'net_profit', r.net,
    'biggest_win', r.biggest_win, 'biggest_multiplier', r.biggest_mult
  );
END $$;

REVOKE ALL ON FUNCTION public.get_leaderboard(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_stats()                     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text,text,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_stats()                     TO authenticated, service_role;

COMMIT;
