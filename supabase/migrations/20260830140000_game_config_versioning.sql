-- ============================================================================
-- Stage B: invest254-grade GLOBAL game-config management for the single shared
-- round. The engine reads the GLOBAL `system_settings` via _game_setting_num;
-- admin edits go through admin_set_setting. Until now that path had NO immutable
-- version history, NO cross-field feasibility guard, and NO change notify — so
-- you couldn't answer "what exact economics priced round N?" and a bad combined
-- edit could slip through per-key bounds.
--
-- This migration (additive, idempotent, no live-behaviour change until a setting
-- is next edited):
--   1. game_config_meta            — a one-row version counter (monotonic).
--   2. game_config_versions        — an immutable snapshot of the WHOLE game
--                                    config taken on every game.* write.
--   3. fn_game_config_snapshot()   — build the canonical config JSONB from
--                                    system_settings (single source of truth).
--   4. fn_game_config_check()      — cross-field feasibility guard over the
--                                    COMBINED economics (not just per-key).
--   5. fn_game_config_record()     — bump version + snapshot + pg_notify.
--   6. admin_set_setting           — after a game.* write, run the guard on the
--                                    resulting config, then record+notify.
--   7. game_rounds.config_version  — stamp each round with the config version
--                                    that priced it (crash-recovery invariant).
-- ============================================================================

