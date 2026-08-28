-- =====================================================================
-- 20260828040000_p1c_site_game_config.sql
-- Borrow P1c: per-site game configuration (invest254 mig 0046 analogue).
--
-- Introduces `site_game_config` (one row per brand: economy knobs in CENTS),
-- an immutable `site_game_config_versions` history (so a position can always be
-- re-priced under the version live when it opened), a feasibility CHECK (min
-- house-edge floor from invest254's audit lesson, mig 0075), a version-bump +
-- pg_notify('site_game_config_changed', site_id) trigger, and `_site_setting_num`
-- (per-site config reader with global fallback).
--
-- FOUNDATION / NON-BREAKING: the engine still reads the GLOBAL system_settings
-- for now; a later phase (engine multiplex) switches the round loop to read
-- `_site_setting_num(round.site_id, ...)`. Seeded from the live system_settings
-- (KES→cents), with house_edge floored to the safe minimum (current global is 0
-- = 100% RTP, which is flagged unsafe and must be set per-brand before wiring).
--
-- Auth model for tenancy = option (a): keep Supabase Auth's single global identity;
-- `site_id` scopes each person's data/wallet per brand. No per-site identity uniques.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Per-site game economy (money knobs in integer cents)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_game_config (
  site_id            uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  house_edge         numeric NOT NULL DEFAULT 0.05,      -- fraction; RTP = 1 - house_edge
  min_bet_cents      bigint  NOT NULL DEFAULT 5000,      -- KES 50
  max_bet_cents      bigint  NOT NULL DEFAULT 10000000,  -- KES 100,000
  max_crash_point    numeric NOT NULL DEFAULT 20,
  max_payout_cents   bigint  NOT NULL DEFAULT 50000000,  -- KES 500,000
  betting_ms         integer NOT NULL DEFAULT 6000,
  post_crash_ms      integer NOT NULL DEFAULT 3000,
  tick_ms            integer NOT NULL DEFAULT 250,
  bots_min           integer NOT NULL DEFAULT 15,
  bots_max           integer NOT NULL DEFAULT 30,
  min_withdrawal_cents        bigint NOT NULL DEFAULT 10000,   -- KES 100
  auto_approve_threshold_cents bigint NOT NULL DEFAULT 500000, -- KES 5,000
  config_version     bigint  NOT NULL DEFAULT 1,
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Feasibility (invest254 audit lesson): min house-edge floor + sane bounds.
  CONSTRAINT site_cfg_feasible CHECK (
    house_edge >= 0.02 AND house_edge <= 0.98
    AND min_bet_cents > 0 AND min_bet_cents <= max_bet_cents
    AND max_crash_point > 1
    AND max_payout_cents > 0
    AND betting_ms > 0 AND post_crash_ms >= 0 AND tick_ms >= 50
    AND bots_min >= 0 AND bots_min <= bots_max
  )
);

-- ---------------------------------------------------------------------
-- 2) Immutable version history (re-pricing / crash recovery per version)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_game_config_versions (
  site_id        uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  config_version bigint NOT NULL,
  snapshot       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, config_version)
);

CREATE OR REPLACE FUNCTION public._config_versions_immutable() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'site_game_config_versions is immutable'; END $$;
DROP TRIGGER IF EXISTS trg_cfg_versions_immutable ON public.site_game_config_versions;
CREATE TRIGGER trg_cfg_versions_immutable
  BEFORE UPDATE OR DELETE ON public.site_game_config_versions
  FOR EACH ROW EXECUTE FUNCTION public._config_versions_immutable();

