-- =====================================================================
-- 20260829000000_bonus_wagering_engine.sql
-- Borrow #3: Bonus & wagering engine (invest254 0037/0094 -> aviator cents model)
--
-- WHAT THIS DOES (money-critical; additive + idempotent):
--   * Unifies ALL bonuses into ONE cents engine on wallets.bonus_balance:
--       - welcome  : KES 200 restricted, wager 3x, granted on signup (config).
--       - first_deposit_match : 100% of first M-Pesa deposit, cap KES 500,
--                    wager 3x (kept from aviator; ported to cents/bonus_balance).
--       - promo    : bonus_cash promo credits now tracked + wagered/convertible.
--   * Bonus funds are STAKE-ABLE but NON-WITHDRAWABLE. Staking spends bonus
--     BEFORE real cash; every staked shilling (real+bonus) accrues wagering on
--     the player's active bonuses. When a bonus's wagered >= amount*wagering_x
--     it CONVERTS (FIFO) from bonus_balance -> real_balance (withdrawable).
--   * Marketer/demo accounts never receive or accrue bonuses (demo isolation).
--   * request_withdrawal already debits real_balance only (P1b) -> bonus is
--     already non-withdrawable; left unchanged.
--
-- SUPERSEDES the legacy 2026-06-17 bonus system (grant_first_deposit_bonus /
--   accrue_bonus_wagering / _locked_bonus_total / old numeric `bonuses` table).
--   Those are NOT present on the live DB; on a full repo replay they exist but
--   are empty at this point, so dropping + rebuilding is safe (no bonus data
--   exists anywhere: live has 0 rows, replay grants nothing during migration).
--
-- All money movement stays inside SECURITY DEFINER RPCs and goes through
--   _wallet_move (writes ledger_entries + resyncs the numeric `balance` cache).
--   Conversion is two equal-and-opposite _wallet_move calls (bonus-, real+) so
--   total balance is conserved to the cent.
--
-- Function bodies below are the EXACT live definitions with ONLY the bonus
--   sections changed; all non-bonus logic is preserved verbatim.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) Supersede the legacy bonus system (safe: no bonus data anywhere)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_grant_first_deposit_bonus ON public.transactions;
DROP TRIGGER IF EXISTS trg_accrue_bonus_wagering       ON public.bets;
DROP FUNCTION IF EXISTS public.grant_first_deposit_bonus() CASCADE;
DROP FUNCTION IF EXISTS public.accrue_bonus_wagering()      CASCADE;
DROP FUNCTION IF EXISTS public._locked_bonus_total(uuid)    CASCADE;
DROP TABLE    IF EXISTS public.bonuses CASCADE;

-- ---------------------------------------------------------------------
-- 1) Admin-tunable config (singleton)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonus_config (
  id                        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                   boolean NOT NULL DEFAULT true,     -- master switch (staking/accrual/conversion)
  welcome_enabled           boolean NOT NULL DEFAULT true,
  welcome_amount_cents      bigint  NOT NULL DEFAULT 20000 CHECK (welcome_amount_cents >= 0),   -- KES 200
  welcome_wagering_x        numeric NOT NULL DEFAULT 3.0   CHECK (welcome_wagering_x   >= 0),
  first_deposit_enabled     boolean NOT NULL DEFAULT true,
  first_deposit_match_pct   numeric NOT NULL DEFAULT 100   CHECK (first_deposit_match_pct   >= 0),
  first_deposit_cap_cents   bigint  NOT NULL DEFAULT 50000 CHECK (first_deposit_cap_cents   >= 0),  -- KES 500
  first_deposit_wagering_x  numeric NOT NULL DEFAULT 3.0   CHECK (first_deposit_wagering_x  >= 0),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bonus_config(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) bonuses ledger (cents) — one restricted grant per row
-- ---------------------------------------------------------------------
CREATE TABLE public.bonuses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.sites(id),
  type          text NOT NULL CHECK (type IN ('welcome','first_deposit_match','promo','manual')),
  amount        bigint  NOT NULL CHECK (amount > 0),                 -- cents granted to bonus_balance
  wagering_x    numeric NOT NULL DEFAULT 0 CHECK (wagering_x >= 0),
  wagered       bigint  NOT NULL DEFAULT 0 CHECK (wagered >= 0),     -- cents staked toward this bonus
  status        text    NOT NULL DEFAULT 'active' CHECK (status IN ('active','cleared','void')),
  deposit_tx_id uuid REFERENCES public.transactions(id),            -- first_deposit_match idempotency
  source_ref    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  converted_at  timestamptz
);
CREATE UNIQUE INDEX idx_bonuses_one_welcome_per_user ON public.bonuses(user_id) WHERE type = 'welcome';
CREATE UNIQUE INDEX idx_bonuses_one_fdm_per_user     ON public.bonuses(user_id) WHERE type = 'first_deposit_match';
CREATE UNIQUE INDEX idx_bonuses_deposit_tx           ON public.bonuses(deposit_tx_id) WHERE deposit_tx_id IS NOT NULL;
CREATE INDEX        idx_bonuses_user_active          ON public.bonuses(user_id, created_at) WHERE status = 'active';

