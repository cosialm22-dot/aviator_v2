-- ============================================================================
-- AVIATOR V2 - PHASE 2 (ADDENDUM): ADMIN RPCs
-- ============================================================================
-- After the lockdown, admins (who are 'authenticated') also lose direct write
-- access to the money/game tables. These SECURITY DEFINER RPCs are the
-- sanctioned admin write paths; each verifies the caller is an admin.
--   • admin_adjust_balance  - manual wallet credit/debit (logged as 'adjustment')
--   • admin_force_crash     - end the current flying round NOW (reuses crash_round
--                             => fair: crashes at committed point, reveals seed)
--   • admin_recover_zombies - crash any stuck flying rounds (safety net)
-- Additive & dormant; safe to apply during staging.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));
$$;

-- ---- admin_adjust_balance ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_delta numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bal numeric; v_new numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'INVALID_DELTA'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT balance INTO v_bal FROM wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  v_new := v_bal + p_delta;
  IF v_new < 0 THEN RAISE EXCEPTION 'NEGATIVE_BALANCE'; END IF;

  UPDATE wallets SET balance = v_new, updated_at = now() WHERE user_id = p_user_id;
  INSERT INTO transactions(user_id, type, amount, description, status)
  VALUES (p_user_id, 'adjustment', p_delta, 'Admin: ' || p_reason, 'completed');
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'balance_adjust', 'user', p_user_id::text,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'new_balance', v_new));

  RETURN jsonb_build_object('balance', v_new, 'delta', p_delta);
END $$;

-- ---- admin_force_crash ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_force_crash(p_round_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(778811);  -- serialise with the game-loop driver
  v_id := coalesce(p_round_id, (SELECT id FROM game_rounds WHERE status = 'flying'
                                ORDER BY round_number DESC LIMIT 1));
  IF v_id IS NULL THEN RAISE EXCEPTION 'NO_FLYING_ROUND'; END IF;
  PERFORM crash_round(v_id);  -- fair: crashes at committed crash_point, reveals seed
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id)
  VALUES (auth.uid(), 'force_crash', 'game', v_id::text);
  RETURN jsonb_build_object('round_id', v_id, 'crashed', true);
END $$;

-- ---- admin_recover_zombies --------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_recover_zombies(p_older_than_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_n integer := 0;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(778811);
  FOR v_id IN
    SELECT id FROM game_rounds
     WHERE status = 'flying' AND started_at < now() - make_interval(secs => p_older_than_seconds)
  LOOP
    PERFORM crash_round(v_id);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO admin_audit_log(admin_id, action, target_type, details)
  VALUES (auth.uid(), 'recover_zombies', 'game', jsonb_build_object('count', v_n));
  RETURN jsonb_build_object('recovered', v_n);
END $$;

-- ---- grants: admins are 'authenticated'; each fn self-checks _is_admin() ----
REVOKE ALL ON FUNCTION public._is_admin()                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_balance(uuid,numeric,text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_force_crash(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_recover_zombies(integer)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_admin()                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_force_crash(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_recover_zombies(integer)          TO authenticated, service_role;
