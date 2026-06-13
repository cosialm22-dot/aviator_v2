-- ============================================================================
-- AVIATOR V2 - PHASE 2: SERVER-AUTHORITATIVE ENGINE
-- ============================================================================
-- Adds the money RPCs, round lifecycle, provably-fair reveal, server-side bots,
-- and integrity invariants. ALL OBJECTS ARE ADDITIVE AND DORMANT: nothing here
-- changes client-visible behaviour until the frontend (Phase 5) calls the RPCs
-- and the driver (Phase 4) calls game_tick(). Safe to apply to live production.
--
-- Crash model: PARAMETRIC (Gate A = "P"). The single source of truth is
-- public._crash_point_from_seed() -> P(crash >= x) = (1 - edge)/x, giving a
-- constant configurable house edge (game.house_edge_percent) for every cashout
-- target. The system_settings band percentages are analytics-only and unused here.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. ROUND NUMBERING - assign a monotonic round_number (was NULL on all rows)
-- ----------------------------------------------------------------------------
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM game_rounds WHERE round_number IS NULL
)
UPDATE game_rounds g SET round_number = o.rn
FROM ordered o WHERE g.id = o.id;

DO $$
DECLARE v_max bigint;
BEGIN
  SELECT coalesce(max(round_number),0) INTO v_max FROM game_rounds;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='game_rounds_round_number_seq') THEN
    EXECUTE 'CREATE SEQUENCE game_rounds_round_number_seq';
  END IF;
  PERFORM setval('game_rounds_round_number_seq', v_max + 1, false);
END $$;

ALTER TABLE game_rounds ALTER COLUMN round_number SET DEFAULT nextval('game_rounds_round_number_seq');
ALTER SEQUENCE game_rounds_round_number_seq OWNED BY game_rounds.round_number;
ALTER TABLE game_rounds ALTER COLUMN round_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS game_rounds_round_number_key ON game_rounds(round_number);

-- ----------------------------------------------------------------------------
-- 1. RELAX crash_multiplier - must be HIDDEN during flight (provably-fair).
--    Populated only at crash time by crash_round(); NULL while waiting/flying.
-- ----------------------------------------------------------------------------
ALTER TABLE game_rounds ALTER COLUMN crash_multiplier DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. INTEGRITY INVARIANTS (defence-in-depth behind the RPCs).
--    Added NOT VALID then VALIDATEd so a violating legacy row surfaces loudly
--    instead of silently aborting the whole migration.
-- ----------------------------------------------------------------------------
DO $cons$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bets_amount_positive') THEN
    ALTER TABLE bets ADD CONSTRAINT bets_amount_positive CHECK (amount > 0) NOT VALID;
    ALTER TABLE bets VALIDATE CONSTRAINT bets_amount_positive;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_balance_nonneg') THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_balance_nonneg CHECK (balance >= 0) NOT VALID;
    ALTER TABLE wallets VALIDATE CONSTRAINT wallets_balance_nonneg;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_type_chk') THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_chk
      CHECK (type IN ('deposit','withdrawal','bet','win','adjustment','bonus','refund')) NOT VALID;
    ALTER TABLE transactions VALIDATE CONSTRAINT transactions_type_chk;
  END IF;
END $cons$;

