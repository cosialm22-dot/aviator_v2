-- ============================================================================
-- AVIATOR V2 - PHASE 2 (PRE): RE-CAPTURE OF DRIFTED PROVABLY-FAIR SCAFFOLDING
-- ============================================================================
-- These objects already exist in the live database but were applied directly
-- (not via a committed migration). This file re-captures them IDEMPOTENTLY so
-- the schema is reproducible from supabase/migrations alone. Applying it to the
-- existing database is a no-op. Must run BEFORE 20260612120000_phase2_server_engine.sql.
-- ============================================================================

-- --- system_settings: numeric reader -----------------------------------------
CREATE OR REPLACE FUNCTION public._game_setting_num(p_key text)
 RETURNS numeric LANGUAGE sql STABLE AS $function$
  select (value #>> '{}')::numeric from system_settings where key = p_key
$function$;

-- --- multiplier curve m(t)=exp(0.00009*ms) (must match client gameEngine.ts) --
CREATE OR REPLACE FUNCTION public._multiplier_at(p_ms double precision)
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $function$
  select case
           when p_ms <= 0 then 1.00
           else greatest(1.00, trunc( exp(0.00009::double precision * p_ms) * 100 ) / 100 )
         end::numeric
$function$;

-- --- inverse curve: elapsed ms to reach a given multiplier --------------------
CREATE OR REPLACE FUNCTION public._time_ms_at_multiplier(p_mult numeric)
 RETURNS double precision LANGUAGE sql IMMUTABLE AS $function$
  select case when p_mult <= 1.00 then 0.0
              else ln(p_mult::double precision) / 0.00009::double precision end
$function$;

-- --- parametric provably-fair crash point: P(crash>=x) = (1-edge)/x -----------
-- Instant-bust probability = edge. Constant house edge for every cashout target.
CREATE OR REPLACE FUNCTION public._crash_point_from_seed(p_seed text, p_nonce bigint, p_house_edge numeric)
 RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $function$
declare
  v_hash text;
  v_u    double precision;
  v_he   double precision := p_house_edge::double precision;   -- fraction, e.g. 0.18
  v_cp   numeric;
  v_max  numeric;
begin
  -- sha256(server_seed || ':' || nonce). u in [0,1) from the first 52 bits,
  -- assembled as (28-bit high)*2^24 + (24-bit low) through numeric to avoid the
  -- bit(52)->bigint MSB-truncation pitfall (verified empirically).
  v_hash := encode(digest(p_seed || ':' || p_nonce::text, 'sha256'), 'hex');
  v_u := (
            ( ('x' || substr(v_hash,1,7))::bit(28)::int )::numeric * 16777216   -- *2^24
          + ( ('x' || substr(v_hash,8,6))::bit(24)::int )::numeric
         )::double precision / 4503599627370496.0;                              -- /2^52
  if v_u < v_he then
    return 1.00;                              -- instant bust, probability = house edge
  end if;
  v_cp  := trunc( ((1.0 - v_he) / (1.0 - v_u)) * 100 ) / 100;   -- P(crash>=x)=(1-he)/x
  v_max := coalesce(_game_setting_num('game.max_crash_point'), 1000000);
  return least(greatest(v_cp, 1.00), v_max);
end
$function$;

-- --- round_secrets: hidden per-round seed + crash point (FORCE RLS, no policies)
CREATE TABLE IF NOT EXISTS public.round_secrets (
  round_id    uuid PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
  server_seed text    NOT NULL,
  crash_point numeric NOT NULL CHECK (crash_point >= 1.00),
  crashes_at  timestamptz
);
ALTER TABLE public.round_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_secrets FORCE ROW LEVEL SECURITY;   -- only SECURITY DEFINER fns may touch it

-- --- game_rounds: provably-fair columns --------------------------------------
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS seed_hash       text,         -- sha256(server_seed), published at 'waiting'
  ADD COLUMN IF NOT EXISTS server_seed     text,         -- revealed at 'crashed'
  ADD COLUMN IF NOT EXISTS betting_ends_at timestamptz;  -- end of the betting window

-- --- v2 game settings (insert if absent; never overwrite admin-tuned values) --
INSERT INTO public.system_settings (key, value, category, description) VALUES
  ('game.betting_ms',          '6000',   'game', 'Betting window duration (ms).'),
  ('game.post_crash_ms',       '3000',   'game', 'Pause after crash before next round (ms).'),
  ('game.growth_rate_per_ms',  '0.00009','game', 'Multiplier growth: m(t)=exp(rate*ms). MUST match client gameEngine.ts.'),
  ('game.house_edge_percent',  '18',     'game', 'House edge percent (target RTP = 100 - this). Band 18-20.'),
  ('game.max_crash_point',     '1000000','game', 'Upper bound on generated crash point.'),
  ('game.max_payout',          '500000', 'game', 'Per-bet payout cap (KES).'),
  ('game.bots_min',            '8',      'game', 'Minimum simulated bots per round.'),
  ('game.bots_max',            '20',     'game', 'Maximum simulated bots per round.')
ON CONFLICT (key) DO NOTHING;