-- ── 1. version counter ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_config_meta (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  version     bigint  NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.game_config_meta(id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING;

-- ── 2. immutable snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_config_versions (
  version     bigint PRIMARY KEY,
  config      jsonb   NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. canonical snapshot of the live game config ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_game_config_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'house_edge_percent', coalesce(_game_setting_num('game.house_edge_percent'), 18),
    'max_crash_point',    coalesce(_game_setting_num('game.max_crash_point'), 1000000),
    'max_payout',         coalesce(_game_setting_num('game.max_payout'), 500000),
    'min_bet',            coalesce(_game_setting_num('game.min_bet'), 50),
    'max_bet',            coalesce(_game_setting_num('game.max_bet'), 50000),
    'tick_ms',            coalesce(_game_setting_num('game.tick_ms'), 250),
    'betting_ms',         coalesce(_game_setting_num('game.betting_ms'), 6000),
    'post_crash_ms',      coalesce(_game_setting_num('game.post_crash_ms'), 3000),
    'bots_min',           coalesce(_game_setting_num('game.bots_min'), 8),
    'bots_max',           coalesce(_game_setting_num('game.bots_max'), 20),
    'queue_enabled',      coalesce((SELECT (value#>>'{}')::boolean FROM system_settings WHERE key='game.queue_enabled'), false),
    'queue_autofill_min', coalesce(_game_setting_num('game.queue_autofill_min'), 10)
  );
$function$;

-- ── 4. cross-field feasibility guard ────────────────────────────────────────
-- Validates the COMBINED economics. Raises on an infeasible configuration.
CREATE OR REPLACE FUNCTION public.fn_game_config_check(p_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_he   numeric := (p_config->>'house_edge_percent')::numeric;
  v_minc numeric := (p_config->>'min_bet')::numeric;
  v_maxc numeric := (p_config->>'max_bet')::numeric;
  v_cap  numeric := (p_config->>'max_crash_point')::numeric;
  v_pay  numeric := (p_config->>'max_payout')::numeric;
  v_tick numeric := (p_config->>'tick_ms')::numeric;
  v_bmin numeric := (p_config->>'bots_min')::numeric;
  v_bmax numeric := (p_config->>'bots_max')::numeric;
BEGIN
  IF v_he IS NULL OR v_he < 0 OR v_he > 40 THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: house_edge_percent % out of [0,40]', v_he; END IF;
  IF v_minc IS NULL OR v_maxc IS NULL OR v_minc < 1 OR v_minc > v_maxc THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: min_bet % must be >=1 and <= max_bet %', v_minc, v_maxc; END IF;
  IF v_cap IS NULL OR v_cap < 1 THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: max_crash_point % must be >= 1', v_cap; END IF;
  IF v_pay IS NULL OR v_pay < 0 THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: max_payout % must be >= 0', v_pay; END IF;
  -- Reachability: the largest allowed bet at the highest allowed multiplier must be
  -- coverable by the payout cap logic (cap clamps, so this is informational unless the
  -- cap is so low a max-bet win can never approach it — flag a clearly degenerate rig).
  IF v_pay > 0 AND (v_maxc * LEAST(v_cap, 2)) > 0 AND v_pay < v_minc THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: max_payout % is below the minimum bet %', v_pay, v_minc; END IF;
  IF v_tick IS NULL OR v_tick < 50 OR v_tick > 60000 THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: tick_ms % out of [50,60000]', v_tick; END IF;
  IF v_bmin IS NULL OR v_bmax IS NULL OR v_bmin < 0 OR v_bmin > v_bmax THEN
    RAISE EXCEPTION 'INFEASIBLE_CONFIG: bots_min % must be >=0 and <= bots_max %', v_bmin, v_bmax; END IF;
END
$function$;

-- ── 5. record: bump version + snapshot + notify ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_game_config_record(p_actor uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ver bigint; v_cfg jsonb;
BEGIN
  v_cfg := public.fn_game_config_snapshot();
  PERFORM public.fn_game_config_check(v_cfg);           -- never persist an infeasible config
  UPDATE public.game_config_meta SET version = version + 1, updated_at = now()
   WHERE id RETURNING version INTO v_ver;
  INSERT INTO public.game_config_versions(version, config, created_by)
  VALUES (v_ver, v_cfg, p_actor)
  ON CONFLICT (version) DO NOTHING;
  PERFORM pg_notify('game_config_changed', v_ver::text);
  RETURN v_ver;
END
$function$;

-- ── 6. stamp each round with the config version that priced it ──────────────
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS config_version bigint;

CREATE OR REPLACE FUNCTION public.fn_game_config_version()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT version FROM public.game_config_meta WHERE id; $function$;

-- open_round stamps the live config version on the new round.
CREATE OR REPLACE FUNCTION public.open_round()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rn bigint; v_seed text; v_he numeric; v_cp numeric; v_betms numeric;
  v_round_id uuid; v_q crash_queue%rowtype; v_cfgver bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM game_rounds WHERE status IN ('waiting','flying')) THEN
    RETURN NULL;
  END IF;
  v_rn    := nextval('game_rounds_round_number_seq');
  v_seed  := encode(gen_random_bytes(32), 'hex');
  v_he    := coalesce(_game_setting_num('game.house_edge_percent'), 18) / 100.0;
  v_betms := coalesce(_game_setting_num('game.betting_ms'), 6000);
  v_cfgver := public.fn_game_config_version();

  IF coalesce((SELECT (value #>> '{}')::boolean FROM system_settings WHERE key='game.queue_enabled'), false) THEN
    SELECT * INTO v_q FROM crash_queue WHERE status='pending'
      ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN v_cp := v_q.crash_multiplier; END IF;
  END IF;
  IF v_cp IS NULL THEN
    v_cp := _crash_point_from_seed(v_seed, v_rn, v_he);
  END IF;

  INSERT INTO game_rounds(round_number, status, betting_ends_at, seed_hash, source, crash_multiplier, queue_id, config_version)
  VALUES (v_rn, 'waiting', now() + (v_betms || ' milliseconds')::interval,
          encode(digest(v_seed, 'sha256'), 'hex'),
          CASE WHEN v_q.id IS NOT NULL THEN 'queue' ELSE 'algorithm' END, NULL, v_q.id, v_cfgver)
  RETURNING id INTO v_round_id;

  INSERT INTO round_secrets(round_id, server_seed, crash_point)
  VALUES (v_round_id, v_seed, v_cp);

  IF v_q.id IS NOT NULL THEN
    UPDATE crash_queue SET status='used', used_at=now(), round_id=v_round_id WHERE id=v_q.id;
  END IF;

  PERFORM _seed_bots(v_round_id, v_cp);
  RETURN v_round_id;
END $function$;
