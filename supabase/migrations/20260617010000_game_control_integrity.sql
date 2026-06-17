-- ============================================================================
-- AVIATOR V2 - GAME CONTROL INTEGRITY (crash queue + force crash)
-- ============================================================================
-- Fixes the operator Game Control surface, which had three problems:
--
--   1. THE CRASH QUEUE WAS BROKEN. The client wrote/read column `crash_point`,
--      but the table column is `crash_multiplier` (what the engine consumes in
--      open_round). Every "Add to queue" therefore failed silently and the
--      queue was always empty. We add server-authoritative, validated, audited
--      RPCs that write the correct columns, and switch the client to them.
--
--   2. WEAK GUARD ON A RIGGING SURFACE. crash_queue is how an operator pre-sets
--      game outcomes - the most integrity-sensitive table in the system. anon
--      and authenticated held INSERT/UPDATE/DELETE/TRUNCATE grants (RLS blocked
--      non-admins, but the grants are needless attack surface). We revoke all
--      client DML and route writes exclusively through super-admin RPCs. The
--      queue is a game-integrity control, so - like its on/off switch
--      (game.queue_enabled, already super-admin only) - populating it is now
--      super-admin only too.
--
--   3. "FORCE CRASH" WAS MISLEADING. The UI promised "crashes at the current
--      multiplier", but admin_force_crash called crash_round(), which settles at
--      the round's COMMITTED point (always higher than the live value on a flying
--      round). The board would show e.g. 50x while every active bet "lost". We
--      make it a true emergency stop: crash at the live multiplier, bust active
--      bets, reveal the seed, and flag the round as an override for transparency.
--
-- Idempotent and safe to re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Transparency columns: mark rounds an operator manually stopped so that
--    provable-fairness verifiers can see the committed point was overridden.
-- ----------------------------------------------------------------------------
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS is_override     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text;

-- ----------------------------------------------------------------------------
-- 1. Lock down the rigging table: no direct client DML, ever. Reads stay (RLS
--    already restricts SELECT to admins); writes go through the RPCs below.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.crash_queue FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.crash_queue FROM authenticated;

-- ----------------------------------------------------------------------------
-- 2. Queue management RPCs (super-admin only, validated, audited). Crash points
--    must be in [1.00, game.max_crash_point]; position auto-appends.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_queue_add(p_crash numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_max numeric; v_pos int; v_cp numeric; v_id uuid;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_max := coalesce(_game_setting_num('game.max_crash_point'), 1000000);
  IF p_crash IS NULL OR p_crash < 1.00 OR p_crash > v_max THEN
    RAISE EXCEPTION 'INVALID_RANGE: crash point must be between 1.00 and %', v_max;
  END IF;
  v_cp := floor(p_crash * 100) / 100;
  SELECT coalesce(max(position), 0) + 1 INTO v_pos FROM crash_queue;
  INSERT INTO crash_queue(crash_multiplier, position, status, source, created_by)
  VALUES (v_cp, v_pos, 'pending', 'manual', auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'queue_add', 'game', v_id::text, jsonb_build_object('crash_multiplier', v_cp, 'position', v_pos));
  RETURN jsonb_build_object('id', v_id, 'position', v_pos, 'crash_multiplier', v_cp);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_queue_add_batch(p_points numeric[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_max numeric; v_pos int; v_cp numeric; v_batch uuid := gen_random_uuid(); v_n int := 0;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_points IS NULL OR array_length(p_points, 1) IS NULL THEN RAISE EXCEPTION 'EMPTY_BATCH'; END IF;
  v_max := coalesce(_game_setting_num('game.max_crash_point'), 1000000);
  SELECT coalesce(max(position), 0) INTO v_pos FROM crash_queue;
  FOREACH v_cp IN ARRAY p_points LOOP
    IF v_cp IS NULL OR v_cp < 1.00 OR v_cp > v_max THEN
      RAISE EXCEPTION 'INVALID_RANGE: each crash point must be between 1.00 and %', v_max;
    END IF;
    v_pos := v_pos + 1;
    INSERT INTO crash_queue(crash_multiplier, position, status, source, created_by, batch_id)
    VALUES (floor(v_cp * 100) / 100, v_pos, 'pending', 'manual', auth.uid(), v_batch);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'queue_batch_add', 'game', v_batch::text, jsonb_build_object('count', v_n));
  RETURN jsonb_build_object('count', v_n, 'batch_id', v_batch);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_queue_remove(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cp numeric;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  DELETE FROM crash_queue WHERE id = p_id AND status = 'pending' RETURNING crash_multiplier INTO v_cp;
  IF v_cp IS NULL THEN RAISE EXCEPTION 'NOT_REMOVABLE'; END IF;  -- missing or already used
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'queue_remove', 'game', p_id::text, jsonb_build_object('crash_multiplier', v_cp));
  RETURN jsonb_build_object('removed', true);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_queue_clear()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  WITH del AS (DELETE FROM crash_queue WHERE status = 'pending' RETURNING 1)
  SELECT count(*) INTO v_n FROM del;
  INSERT INTO admin_audit_log(admin_id, action, target_type, details)
  VALUES (auth.uid(), 'queue_clear', 'game', jsonb_build_object('count', v_n));
  RETURN jsonb_build_object('cleared', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.admin_queue_add(numeric)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_queue_add_batch(numeric[])  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_queue_remove(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_queue_clear()               FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_queue_add(numeric)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_queue_add_batch(numeric[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_queue_remove(uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_queue_clear()              TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Honest emergency stop. Crash the live round at its CURRENT multiplier (not
--    the committed point), bust active bets, reveal the seed, and flag the round
--    as an operator override so provable-fairness checks stay transparent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_force_crash(p_round_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid; v_started timestamptz; v_seed text; v_committed numeric;
  v_now numeric; v_tot_bets numeric; v_tot_pay numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(778811);  -- serialise with the game-loop driver
  SELECT id, started_at INTO v_id, v_started
    FROM game_rounds
   WHERE status = 'flying' AND (p_round_id IS NULL OR id = p_round_id)
   ORDER BY round_number DESC LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'NO_FLYING_ROUND'; END IF;

  SELECT server_seed, crash_point INTO v_seed, v_committed FROM round_secrets WHERE round_id = v_id;
  -- Live multiplier right now; never above the committed point (can't fabricate a
  -- higher outcome), never below 1.00.
  v_now := _multiplier_at(extract(epoch FROM (now() - coalesce(v_started, now()))) * 1000.0);
  v_now := least(greatest(v_now, 1.00), coalesce(v_committed, v_now));

  UPDATE bets SET status = 'lost' WHERE round_id = v_id AND status = 'active';
  SELECT coalesce(sum(amount), 0), coalesce(sum(winnings) FILTER (WHERE status = 'won'), 0)
    INTO v_tot_bets, v_tot_pay
  FROM bets WHERE round_id = v_id;

  UPDATE game_rounds
     SET status = 'crashed', crashed_at = now(), crash_multiplier = v_now,
         server_seed = v_seed, total_bets_amount = v_tot_bets, total_payouts = v_tot_pay,
         is_override = true, override_reason = 'admin_force_crash'
   WHERE id = v_id AND status = 'flying';

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'force_crash', 'game', v_id::text,
          jsonb_build_object('stopped_at', v_now, 'committed', v_committed));
  RETURN jsonb_build_object('round_id', v_id, 'crashed', true, 'stopped_at', v_now);
END $function$;

COMMIT;