-- ----------------------------------------------------------------------------
-- 3. BOT NAME POOL (mirrors src/lib/botSimulator.ts, 140 names)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bot_name_pool()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'pilot_guru', 'joseXX', 'king_aviator', 'cash_ninja', 'risk_taker254', 'flyboy_ke',
    'jet_daddy', 'sky_boss', 'turbo_wanjiku', 'million_mode', 'early_bird', 'crash_hunter',
    'big_risk', 'quick_hands', 'wanjiku_pro', 'kamau_bets', 'odhiambo_x', 'akinyi99',
    'kariuki_fx', 'muthoni_wins', 'otieno_fly', 'wambui_cash', 'njoroge77', 'adhiambo_g',
    'kiprotich_k', 'chebet_ace', 'mutua_big', 'ndungu_x', 'awuor88', 'gitau_bet',
    'wairimu_w', 'kipchoge_7', 'cherono_99', 'wafula_pro', 'bossman_ke', 'nairobiflyer',
    'mombasaace', 'nakuru_king', 'eldoret_fx', 'thika_pilot', 'luckydude99', 'highroller_x',
    'moonshot_g', 'fearlessbettor', 'godfrey_x', 'double_up7', 'papiChulo22', 'rico_suave',
    'darkwing_bet', 'sonic_cashout', 'hyperspeed', 'jokerbet77', 'ghostrider_9', 'blazing_5x',
    'alpha_bet', 'xXxtreme', 'bet_machine', 'predator_x', 'legend_fly', 'money_glitch',
    'stonks_up', 'yolo_bet', 'turbopilot', 'crashproof', 'neverlose99', 'diamond_hands',
    'moon_chaser', 'rocket_man7', 'fastcash88', 'bigbet_boss', 'jose_aviator', 'el_capitano',
    'papi_fly', 'rico_bet', 'diego_x99', 'mario_wins', 'carlos_fx', 'joseXXX',
    'pablito_b', 'ramiro99', 'ericsson_k', 'maxpower_9', 'viktorr', 'stefano88',
    'lukash_bet', 'vlad_flies', 'ivan_crash', 'andrei_x', 'borris_bet', 'mika_wins',
    'KSH_killer', 'tenplex_man', 'fifty50x', 'go_big_bro', 'nonstop_fly', 'fearnocrash',
    'allin_mode', 'last_second', 'clutch_king', 'timing_god', 'never2late', 'onemorebet',
    'addicted_w', 'justone_more', 'cant_stop_x', 'sensei_bet', 'pilot_zero', 'skyman77',
    'ace_of_bets', 'the_gambler', 'foxyrider', 'sneaky_cash', 'shadow_fly', 'silentwin',
    'ghostcash', 'anon_player', 'mystery_x', 'unknownpro', 'player_zero', 'no_name_bet',
    'ultra_bet', 'mega_risk', 'super_fly99', 'hyper_cash', 'turbo_mode', 'speed_demon',
    'flash_bet', 'blitz_win', 'thunder_fly', 'storm_cash', 'dragon_bet', 'phoenix_x',
    'lion_king_k', 'eagle_fly', 'hawk_cash', 'leopard99', 'cheetah_bet', 'viper_x',
    'cobra_cash', 'mamba_wins'
  ]::text[];
$$;

