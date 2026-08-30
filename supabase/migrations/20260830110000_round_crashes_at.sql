-- ============================================================================
-- Smooth-crash support (Option 2): expose the round's crash INSTANT at start.
-- ----------------------------------------------------------------------------
-- The client animates the multiplier from started_at with no crash knowledge,
-- so it overshoots the true crash point during the Realtime latency gap and then
-- snaps back. To let the client climb smoothly to EXACTLY the crash point and
-- stop, we stamp game_rounds.crashes_at when the round starts. The client then
-- animates toward that instant and clamps there (no overshoot), landing exactly
-- on crash_multiplier on the 'crashed' event.
--
-- Provably fair: server_seed / crash_point stay sealed in round_secrets until
-- crash. Only the crash TIMING is revealed (derivable from crashes_at). This is
-- the accepted Option-2 tradeoff for a perfectly smooth stop.
-- ============================================================================

ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS crashes_at timestamptz;

CREATE OR REPLACE FUNCTION public.start_round(p_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cp numeric; v_ms double precision; v_started timestamptz;
BEGIN
  UPDATE game_rounds SET status='flying', started_at=now()
   WHERE id=p_round_id AND status='waiting'
  RETURNING started_at INTO v_started;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT crash_point INTO v_cp FROM round_secrets WHERE round_id=p_round_id;
  v_ms := _time_ms_at_multiplier(v_cp);
  UPDATE round_secrets SET crashes_at = v_started + (v_ms || ' milliseconds')::interval
   WHERE round_id=p_round_id;
  -- Expose the crash instant on the round row so clients can animate to it.
  UPDATE game_rounds SET crashes_at = v_started + (v_ms || ' milliseconds')::interval
   WHERE id=p_round_id;
END $function$;