ALTER TABLE public.bonuses ENABLE ROW LEVEL SECURITY;
-- Players may READ their own bonuses. No write policies => only SECURITY DEFINER
-- RPCs (which bypass RLS) can mutate; anon/authenticated cannot write.
CREATE POLICY "own bonuses read" ON public.bonuses FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.bonuses TO authenticated;

-- realtime for live wagering-progress UI
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bonuses') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bonuses;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3) FIFO conversion helper: convert any cleared bonuses bonus->real
--    (two equal/opposite _wallet_move calls => total balance conserved)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._convert_cleared_bonuses(p_user uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_b record; v_bb bigint; v_conv bigint;
BEGIN
  FOR v_b IN
    SELECT id, amount, wagering_x, wagered FROM public.bonuses
     WHERE user_id = p_user AND status = 'active'
       AND wagered >= floor(amount * wagering_x)
     ORDER BY created_at
     FOR UPDATE
  LOOP
    SELECT bonus_balance INTO v_bb FROM public.wallets WHERE user_id = p_user FOR UPDATE;
    v_conv := least(coalesce(v_bb,0), v_b.amount);
    IF v_conv > 0 THEN
      PERFORM public._wallet_move(p_user, -v_conv, 'bonus', 'conversion', 'bonuses', v_b.id::text);
      PERFORM public._wallet_move(p_user,  v_conv, 'real',  'conversion', 'bonuses', v_b.id::text);
    END IF;
    UPDATE public.bonuses SET status = 'cleared', converted_at = now() WHERE id = v_b.id;
  END LOOP;
END $fn$;

-- ---------------------------------------------------------------------
-- 4) Welcome bonus: idempotent grant + clear-on-marketer-promotion
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_grant_welcome_bonus(p_user uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_en boolean; v_amt bigint; v_wx numeric; v_site uuid; v_bid uuid;
BEGIN
  SELECT welcome_enabled, welcome_amount_cents, welcome_wagering_x
    INTO v_en, v_amt, v_wx FROM public.bonus_config WHERE id = 1;
  IF NOT found OR NOT coalesce(v_en,false) OR coalesce(v_amt,0) <= 0 THEN RETURN 0; END IF;
  IF public.fn_is_marketer_account(p_user) THEN RETURN 0; END IF;
  SELECT site_id INTO v_site FROM public.wallets WHERE user_id = p_user FOR UPDATE;
  IF NOT found THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bonuses WHERE user_id = p_user AND type = 'welcome') THEN RETURN 0; END IF;
  INSERT INTO public.bonuses(user_id, site_id, type, amount, wagering_x, status)
    VALUES (p_user, v_site, 'welcome', v_amt, v_wx, 'active')
    ON CONFLICT DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NULL THEN RETURN 0; END IF;
  PERFORM public._wallet_move(p_user, v_amt, 'bonus', 'welcome_bonus', 'bonuses', v_bid::text);
  INSERT INTO public.transactions(user_id, type, amount, description, status, site_id)
    VALUES (p_user, 'bonus', (v_amt::numeric/100.0),
            'Welcome bonus - KSh ' || (v_amt/100)::int || ' (wager ' || v_wx || 'x to unlock)',
            'completed', v_site);
  RETURN v_amt;
END $fn$;