-- ----------------------------------------------------------------------------
-- 4. _seed_bots - server-side bot liquidity for a round.
--    Mirrors botSimulator.ts distributions; count from game.bots_min/max.
--    Bots never touch wallets/transactions (is_bot=true, user_id=NULL).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_bots(p_round_id uuid, p_crash_point numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_min int := coalesce(_game_setting_num('game.bots_min'), 8)::int;
  v_max int := coalesce(_game_setting_num('game.bots_max'), 20)::int;
  v_n   int;
  v_names  text[] := _bot_name_pool();
  v_colors text[] := ARRAY['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6',
                           '#a855f7','#ec4899','#14b8a6','#f59e0b','#84cc16','#0ea5e9',
                           '#d946ef','#fb923c','#4ade80']::text[];
  v_amounts numeric[] := ARRAY[50,100,200,500,1000,2000,5000,10000]::numeric[];
  v_weights int[]     := ARRAY[20,25,20,15,10,5,4,1]::int[];
  v_wtot int := 100;
  i int; j int; rr double precision; acc int; amt numeric; tgt numeric; nm text;
BEGIN
  IF v_max < v_min THEN v_max := v_min; END IF;
  v_n := v_min + floor(random() * (v_max - v_min + 1))::int;
  FOR i IN 1..v_n LOOP
    -- weighted bet amount
    rr := random() * v_wtot; acc := 0; amt := 100;
    FOR j IN 1..array_length(v_amounts,1) LOOP
      acc := acc + v_weights[j];
      IF rr <= acc THEN amt := v_amounts[j]; EXIT; END IF;
    END LOOP;
    -- cashout target distribution (botSimulator.randomCashoutMultiplier)
    rr := random();
    tgt := CASE
      WHEN rr < 0.10 THEN NULL
      WHEN rr < 0.38 THEN 1.20 + random()*0.40
      WHEN rr < 0.68 THEN 1.60 + random()*0.60
      WHEN rr < 0.84 THEN 2.20 + random()*1.80
      WHEN rr < 0.94 THEN 4.00 + random()*8.00
      ELSE              12.00 + random()*28.00
    END;
    IF tgt IS NOT NULL THEN
      tgt := floor(tgt*100)/100;
      IF tgt >= p_crash_point THEN tgt := NULL; END IF;  -- holds past crash -> loses
    END IF;
    nm := v_names[1 + floor(random()*array_length(v_names,1))::int] || '_' || (floor(random()*900)+10)::text;
    INSERT INTO bets(round_id, user_id, username, avatar_color, amount, auto_cashout, status, is_bot)
    VALUES (p_round_id, NULL, nm, v_colors[1+floor(random()*array_length(v_colors,1))::int], amt, tgt, 'active', true);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. open_round - create the next shared round in 'waiting'.
--    Generates server_seed, commits seed_hash, stores hidden crash_point.
--    Honours game.queue_enabled (admin preset crashes) else parametric PF.
--    Idempotent guard: never opens if a live round already exists.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_round()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_rn bigint; v_seed text; v_he numeric; v_cp numeric; v_betms numeric;
  v_round_id uuid; v_q crash_queue%rowtype;
BEGIN
  IF EXISTS (SELECT 1 FROM game_rounds WHERE status IN ('waiting','flying')) THEN
    RETURN NULL;
  END IF;
  v_rn    := nextval('game_rounds_round_number_seq');
  v_seed  := encode(gen_random_bytes(32), 'hex');
  v_he    := coalesce(_game_setting_num('game.house_edge_percent'), 18) / 100.0;
  v_betms := coalesce(_game_setting_num('game.betting_ms'), 6000);

  IF coalesce((SELECT (value #>> '{}')::boolean FROM system_settings WHERE key='game.queue_enabled'), false) THEN
    SELECT * INTO v_q FROM crash_queue WHERE status='pending'
      ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN v_cp := v_q.crash_multiplier; END IF;
  END IF;
  IF v_cp IS NULL THEN
    v_cp := _crash_point_from_seed(v_seed, v_rn, v_he);
  END IF;

  INSERT INTO game_rounds(round_number, status, betting_ends_at, seed_hash, source, crash_multiplier, queue_id)
  VALUES (v_rn, 'waiting', now() + (v_betms || ' milliseconds')::interval,
          encode(digest(v_seed, 'sha256'), 'hex'),
          CASE WHEN v_q.id IS NOT NULL THEN 'queue' ELSE 'algorithm' END, NULL, v_q.id)
  RETURNING id INTO v_round_id;

  INSERT INTO round_secrets(round_id, server_seed, crash_point)
  VALUES (v_round_id, v_seed, v_cp);

  IF v_q.id IS NOT NULL THEN
    UPDATE crash_queue SET status='used', used_at=now(), round_id=v_round_id WHERE id=v_q.id;
  END IF;

  PERFORM _seed_bots(v_round_id, v_cp);
  RETURN v_round_id;
END $$;

-- ----------------------------------------------------------------------------
-- 6. start_round - waiting -> flying; pins started_at and computes crashes_at.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_round(p_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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
END $$;

-- ----------------------------------------------------------------------------
-- 7. _settle_flight - auto-cashouts during flight (real players + bots).
--    Executes AT the auto_cashout target (fair, tick-rate independent), only
--    when target <= current multiplier AND target < crash_point.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_flight(p_round_id uuid, p_now_mult numeric, p_crash_point numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  rec record; w numeric;
BEGIN
  -- bots (no wallet impact)
  UPDATE bets SET status='won', cashout_multiplier=auto_cashout,
         winnings = least(floor(amount*auto_cashout*100)/100, v_maxpay)
   WHERE round_id=p_round_id AND is_bot=true AND status='active'
     AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point;
  -- real players (credit wallet + ledger atomically)
  FOR rec IN
    SELECT * FROM bets
     WHERE round_id=p_round_id AND is_bot=false AND status='active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point
     FOR UPDATE
  LOOP
    w := least(floor(rec.amount*rec.auto_cashout*100)/100, v_maxpay);
    UPDATE bets SET status='won', cashout_multiplier=rec.auto_cashout, winnings=w WHERE id=rec.id;
    UPDATE wallets SET balance=balance+w, updated_at=now() WHERE user_id=rec.user_id;
    INSERT INTO transactions(user_id,type,amount,description,status)
    VALUES (rec.user_id,'win',w,'Auto cashout at '||to_char(rec.auto_cashout,'FM999990.00')||'x','completed');
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. crash_round - reveal seed, settle losers, write totals.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crash_round(p_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_cp numeric; v_seed text; v_tot_bets numeric; v_tot_pay numeric;
BEGIN
  SELECT crash_point, server_seed INTO v_cp, v_seed FROM round_secrets WHERE round_id=p_round_id;
  UPDATE bets SET status='lost' WHERE round_id=p_round_id AND status='active';
  SELECT coalesce(sum(amount),0),
         coalesce(sum(winnings) FILTER (WHERE status='won'),0)
    INTO v_tot_bets, v_tot_pay
  FROM bets WHERE round_id=p_round_id;
  UPDATE game_rounds
     SET status='crashed', crashed_at=now(), crash_multiplier=v_cp,
         server_seed=v_seed, total_bets_amount=v_tot_bets, total_payouts=v_tot_pay
   WHERE id=p_round_id AND status='flying';
END $$;

-- ----------------------------------------------------------------------------
-- 9. game_tick - single orchestration step. Driver calls this every ~250ms.
--    Idempotent; xact advisory lock prevents overlapping ticks.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype;
  v_now_mult numeric; v_post numeric; v_last_crash timestamptz; v_new uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(778811) THEN
    RETURN jsonb_build_object('action','skipped_locked');
  END IF;

  SELECT * INTO v_round FROM game_rounds
   WHERE status IN ('waiting','flying') ORDER BY round_number DESC LIMIT 1;

  IF NOT FOUND THEN
    v_post := coalesce(_game_setting_num('game.post_crash_ms'), 3000);
    SELECT max(crashed_at) INTO v_last_crash FROM game_rounds WHERE status='crashed';
    IF v_last_crash IS NULL OR now() >= v_last_crash + (v_post || ' milliseconds')::interval THEN
      v_new := open_round();
      RETURN jsonb_build_object('action','opened','round_id',v_new);
    END IF;
    RETURN jsonb_build_object('action','post_crash_pause');
  END IF;

  IF v_round.status='waiting' THEN
    IF now() >= v_round.betting_ends_at THEN
      PERFORM start_round(v_round.id);
      RETURN jsonb_build_object('action','started','round_id',v_round.id);
    END IF;
    RETURN jsonb_build_object('action','waiting','round_id',v_round.id);
  END IF;

  -- flying
  SELECT * INTO v_secret FROM round_secrets WHERE round_id=v_round.id;
  v_now_mult := _multiplier_at(extract(epoch from (clock_timestamp()-v_round.started_at))*1000.0);
  PERFORM _settle_flight(v_round.id, v_now_mult, v_secret.crash_point);
  IF clock_timestamp() >= v_secret.crashes_at OR v_now_mult >= v_secret.crash_point THEN
    PERFORM crash_round(v_round.id);
    RETURN jsonb_build_object('action','crashed','round_id',v_round.id,'crash_point',v_secret.crash_point);
  END IF;
  RETURN jsonb_build_object('action','flying','round_id',v_round.id,'multiplier',v_now_mult);
END $$;

-- ----------------------------------------------------------------------------
-- 10. place_bet - the ONLY way a player stakes money. Atomic, locked wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bal numeric; v_bet_id uuid; v_username text; v_color text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_amount IS NULL OR p_amount < v_min OR p_amount > v_max THEN
    RAISE EXCEPTION 'BET_OUT_OF_RANGE: % not in [%, %]', p_amount, v_min, v_max;
  END IF;
  IF p_auto_cashout IS NOT NULL AND p_auto_cashout <= 1.00 THEN
    RAISE EXCEPTION 'INVALID_AUTO_CASHOUT';
  END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'waiting' OR now() >= v_round.betting_ends_at THEN
    RAISE EXCEPTION 'BETTING_CLOSED';
  END IF;
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'ALREADY_BET';
  END IF;

  SELECT username, avatar_color INTO v_username, v_color FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;

  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE wallets SET balance=balance-p_amount, updated_at=now() WHERE user_id=v_uid;
  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false)
  RETURNING id INTO v_bet_id;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number,'completed');

  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'balance',v_bal-p_amount);
END $$;

-- ----------------------------------------------------------------------------
-- 11. cash_out - manual cashout. Server clock + crash_point are authoritative.
--     Idempotent: a second call after a win returns the recorded result.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cash_out(p_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype; v_bet bets%rowtype;
  v_mult numeric; v_winnings numeric; v_bal numeric;
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  v_elapsed_ms double precision;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_bet FROM bets
   WHERE round_id=p_round_id AND user_id=v_uid AND is_bot=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_BET'; END IF;
  IF v_bet.status='won' THEN
    RETURN jsonb_build_object('multiplier',v_bet.cashout_multiplier,'winnings',v_bet.winnings,'idempotent',true);
  END IF;
  IF v_bet.status <> 'active' THEN RAISE EXCEPTION 'BET_NOT_ACTIVE'; END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF v_round.status <> 'flying' OR v_round.started_at IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FLYING'; END IF;
  SELECT * INTO v_secret FROM round_secrets WHERE round_id=p_round_id;
  IF v_secret.crashes_at IS NOT NULL AND clock_timestamp() >= v_secret.crashes_at THEN
    RAISE EXCEPTION 'ROUND_CRASHED';
  END IF;

  v_elapsed_ms := extract(epoch from (clock_timestamp()-v_round.started_at))*1000.0;
  v_mult := _multiplier_at(v_elapsed_ms);
  IF v_mult >= v_secret.crash_point THEN RAISE EXCEPTION 'ROUND_CRASHED'; END IF;

  v_winnings := least(floor(v_bet.amount*v_mult*100)/100, v_maxpay);
  UPDATE bets SET status='won', cashout_multiplier=v_mult, winnings=v_winnings WHERE id=v_bet.id;
  UPDATE wallets SET balance=balance+v_winnings, updated_at=now() WHERE user_id=v_uid RETURNING balance INTO v_bal;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'win',v_winnings,'Cashed out at '||to_char(v_mult,'FM999990.00')||'x','completed');

  RETURN jsonb_build_object('multiplier',v_mult,'winnings',v_winnings,'balance',v_bal);
END $$;

-- ----------------------------------------------------------------------------
-- 12. EXECUTE GRANTS - least privilege.
--     Players may only call place_bet / cash_out. Lifecycle + tick are
--     service_role only (driver). Helper math stays callable (no secret leak).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.game_tick()                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_round()                                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_round(uuid)                             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crash_round(uuid)                             FROM PUBLIC;
REVOKE ALL ON FUNCTION public._settle_flight(uuid,numeric,numeric)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public._seed_bots(uuid,numeric)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_bet(uuid,numeric,numeric)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_out(uuid)                                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.game_tick()                  TO service_role;
GRANT EXECUTE ON FUNCTION public.open_round()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.start_round(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.crash_round(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.place_bet(uuid,numeric,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cash_out(uuid)                 TO authenticated, service_role;

COMMIT;