-- ---------------------------------------------------------------------
-- 3) On any config write: bump version, snapshot to history, notify engine.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_site_game_config_after_write() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    -- bump only when an economy field actually changed
    IF row(NEW.house_edge,NEW.min_bet_cents,NEW.max_bet_cents,NEW.max_crash_point,
           NEW.max_payout_cents,NEW.betting_ms,NEW.post_crash_ms,NEW.tick_ms,
           NEW.bots_min,NEW.bots_max,NEW.min_withdrawal_cents,NEW.auto_approve_threshold_cents)
       IS DISTINCT FROM
       row(OLD.house_edge,OLD.min_bet_cents,OLD.max_bet_cents,OLD.max_crash_point,
           OLD.max_payout_cents,OLD.betting_ms,OLD.post_crash_ms,OLD.tick_ms,
           OLD.bots_min,OLD.bots_max,OLD.min_withdrawal_cents,OLD.auto_approve_threshold_cents) THEN
      NEW.config_version := OLD.config_version + 1;
      NEW.updated_at := now();
    END IF;
  END IF;
  INSERT INTO public.site_game_config_versions(site_id, config_version, snapshot)
    VALUES (NEW.site_id, NEW.config_version, to_jsonb(NEW))
    ON CONFLICT (site_id, config_version) DO NOTHING;
  PERFORM pg_notify('site_game_config_changed', NEW.site_id::text);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_site_game_config_after_write ON public.site_game_config;
CREATE TRIGGER trg_site_game_config_after_write
  BEFORE INSERT OR UPDATE ON public.site_game_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_site_game_config_after_write();

-- ---------------------------------------------------------------------
-- 4) Seed the default site's config from the live system_settings
--    (KES→cents; house_edge floored to the safe minimum).
-- ---------------------------------------------------------------------
INSERT INTO public.site_game_config (
  site_id, house_edge, min_bet_cents, max_bet_cents, max_crash_point, max_payout_cents,
  betting_ms, post_crash_ms, tick_ms, bots_min, bots_max,
  min_withdrawal_cents, auto_approve_threshold_cents)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  greatest(0.02, coalesce(_game_setting_num('game.house_edge_percent'),5)/100.0),
  round(coalesce(_game_setting_num('game.min_bet'),50)*100)::bigint,
  round(coalesce(_game_setting_num('game.max_bet'),100000)*100)::bigint,
  coalesce(_game_setting_num('game.max_crash_point'),20),
  round(coalesce(_game_setting_num('game.max_payout'),500000)*100)::bigint,
  coalesce(_game_setting_num('game.betting_ms'),6000)::int,
  coalesce(_game_setting_num('game.post_crash_ms'),3000)::int,
  coalesce(_game_setting_num('game.tick_ms'),250)::int,
  coalesce(_game_setting_num('game.bots_min'),15)::int,
  coalesce(_game_setting_num('game.bots_max'),30)::int,
  round(coalesce(_game_setting_num('finance.min_withdrawal'),100)*100)::bigint,
  round(coalesce(_game_setting_num('finance.auto_approve_threshold'),5000)*100)::bigint
ON CONFLICT (site_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5) Per-site config reader (numeric), with GLOBAL fallback so callers can
--    migrate incrementally. Keys mirror the system_settings 'game.*'/'finance.*'
--    names; cents columns are returned as KES to match legacy call sites.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._site_setting_num(p_site uuid, p_key text)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE c public.site_game_config%rowtype; v numeric;
BEGIN
  SELECT * INTO c FROM public.site_game_config WHERE site_id = p_site;
  IF FOUND THEN
    v := CASE p_key
      WHEN 'game.house_edge_percent' THEN c.house_edge*100
      WHEN 'game.min_bet'            THEN c.min_bet_cents/100.0
      WHEN 'game.max_bet'            THEN c.max_bet_cents/100.0
      WHEN 'game.max_crash_point'    THEN c.max_crash_point
      WHEN 'game.max_payout'         THEN c.max_payout_cents/100.0
      WHEN 'game.betting_ms'         THEN c.betting_ms
      WHEN 'game.post_crash_ms'      THEN c.post_crash_ms
      WHEN 'game.tick_ms'            THEN c.tick_ms
      WHEN 'game.bots_min'           THEN c.bots_min
      WHEN 'game.bots_max'           THEN c.bots_max
      WHEN 'finance.min_withdrawal'  THEN c.min_withdrawal_cents/100.0
      WHEN 'finance.auto_approve_threshold' THEN c.auto_approve_threshold_cents/100.0
      ELSE NULL END;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  RETURN public._game_setting_num(p_key);   -- global fallback
END $$;

COMMIT;