-- Clearing on marketer promotion: marketers are demo accounts; forfeit ALL
-- restricted bonus funds (welcome+promo) and void active bonuses.
CREATE OR REPLACE FUNCTION public.fn_clear_bonuses_for_marketer(p_user uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_bal bigint; v_voided int;
BEGIN
  SELECT bonus_balance INTO v_bal FROM public.wallets WHERE user_id = p_user FOR UPDATE;
  IF NOT found THEN RETURN 0; END IF;
  UPDATE public.bonuses SET status = 'void', converted_at = now()
   WHERE user_id = p_user AND status = 'active';
  GET DIAGNOSTICS v_voided = ROW_COUNT;
  IF v_voided = 0 AND coalesce(v_bal,0) = 0 THEN RETURN 0; END IF;
  IF coalesce(v_bal,0) > 0 THEN
    PERFORM public._wallet_move(p_user, -v_bal, 'bonus', 'bonus_void', 'wallets', p_user::text);
  END IF;
  RETURN coalesce(v_bal,0);
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_clear_bonuses_on_marketer()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NEW.role = 'marketer' AND coalesce(OLD.role,'') <> 'marketer' THEN
    PERFORM public.fn_clear_bonuses_for_marketer(NEW.id);
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS clear_bonuses_on_marketer ON public.profiles;
CREATE TRIGGER clear_bonuses_on_marketer
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_clear_bonuses_on_marketer();

-- ---------------------------------------------------------------------
-- 5) First-deposit match grant (trigger on completed M-Pesa deposit)
--    type<>'deposit' guard => the 'bonus' transaction it writes cannot recurse.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_grant_first_deposit_bonus()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_en boolean; v_pct numeric; v_cap bigint; v_wx numeric;
        v_dep bigint; v_bonus bigint; v_site uuid; v_bid uuid;
BEGIN
  IF NEW.type <> 'deposit' OR coalesce(NEW.payment_method,'') <> 'mpesa'
     OR NEW.status <> 'completed' THEN RETURN NEW; END IF;
  SELECT first_deposit_enabled, first_deposit_match_pct, first_deposit_cap_cents, first_deposit_wagering_x
    INTO v_en, v_pct, v_cap, v_wx FROM public.bonus_config WHERE id = 1;
  IF NOT found OR NOT coalesce(v_en,false) THEN RETURN NEW; END IF;
  IF public.fn_is_marketer_account(NEW.user_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.bonuses WHERE user_id = NEW.user_id AND type = 'first_deposit_match') THEN
    RETURN NEW;
  END IF;
  v_dep   := round(NEW.amount * 100)::bigint;
  v_bonus := least(floor(v_dep * (v_pct/100.0))::bigint, v_cap);
  IF v_bonus <= 0 THEN RETURN NEW; END IF;
  SELECT site_id INTO v_site FROM public.wallets WHERE user_id = NEW.user_id FOR UPDATE;
  IF NOT found THEN RETURN NEW; END IF;
  INSERT INTO public.bonuses(user_id, site_id, type, amount, wagering_x, deposit_tx_id, status)
    VALUES (NEW.user_id, v_site, 'first_deposit_match', v_bonus, v_wx, NEW.id, 'active')
    ON CONFLICT DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NULL THEN RETURN NEW; END IF;
  PERFORM public._wallet_move(NEW.user_id, v_bonus, 'bonus', 'bonus', 'bonuses', v_bid::text);
  INSERT INTO public.transactions(user_id, type, amount, description, status, site_id)
    VALUES (NEW.user_id, 'bonus', (v_bonus::numeric/100.0),
            'First-deposit match (' || v_pct::int || '%, wager ' || v_wx || 'x to unlock)',
            'completed', v_site);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_fdm_bonus ON public.transactions;
CREATE TRIGGER trg_fdm_bonus
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_grant_first_deposit_bonus();

