-- ============================================================================
-- AVIATOR V2 - MARKETERS MAY PLAY; ONLY OPERATORS (admin/super_admin) MAY NOT
-- ============================================================================
-- Corrects an over-broad guard introduced in 20260614090000_super_admin_lockdown
-- which rejected EVERY non-player ("STAFF_CANNOT_PLAY"), including marketers.
--
-- The canonical RBAC contract (20260613060000_rbac_four_roles.sql) is explicit:
--   * marketer    -> growth/affiliate staff who MAY play the game as a normal
--                    customer.
--   * admin       -> operator; must NOT place bets.
--   * super_admin -> operator; must NOT place bets.
--
-- This migration redefines place_bet() so the betting gate matches that contract
-- and the existing block_operator_bets() trigger (which already blocks only
-- admin/super_admin). Net effect: players and marketers may wager; operators may
-- not. The change is the single role-check line; the rest of the audited body is
-- preserved verbatim.
--
-- Idempotent (CREATE OR REPLACE). Fully reversible by re-applying the previous
-- definition. Statements separated by `--##` for one-by-one application.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bal numeric; v_bet_id uuid; v_username text; v_color text; v_role text;
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

  SELECT username, avatar_color, role INTO v_username, v_color, v_role FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  -- Operators run the platform and must never wager. Marketers and players may.
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;

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
END $function$;
