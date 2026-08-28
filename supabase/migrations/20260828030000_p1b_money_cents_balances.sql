-- =====================================================================
-- 20260828030000_p1b_money_cents_balances.sql
-- Borrow P1b: money model = integer CENTS + real/bonus/demo balances +
-- double-entry ledger_entries + marketer DEMO ISOLATION (invest254 semantics).
--
-- Design (adapted to aviator's SQL/pg_cron engine):
--   * wallets gains real_balance / bonus_balance / demo_balance (bigint cents).
--   * `wallets.balance` (numeric KES) is KEPT as a maintained COMPAT CACHE that
--     the frontend reads (useAuth). Every money move syncs it via _wallet_move.
--   * Real players transact on real_balance; marketer accounts transact on the
--     NON-WITHDRAWABLE demo_balance (server-authoritative fn_is_marketer_account)
--     so marketer play never touches real cash / GGR / RTP (invest254 decision F).
--   * ledger_entries is the cents source of truth; transactions stays for history.
--   * bonus_balance + wagering are RESERVED (column present, logic deferred).
--   * GAME MATH IS UNCHANGED — only the money plumbing is rewritten.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Cents balances on wallets + backfill from the legacy numeric balance
-- ---------------------------------------------------------------------
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS real_balance  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_balance bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demo_balance  bigint NOT NULL DEFAULT 0;

-- Backfill real_balance from existing KES balance (one-time; guarded).
UPDATE public.wallets
   SET real_balance = round(balance * 100)::bigint
 WHERE real_balance = 0 AND balance IS NOT NULL AND balance <> 0;

-- ---------------------------------------------------------------------
-- 2) Double-entry ledger (cents) — the money source of truth
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL,
  site_id      uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.sites(id),
  type         text NOT NULL,               -- stake|payout|deposit|withdrawal|adjustment|rain|refund
  amount       bigint NOT NULL,             -- signed cents
  balance_kind text NOT NULL CHECK (balance_kind IN ('real','bonus','demo')),
  ref_table    text,
  ref_id       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user   ON public.ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_site   ON public.ledger_entries(site_id);
CREATE INDEX IF NOT EXISTS idx_ledger_ref    ON public.ledger_entries(ref_table, ref_id);

-- ---------------------------------------------------------------------
-- 3) Server-authoritative demo/marketer classifier
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_marketer_account(p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND role = 'marketer'); $$;

-- ---------------------------------------------------------------------
-- 4) Central money mover: change one balance kind by signed cents, write the
--    ledger row, and re-sync the numeric `balance` cache. Returns new spendable
--    cents for that account kind. Callers must check sufficiency before debiting.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._wallet_move(
    p_user uuid, p_cents bigint, p_kind text, p_type text,
    p_ref_table text DEFAULT NULL, p_ref_id text DEFAULT NULL)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_site uuid; v_demo boolean; v_spend bigint;
BEGIN
  IF p_kind NOT IN ('real','bonus','demo') THEN RAISE EXCEPTION 'INVALID_BALANCE_KIND'; END IF;
  SELECT site_id INTO v_site FROM public.wallets WHERE user_id = p_user;
  UPDATE public.wallets SET
    real_balance  = real_balance  + CASE WHEN p_kind='real'  THEN p_cents ELSE 0 END,
    bonus_balance = bonus_balance + CASE WHEN p_kind='bonus' THEN p_cents ELSE 0 END,
    demo_balance  = demo_balance  + CASE WHEN p_kind='demo'  THEN p_cents ELSE 0 END,
    updated_at    = now()
   WHERE user_id = p_user;
  INSERT INTO public.ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
    VALUES (p_user, coalesce(v_site,'00000000-0000-0000-0000-000000000001'::uuid),
            p_type, p_cents, p_kind, p_ref_table, p_ref_id);
  -- resync the compat KES cache the frontend reads
  v_demo := public.fn_is_marketer_account(p_user);
  UPDATE public.wallets
     SET balance = (CASE WHEN v_demo THEN demo_balance ELSE real_balance + bonus_balance END)::numeric / 100.0
   WHERE user_id = p_user
   RETURNING (CASE WHEN v_demo THEN demo_balance ELSE real_balance + bonus_balance END) INTO v_spend;
  RETURN v_spend;