-- ---------------------------------------------------------------------
-- 6) place_bet — bonus-first staking + wagering accrual (real players)
--    (live body preserved; only the money section changed)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric, p_slot smallint DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bet_id uuid; v_username text; v_color text; v_role text;
  v_demo boolean; v_cents bigint; v_spend bigint; v_bal numeric;
  v_real bigint; v_bonus bigint; v_from_bonus bigint; v_from_real bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.is_maintenance() THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
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
  IF v_role IN ('admin','super_admin','platform_superadmin','finance_admin','support') THEN
    RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY';
  END IF;
  v_demo  := public.fn_is_marketer_account(v_uid);
  v_cents := round(p_amount*100)::bigint;

  -- Lock wallet + sufficiency (real players may spend real+bonus; demo spends demo).
  IF v_demo THEN
    SELECT demo_balance INTO v_spend FROM wallets WHERE user_id=v_uid FOR UPDATE;
    IF v_spend IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
    IF v_spend < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  ELSE
    SELECT real_balance, bonus_balance INTO v_real, v_bonus FROM wallets WHERE user_id=v_uid FOR UPDATE;
    IF v_real IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
    IF v_real + v_bonus < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  END IF;

  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false,p_slot)
  RETURNING id INTO v_bet_id;

  IF v_demo THEN
    PERFORM public._wallet_move(v_uid, -v_cents, 'demo', 'stake', 'bets', v_bet_id::text);
  ELSE
    -- Spend restricted bonus before real cash so wagering can be satisfied.
    v_from_bonus := least(v_bonus, v_cents);
    v_from_real  := v_cents - v_from_bonus;
    IF v_from_bonus > 0 THEN PERFORM public._wallet_move(v_uid, -v_from_bonus, 'bonus', 'stake', 'bets', v_bet_id::text); END IF;
    IF v_from_real  > 0 THEN PERFORM public._wallet_move(v_uid, -v_from_real,  'real',  'stake', 'bets', v_bet_id::text); END IF;
    -- Wagering progress: every staked shilling (real+bonus) counts toward active bonuses.
    UPDATE public.bonuses SET wagered = wagered + v_cents WHERE user_id = v_uid AND status = 'active';
  END IF;

  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number||' (slot '||p_slot||')','completed');
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'slot',p_slot,'balance',v_bal);
END $function$;

-- ---------------------------------------------------------------------
-- 7) cash_out — payout to real, then FIFO conversion of cleared bonuses
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cash_out(p_round_id uuid, p_slot smallint DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype; v_bet bets%rowtype;
  v_mult numeric; v_winnings numeric; v_bal numeric;
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  v_elapsed_ms double precision; v_demo boolean; v_kind text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
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
  v_winnings := _bet_credit(v_bet.amount, v_mult, v_bet.is_free, v_maxpay);
  UPDATE bets SET status='won', cashout_multiplier=v_mult, winnings=v_winnings WHERE id=v_bet.id;
  v_demo := public.fn_is_marketer_account(v_uid);
  v_kind := CASE WHEN v_demo THEN 'demo' ELSE 'real' END;
  PERFORM public._wallet_move(v_uid, round(v_winnings*100)::bigint, v_kind, 'payout', 'bets', v_bet.id::text);
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'win',v_winnings,
    CASE WHEN v_bet.is_free THEN 'Free-bet cashed out at ' ELSE 'Cashed out at ' END
      || to_char(v_mult,'FM999990.00')||'x (slot '||p_slot||')','completed');
  -- Bonuses whose wagering is now met convert bonus->real (real players only).
  IF NOT v_demo THEN PERFORM public._convert_cleared_bonuses(v_uid); END IF;
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  RETURN jsonb_build_object('multiplier',v_mult,'winnings',v_winnings,'slot',p_slot,'balance',v_bal,'free',v_bet.is_free);
END $function$;

