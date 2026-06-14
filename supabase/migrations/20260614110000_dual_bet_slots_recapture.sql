-- ============================================================================
-- AVIATOR V2 - DUAL BET (TWO INDEPENDENT BET SLOTS PER ROUND) - REPO RECAPTURE
-- ============================================================================
-- The production database was already migrated to support the classic Aviator
-- "dual bet" feature (two independent stakes per player per round), but the
-- corresponding schema + RPC changes were never committed to the repository.
-- This left main carrying a STALE place_bet(uuid,numeric,numeric) /
-- cash_out(uuid) pair that, if replayed onto a fresh database, would create a
-- SECOND function overload and make every RPC call ambiguous.
--
-- This migration captures the live, slot-aware contract as the single source of
-- truth so the repo and production converge. It is fully idempotent and safe to
-- apply to both a fresh (repo-state) database and the live one:
--   * adds bets.slot (smallint, default 1, CHECK slot IN (1,2));
--   * adds the partial unique index that allows at most one bet per
--     (round, real-user, slot) -> i.e. at most TWO concurrent bets per round;
--   * DROPS the stale single-slot overloads and (re)creates the canonical
--     slot-aware place_bet / cash_out (operator guard preserved verbatim);
--   * re-applies least-privilege EXECUTE grants for the new signatures.
--
-- _settle_flight() is intentionally untouched: it already settles auto-cashouts
-- per-bet, so it transparently covers both slots.
--
-- Statements are separated by `--##` for one-by-one application by tooling.
-- ============================================================================

BEGIN;

-- ---- 1. Schema: slot column, range check, per-slot uniqueness ---------------
ALTER TABLE bets ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;

DO $slot$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bets_slot_check') THEN
    ALTER TABLE bets ADD CONSTRAINT bets_slot_check CHECK (slot IN (1, 2));
  END IF;
END $slot$;

-- At most one real-player bet per (round, user, slot). Bots (user_id NULL,
-- is_bot=true) are excluded so they can seed unlimited liquidity per round.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bet_round_user_slot
  ON bets (round_id, user_id, slot)
  WHERE (is_bot = false AND user_id IS NOT NULL);

-- ---- 2. Retire the stale single-slot overloads ------------------------------
-- These signatures predate dual-bet. Dropping them prevents an ambiguous
-- overload set once the slot-aware versions below are created. No-op if the
-- database already converged to the slot-aware signatures.
DROP FUNCTION IF EXISTS public.place_bet(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.cash_out(uuid);

-- ---- 3. place_bet - the ONLY way a player stakes money (slot-aware) ---------
-- Atomic, wallet-locked. Each player may hold one bet per slot (1 or 2) per
-- round, enforced both here (ALREADY_BET) and by uniq_bet_round_user_slot.
CREATE OR REPLACE FUNCTION public.place_bet(
  p_round_id uuid,
  p_amount numeric,
  p_auto_cashout numeric DEFAULT NULL,
  p_slot smallint DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bal numeric; v_bet_id uuid; v_username text; v_color text; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_slot NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
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
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid AND slot=p_slot) THEN
    RAISE EXCEPTION 'ALREADY_BET';
  END IF;

  SELECT username, avatar_color, role INTO v_username, v_color, v_role FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  -- Operators run the platform and must never wager. Marketers and players may.
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;

  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE wallets SET balance=balance-p_amount, updated_at=now() WHERE user_id=v_uid;
  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false,p_slot)
  RETURNING id INTO v_bet_id;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number||' (slot '||p_slot||')','completed');

  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'slot',p_slot,'balance',v_bal-p_amount);
END $$;

-- ---- 4. cash_out - manual cashout for a specific slot (slot-aware) ----------
-- Server clock + crash_point are authoritative. Idempotent: a second call after
-- a win returns the recorded result for that slot.
CREATE OR REPLACE FUNCTION public.cash_out(p_round_id uuid, p_slot smallint DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype; v_bet bets%rowtype;
  v_mult numeric; v_winnings numeric; v_bal numeric;
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  v_elapsed_ms double precision;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_slot NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  SELECT * INTO v_bet FROM bets
   WHERE round_id=p_round_id AND user_id=v_uid AND is_bot=false AND slot=p_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_BET'; END IF;
  IF v_bet.status='won' THEN
    RETURN jsonb_build_object('multiplier',v_bet.cashout_multiplier,'winnings',v_bet.winnings,'slot',p_slot,'idempotent',true);
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
  VALUES (v_uid,'win',v_winnings,'Cashed out at '||to_char(v_mult,'FM999990.00')||'x (slot '||p_slot||')','completed');

  RETURN jsonb_build_object('multiplier',v_mult,'winnings',v_winnings,'slot',p_slot,'balance',v_bal);
END $$;

-- ---- 5. Least-privilege EXECUTE grants for the new signatures ----------------
REVOKE ALL ON FUNCTION public.place_bet(uuid,numeric,numeric,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_out(uuid,smallint)                  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_bet(uuid,numeric,numeric,smallint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cash_out(uuid,smallint)                 TO authenticated, service_role;

COMMIT;