END $$;

-- ---------------------------------------------------------------------
-- 5) Re-sync every existing wallet's cache to the new model (staff rows).
-- ---------------------------------------------------------------------
UPDATE public.wallets w
   SET balance = (CASE WHEN public.fn_is_marketer_account(w.user_id)
                       THEN w.demo_balance ELSE w.real_balance + w.bonus_balance END)::numeric / 100.0;

COMMIT;

-- =====================================================================
-- 6) Rewrite money RPCs to the cents + real/demo + ledger model.
--    Non-money logic is preserved verbatim from the pre-P1b definitions.
-- =====================================================================
BEGIN;

-- 6.1 Signup provisioning: welcome credit to real_balance (cents) + ledger.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  _ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')), '');
  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN RAISE EXCEPTION 'Username is required'; END IF;
  IF char_length(trim(_username)) < 3 THEN RAISE EXCEPTION 'Username must be at least 3 characters'; END IF;
  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer FROM public.profiles
     WHERE referral_code = upper(_ref) AND role = 'marketer' AND id <> NEW.id;
  END IF;
  INSERT INTO public.profiles (id, username, avatar_color, phone_number, referred_by)
    VALUES (NEW.id, trim(_username), _avatar, _phone, _marketer);
  -- Welcome KES 500 -> real_balance (50000 cents); cache balance = 500.00
  INSERT INTO public.wallets (user_id, balance, currency, real_balance)
    VALUES (NEW.id, 500.00, 'KES', 50000);
  INSERT INTO public.ledger_entries (user_id, type, amount, balance_kind, ref_table, ref_id)
    VALUES (NEW.id, 'deposit', 50000, 'real', 'signup', NEW.id::text);
  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed');
  IF _marketer IS NOT NULL THEN
    INSERT INTO public.referrals (marketer_id, player_id, status)
      VALUES (_marketer, NEW.id, 'pending') ON CONFLICT (player_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;

-- 6.2 place_bet: debit real (players) / demo (marketers) in cents.
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric, p_slot smallint DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric := coalesce(_game_setting_num('game.min_bet'), 50);
  v_max numeric := coalesce(_game_setting_num('game.max_bet'), 50000);
  v_bet_id uuid; v_username text; v_color text; v_role text;
  v_demo boolean; v_kind text; v_cents bigint; v_spend bigint; v_bal numeric;
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
  v_demo := public.fn_is_marketer_account(v_uid);
  v_kind := CASE WHEN v_demo THEN 'demo' ELSE 'real' END;
  v_cents := round(p_amount*100)::bigint;
  SELECT (CASE WHEN v_demo THEN demo_balance ELSE real_balance END) INTO v_spend
    FROM wallets WHERE user_id=v_uid FOR UPDATE;
  IF v_spend IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_spend < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false,p_slot)
  RETURNING id INTO v_bet_id;
  PERFORM public._wallet_move(v_uid, -v_cents, v_kind, 'stake', 'bets', v_bet_id::text);
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number||' (slot '||p_slot||')','completed');
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'slot',p_slot,'balance',v_bal);
END $function$;

-- 6.3 cash_out: credit winnings to real/demo in cents.
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
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  RETURN jsonb_build_object('multiplier',v_mult,'winnings',v_winnings,'slot',p_slot,'balance',v_bal,'free',v_bet.is_free);
END $function$;

-- 6.4 _settle_flight: auto-cashout during flight (bots unchanged; players -> cents/real/demo).
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
  END LOOP;
END $function$;