-- ---------------------------------------------------------------------
-- 8) _settle_flight — auto-cashout wins + conversion per real winner
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_flight(p_round_id uuid, p_now_mult numeric, p_crash_point numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  rec record; w numeric; v_kind text;
BEGIN
  -- bots (no wallet impact, never free)
  UPDATE bets SET status='won', cashout_multiplier=auto_cashout,
         winnings = least(floor(amount*auto_cashout*100)/100, v_maxpay)
   WHERE round_id=p_round_id AND is_bot=true AND status='active'
     AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point;
  -- real players (credit wallet + ledger atomically; free bets pay net only)
  FOR rec IN
    SELECT * FROM bets
     WHERE round_id=p_round_id AND is_bot=false AND status='active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point
     FOR UPDATE
  LOOP
    w := _bet_credit(rec.amount, rec.auto_cashout, rec.is_free, v_maxpay);
    UPDATE bets SET status='won', cashout_multiplier=rec.auto_cashout, winnings=w WHERE id=rec.id;
    v_kind := CASE WHEN public.fn_is_marketer_account(rec.user_id) THEN 'demo' ELSE 'real' END;
    PERFORM public._wallet_move(rec.user_id, round(w*100)::bigint, v_kind, 'payout', 'bets', rec.id::text);
    INSERT INTO transactions(user_id,type,amount,description,status)
    VALUES (rec.user_id,'win',w,
      CASE WHEN rec.is_free THEN 'Free-bet auto cashout at ' ELSE 'Auto cashout at ' END
        || to_char(rec.auto_cashout,'FM999990.00')||'x','completed');
    IF v_kind = 'real' THEN PERFORM public._convert_cleared_bonuses(rec.user_id); END IF;
  END LOOP;
END $function$;

-- ---------------------------------------------------------------------
-- 9) crash_round — after marking losers, convert bonuses cleared by the
--    losing stake (winners already converted at cash_out/_settle_flight).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crash_round(p_round_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cp numeric; v_seed text; v_tot_bets numeric; v_tot_pay numeric; rec record;
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
  -- Convert any bonus cleared by this round's stakes (real players only).
  FOR rec IN SELECT DISTINCT user_id FROM bets WHERE round_id=p_round_id AND is_bot=false LOOP
    IF NOT public.fn_is_marketer_account(rec.user_id) THEN
      PERFORM public._convert_cleared_bonuses(rec.user_id);
    END IF;
  END LOOP;
  -- Ephemeral bots: no wallet impact, no audit value -> reclaim immediately.
  DELETE FROM bets WHERE round_id=p_round_id AND is_bot=true;
END $function$;

-- ---------------------------------------------------------------------
-- 10) redeem_promo_code — bonus_cash now creates a tracked, wagered bonus
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.promo_codes; v_uid uuid := auth.uid(); v_site uuid; v_role text;
        v_user_uses int; v_cents bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT role, site_id INTO v_role, v_site FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role <> 'player' THEN RAISE EXCEPTION 'ONLY_PLAYERS'; END IF;

  SELECT * INTO v FROM public.promo_codes
   WHERE site_id = v_site AND code = upper(trim(coalesce(p_code,''))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  IF NOT v.active THEN RAISE EXCEPTION 'CODE_INACTIVE'; END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at < now() THEN RAISE EXCEPTION 'CODE_EXPIRED'; END IF;
  IF v.max_redemptions IS NOT NULL AND v.redeemed_count >= v.max_redemptions THEN RAISE EXCEPTION 'CODE_EXHAUSTED'; END IF;

  SELECT count(*) INTO v_user_uses FROM public.promo_redemptions WHERE promo_id = v.id AND user_id = v_uid;
  IF v_user_uses >= v.per_user_limit THEN RAISE EXCEPTION 'ALREADY_REDEEMED'; END IF;

  IF v.reward_kind = 'free_bet' THEN
    INSERT INTO public.free_bets (user_id, amount, source, expires_at)
    VALUES (v_uid, v.reward_value, 'promo', v.expires_at);
  ELSIF v.reward_kind = 'bonus_cash' THEN
    v_cents := round(v.reward_value * 100)::bigint;
    PERFORM public._wallet_move(v_uid, v_cents, 'bonus', 'promo', 'promo_codes', v.id::text);
    -- Track as a restricted, wagered bonus so it converts like every other bonus.
    IF v_cents > 0 THEN
      INSERT INTO public.bonuses(user_id, site_id, type, amount, wagering_x, status, source_ref)
      VALUES (v_uid, v_site, 'promo', v_cents, coalesce(v.wagering_x, 1.0), 'active', v.id::text);
    END IF;
  END IF;

  INSERT INTO public.promo_redemptions (promo_id, user_id, reward_kind, amount)
  VALUES (v.id, v_uid, v.reward_kind, v.reward_value);
  UPDATE public.promo_codes SET redeemed_count = redeemed_count + 1, updated_at = now() WHERE id = v.id;

  RETURN jsonb_build_object('reward_kind', v.reward_kind, 'amount', v.reward_value,
                            'message', CASE v.reward_kind
                              WHEN 'free_bet' THEN 'Free bet of KSh '||v.reward_value||' added!'
                              ELSE 'Bonus of KSh '||v.reward_value||' credited!' END);
END $function$;

-- ---------------------------------------------------------------------
-- 11) handle_new_user — welcome is now a RESTRICTED bonus (config-driven),
--     replacing the old free-withdrawable KES 500 real credit.
--     (all non-credit logic preserved verbatim from the live definition)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid; _default_mk uuid;
  _site uuid; _site_id_hint text; _site_slug_hint text;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  _ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')), '');

  -- ---- Resolve the signup's brand (site) --------------------------------
  _site_id_hint   := nullif(trim(coalesce(NEW.raw_user_meta_data->>'site_id', '')), '');
  _site_slug_hint := nullif(trim(coalesce(NEW.raw_user_meta_data->>'site_slug', '')), '');
  IF _site_id_hint IS NOT NULL THEN
    SELECT id INTO _site FROM public.sites WHERE id = _site_id_hint::uuid AND status = 'active';
    IF _site IS NULL THEN RAISE EXCEPTION 'INVALID_SITE: no active site with id %', _site_id_hint; END IF;
  ELSIF _site_slug_hint IS NOT NULL THEN
    SELECT id INTO _site FROM public.sites WHERE slug = lower(_site_slug_hint) AND status = 'active';
    IF _site IS NULL THEN RAISE EXCEPTION 'INVALID_SITE: no active site with slug %', _site_slug_hint; END IF;
  ELSE
    _site := '00000000-0000-0000-0000-000000000001'::uuid;   -- default site (back-compat)
  END IF;

  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN RAISE EXCEPTION 'Username is required'; END IF;
  IF char_length(trim(_username)) < 3 THEN RAISE EXCEPTION 'Username must be at least 3 characters'; END IF;

  -- Referral lookup is scoped to the resolved brand.
  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer FROM public.profiles
     WHERE referral_code = upper(_ref) AND role = 'marketer' AND site_id = _site AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, username, avatar_color, phone_number, referred_by, site_id)
    VALUES (NEW.id, trim(_username), _avatar, _phone, _marketer, _site);
  -- Wallet starts empty; the restricted welcome bonus is granted below.
  INSERT INTO public.wallets (user_id, balance, currency, real_balance, site_id)
    VALUES (NEW.id, 0, 'KES', 0, _site);
  -- Restricted, wagered welcome bonus (credits bonus_balance + ledger + tx).
  PERFORM public.fn_grant_welcome_bonus(NEW.id);

  -- Attribution: explicit referrer, else the brand's default marketer (if set).
  IF _marketer IS NULL THEN
    SELECT default_marketer_id INTO _default_mk FROM public.sites WHERE id = _site;
    _marketer := _default_mk;
  END IF;
  IF _marketer IS NOT NULL THEN
    INSERT INTO public.referrals (marketer_id, player_id, status, site_id)
      VALUES (_marketer, NEW.id, 'pending', _site) ON CONFLICT (player_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 12) Player-facing wagering status (own bonuses only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wallet_bonus_status()
 RETURNS TABLE(bonus_id uuid, type text, amount bigint, wagering_x numeric, wagered bigint,
               required bigint, remaining bigint, status text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
    SELECT b.id, b.type, b.amount, b.wagering_x, b.wagered,
           floor(b.amount * b.wagering_x)::bigint AS required,
           greatest(0, floor(b.amount * b.wagering_x)::bigint - b.wagered) AS remaining,
           b.status, b.created_at
      FROM public.bonuses b
     WHERE b.user_id = auth.uid() AND b.status = 'active'
     ORDER BY b.created_at;
END $fn$;

-- ---------------------------------------------------------------------
-- 13) Grants: money movers stay service-role/definer; status RPC to players
-- ---------------------------------------------------------------------
DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public._convert_cleared_bonuses(uuid)        FROM public;
  REVOKE ALL ON FUNCTION public.fn_grant_welcome_bonus(uuid)          FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.fn_clear_bonuses_for_marketer(uuid)   FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.fn_grant_first_deposit_bonus()        FROM public, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.fn_grant_welcome_bonus(uuid)        TO service_role;
  GRANT  EXECUTE ON FUNCTION public.fn_clear_bonuses_for_marketer(uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.fn_wallet_bonus_status()             FROM public;
  GRANT  EXECUTE ON FUNCTION public.fn_wallet_bonus_status()          TO authenticated, service_role;
END
$g$;

COMMIT;

-- =====================================================================
-- REVERT (manual): restore place_bet/cash_out/_settle_flight/crash_round/
--   redeem_promo_code/handle_new_user from 20260828090000/030000/140000;
--   drop trg_fdm_bonus + clear_bonuses_on_marketer + fn_* bonus funcs +
--   bonus_config + bonuses. (No production bonus data expected.)
-- NOTE (separate bug, NOT fixed here): the M-Pesa STK callback credits
--   deposits to wallets.balance directly instead of real_balance via
--   _wallet_move, so real deposits don't persist in the cents model. Track
--   as a P1b edge-function follow-up.
-- =====================================================================
