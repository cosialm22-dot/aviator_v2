-- ============================================================================
-- Admin read-path for the LIVE round's crash point (Crash Control redesign).
--
-- The admin "Now" card must show the EXACT crash point of the round in play,
-- not a client-side estimate. Crash points are sealed in round_secrets, which
-- is RLS-locked to the service role. This SECURITY DEFINER RPC exposes ONLY the
-- current waiting/flying round's crash point to operators (_is_admin), joining
-- to crash_queue when the round was sourced from the queue.
--
-- Safe: read-only, admin-gated, returns at most one row, reveals nothing about
-- future algorithm rounds (only the in-flight round whose outcome is already
-- committed in round_secrets). Additive & dormant until called.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_current_round()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_round game_rounds%rowtype;
  v_cp    numeric;
BEGIN
  IF NOT public._is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO v_round FROM public.game_rounds
   WHERE status IN ('waiting','flying')
   ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('round', NULL);
  END IF;

  -- Prefer the sealed crash point; fall back to the queued value it was sourced from.
  SELECT crash_point INTO v_cp FROM public.round_secrets WHERE round_id = v_round.id;
  IF v_cp IS NULL AND v_round.queue_id IS NOT NULL THEN
    SELECT crash_multiplier INTO v_cp FROM public.crash_queue WHERE id = v_round.queue_id;
  END IF;

  RETURN jsonb_build_object(
    'round', jsonb_build_object(
      'id',              v_round.id,
      'round_number',    v_round.round_number,
      'status',          v_round.status,
      'started_at',      v_round.started_at,
      'betting_ends_at', v_round.betting_ends_at,
      'source',          v_round.source,
      'queue_id',        v_round.queue_id,
      'crash_point',     v_cp
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.admin_current_round() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_current_round() TO authenticated, service_role;