-- 6.5 request_withdrawal: real cash only; marketers (demo) cannot withdraw.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_min numeric := coalesce(_game_setting_num('finance.min_withdrawal'), 100);
  v_thr numeric := coalesce(_game_setting_num('finance.auto_approve_threshold'), 5000);
  v_real_cents bigint; v_id uuid; v_auto boolean;
  v_risk jsonb; v_score int; v_flags jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.fn_is_marketer_account(v_uid) THEN RAISE EXCEPTION 'MARKETER_DEMO_NON_WITHDRAWABLE'; END IF;
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  SELECT real_balance INTO v_real_cents FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_real_cents IS NULL           THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_real_cents < round(p_amount*100)::bigint THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;
  v_risk  := assess_player_risk(v_uid);
  v_score := (v_risk->>'score')::int;
  v_flags := coalesce(v_risk->'flags', '[]'::jsonb);
  v_auto  := (p_amount <= v_thr) AND (v_score <= 30);
  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, auto_approved, risk_score, risk_flags)
  VALUES (v_uid, p_amount, v_phone, 'pending', v_auto, v_score, v_flags) RETURNING id INTO v_id;
  RETURN jsonb_build_object('withdrawal_request_id', v_id, 'status', 'pending',
    'auto_approved', v_auto, 'phone', v_phone, 'amount', p_amount,
    'risk_score', v_score, 'risk_level', v_risk->>'level');
END $function$;

-- 6.6 admin_adjust_balance: adjust real_balance (cents).
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_delta numeric, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_real bigint; v_delta_c bigint; v_new numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'INVALID_DELTA'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  v_delta_c := round(p_delta*100)::bigint;
  SELECT real_balance INTO v_real FROM wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_real IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_real + v_delta_c < 0 THEN RAISE EXCEPTION 'NEGATIVE_BALANCE'; END IF;
  PERFORM public._wallet_move(p_user_id, v_delta_c, 'real', 'adjustment', 'admin', auth.uid()::text);
  SELECT balance INTO v_new FROM wallets WHERE user_id = p_user_id;
  INSERT INTO transactions(user_id, type, amount, description, status)
  VALUES (p_user_id, 'adjustment', p_delta, 'Admin: ' || p_reason, 'completed');
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'balance_adjust', 'user', p_user_id::text,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'new_balance', v_new));
  RETURN jsonb_build_object('balance', v_new, 'delta', p_delta);
END $function$;

-- 6.7 claim_rain: credit real (players) / demo (marketers) in cents.
CREATE OR REPLACE FUNCTION public.claim_rain(p_rain_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_ev rain_events%rowtype; v_bal numeric; v_kind text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id=v_uid;
  IF v_role IN ('admin','super_admin','platform_superadmin','finance_admin','support') THEN
    RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY';
  END IF;
  SELECT * INTO v_ev FROM rain_events WHERE id=p_rain_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAIN_NOT_FOUND'; END IF;
  IF now() >= v_ev.expires_at THEN RAISE EXCEPTION 'RAIN_EXPIRED'; END IF;
  IF v_ev.claims_count >= v_ev.max_claims THEN RAISE EXCEPTION 'RAIN_DEPLETED'; END IF;
  IF EXISTS (SELECT 1 FROM rain_claims WHERE rain_id=p_rain_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED';
  END IF;
  INSERT INTO rain_claims(rain_id, user_id, amount) VALUES (p_rain_id, v_uid, v_ev.per_user);
  UPDATE rain_events SET claims_count = claims_count + 1 WHERE id=p_rain_id;
  v_kind := CASE WHEN public.fn_is_marketer_account(v_uid) THEN 'demo' ELSE 'real' END;
  PERFORM public._wallet_move(v_uid, round(v_ev.per_user*100)::bigint, v_kind, 'rain', 'rain_events', p_rain_id::text);
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bonus',v_ev.per_user,'Rain bonus claim','completed');
  RETURN jsonb_build_object('rain_id', p_rain_id, 'amount', v_ev.per_user, 'balance', v_bal);
END $function$;

COMMIT;
