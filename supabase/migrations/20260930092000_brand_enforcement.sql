-- ============================================================================
-- Multi-brand, step 3: the server enforces each brand's settings.
--
-- A brand's limits, switches and bonus offer are only real if the database refuses what the brand
-- forbids — the UI hiding a button is not a control. Enforced here:
--   bets        features.play / features.maintenance / features.two_bets / features.free_bets,
--               limits.min_bet / limits.max_bet, and limits.max_payout SNAPSHOTTED on the bet row
--               (bets.max_payout) so a cash-out and the engine's auto-cash-out settle a bet under
--               the cap that applied when it was placed, whatever changes mid-round.
--   deposits    features.deposits / features.maintenance, limits.min_deposit / limits.max_deposit,
--               payments.stk_reference — one guard (fn_deposit_guard) for every deposit rail.
--   withdrawals features.withdrawals / features.maintenance, limits.min_withdrawal,
--               limits.max_withdrawal, limits.daily_withdrawal (Nairobi day), limits.auto_approve.
--   sign-up     features.registrations; welcome bonus from the brand's bonus.* values.
--   bonuses     first-deposit match from the brand's bonus.* values.
--   promo/rain  features.promo_codes / features.rain.
--   chat        features.chat (insert policy).
-- The platform-wide switches (platform_global_config, system maintenance) still apply on top.
-- ============================================================================
BEGIN;

ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS max_payout numeric;

-- A player's own brand switch, for RLS policies (only feature flags are exposed).
CREATE OR REPLACE FUNCTION public.fn_my_feature(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_key LIKE 'features.%' THEN public._brand_bool((SELECT site_id FROM profiles WHERE id = auth.uid()), p_key) ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.fn_my_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_feature(text) TO authenticated;

-- ── bets ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_amount numeric, p_auto_cashout numeric DEFAULT NULL::numeric, p_slot smallint DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype;
  v_min numeric; v_max numeric; v_cap numeric; v_site uuid;
  v_bet_id uuid; v_username text; v_color text; v_role text;
  v_demo boolean; v_cents bigint; v_spend bigint; v_bal numeric;
  v_real bigint; v_bonus bigint; v_from_bonus bigint; v_from_real bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.is_maintenance() THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT public.fn_platform_switch('play_enabled') THEN RAISE EXCEPTION 'PLAY_DISABLED'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  SELECT username, avatar_color, role, site_id INTO v_username, v_color, v_role, v_site FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF public._is_operator_role(v_role) THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;
  v_demo := public.fn_is_marketer_account(v_uid);
  IF public._brand_bool(v_site, 'features.maintenance') THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT v_demo AND NOT public._brand_bool(v_site, 'features.play') THEN RAISE EXCEPTION 'PLAY_DISABLED'; END IF;
  IF p_slot = 2 AND NOT public._brand_bool(v_site, 'features.two_bets') THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  v_min := coalesce(public._brand_num(v_site, 'limits.min_bet'), 50);
  v_max := coalesce(public._brand_num(v_site, 'limits.max_bet'), 50000);
  v_cap := coalesce(public._brand_num(v_site, 'limits.max_payout'), 500000);
  IF p_amount IS NULL OR p_amount < v_min OR p_amount > v_max THEN
    RAISE EXCEPTION 'BET_OUT_OF_RANGE: % not in [%, %]', p_amount, v_min, v_max;
  END IF;
  IF p_auto_cashout IS NOT NULL AND p_auto_cashout <= 1.00 THEN RAISE EXCEPTION 'INVALID_AUTO_CASHOUT'; END IF;
  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'waiting' OR now() >= v_round.betting_ends_at THEN RAISE EXCEPTION 'BETTING_CLOSED'; END IF;
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid AND slot=p_slot) THEN RAISE EXCEPTION 'ALREADY_BET'; END IF;
  v_cents := round(p_amount*100)::bigint;

  IF v_demo THEN
    SELECT demo_balance INTO v_spend FROM wallets WHERE user_id=v_uid FOR UPDATE;
    IF v_spend IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
    IF v_spend < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  ELSE
    SELECT real_balance, bonus_balance INTO v_real, v_bonus FROM wallets WHERE user_id=v_uid FOR UPDATE;
    IF v_real IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
    IF v_real + v_bonus < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  END IF;

  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot,site_id,max_payout)
  VALUES (p_round_id,v_uid,v_username,v_color,p_amount,p_auto_cashout,'active',false,p_slot,v_site,v_cap)
  RETURNING id INTO v_bet_id;

  IF v_demo THEN
    PERFORM public._wallet_move(v_uid, -v_cents, 'demo', 'stake', 'bets', v_bet_id::text);
  ELSE
    v_from_bonus := least(v_bonus, v_cents);
    v_from_real  := v_cents - v_from_bonus;
    IF v_from_bonus > 0 THEN PERFORM public._wallet_move(v_uid, -v_from_bonus, 'bonus', 'stake', 'bets', v_bet_id::text); END IF;
    IF v_from_real  > 0 THEN PERFORM public._wallet_move(v_uid, -v_from_real,  'real',  'stake', 'bets', v_bet_id::text); END IF;
    UPDATE public.bonuses SET wagered = wagered + v_cents WHERE user_id = v_uid AND status = 'active';
  END IF;

  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bet',-p_amount,'Bet on round '||v_round.round_number||' (slot '||p_slot||')','completed');
  SELECT balance INTO v_bal FROM wallets WHERE user_id=v_uid;
  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',p_amount,'slot',p_slot,'balance',v_bal);
END $function$;

CREATE OR REPLACE FUNCTION public.place_free_bet(p_round_id uuid, p_free_bet_id uuid, p_auto_cashout numeric DEFAULT NULL::numeric, p_slot smallint DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_fb free_bets%rowtype;
  v_username text; v_color text; v_role text; v_bet_id uuid; v_site uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.is_maintenance() THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  IF p_auto_cashout IS NOT NULL AND p_auto_cashout <= 1.00 THEN RAISE EXCEPTION 'INVALID_AUTO_CASHOUT'; END IF;
  SELECT username, avatar_color, role, site_id INTO v_username, v_color, v_role, v_site FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF public._is_operator_role(v_role) THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;
  IF public._brand_bool(v_site, 'features.maintenance') THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT public._brand_bool(v_site, 'features.free_bets') THEN RAISE EXCEPTION 'FREE_BETS_DISABLED'; END IF;
  IF p_slot = 2 AND NOT public._brand_bool(v_site, 'features.two_bets') THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;

  SELECT * INTO v_fb FROM free_bets WHERE id=p_free_bet_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FREE_BET_NOT_FOUND'; END IF;
  IF v_fb.status <> 'active' THEN RAISE EXCEPTION 'FREE_BET_NOT_ACTIVE'; END IF;
  IF v_fb.expires_at IS NOT NULL AND now() >= v_fb.expires_at THEN
    UPDATE free_bets SET status='expired' WHERE id=v_fb.id;
    RAISE EXCEPTION 'FREE_BET_EXPIRED';
  END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'waiting' OR now() >= v_round.betting_ends_at THEN RAISE EXCEPTION 'BETTING_CLOSED'; END IF;
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid AND slot=p_slot) THEN RAISE EXCEPTION 'ALREADY_BET'; END IF;

  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot,is_free,free_bet_id,site_id,max_payout)
  VALUES (p_round_id,v_uid,v_username,v_color,v_fb.amount,p_auto_cashout,'active',false,p_slot,true,v_fb.id,v_site,
          coalesce(public._brand_num(v_site, 'limits.max_payout'), 500000))
  RETURNING id INTO v_bet_id;
  UPDATE free_bets SET status='used', used_at=now(), used_round_id=p_round_id, used_bet_id=v_bet_id WHERE id=v_fb.id;
  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',v_fb.amount,'slot',p_slot,'free',true);
END $function$;

-- Cash-out and the engine's auto-cash-out honour the cap stored on the bet.
SELECT public._patch_fn('public.cash_out(uuid,smallint)',
  'v_winnings := _bet_credit(v_bet.amount, v_mult, v_bet.is_free, v_maxpay);',
  'v_winnings := _bet_credit(v_bet.amount, v_mult, v_bet.is_free, coalesce(v_bet.max_payout, v_maxpay));');
SELECT public._patch_fn('public._settle_flight(uuid,numeric,numeric)',
  'w := _bet_credit(rec.amount, rec.auto_cashout, rec.is_free, v_maxpay);',
  'w := _bet_credit(rec.amount, rec.auto_cashout, rec.is_free, coalesce(rec.max_payout, v_maxpay));');

-- ── deposits ─────────────────────────────────────────────────────────────────────────────────
-- One guard for every deposit rail (Mega Pay today, Daraja when switched on). Returns the brand
-- and the M-Pesa account name the payer sees; raises the same codes the UI already maps.
CREATE OR REPLACE FUNCTION public.fn_deposit_guard(p_user uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prof profiles%ROWTYPE; v_cfg jsonb; v_min numeric; v_max numeric; v_ref text;
BEGIN
  SELECT * INTO v_prof FROM profiles WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF coalesce(v_prof.is_banned, false) THEN RAISE EXCEPTION 'ACCOUNT_BANNED'; END IF;
  IF public._is_operator_role(v_prof.role) THEN RAISE EXCEPTION 'OPERATOR_CANNOT_DEPOSIT'; END IF;
  BEGIN v_cfg := public.fn_platform_get_global_config(); EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
  IF v_cfg IS NOT NULL AND (v_cfg->>'deposits_enabled') = 'false' THEN RAISE EXCEPTION 'DEPOSITS_DISABLED'; END IF;
  IF public.is_maintenance() OR public._brand_bool(v_prof.site_id, 'features.maintenance') THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT public._brand_bool(v_prof.site_id, 'features.deposits') THEN RAISE EXCEPTION 'DEPOSITS_DISABLED'; END IF;
  IF p_amount IS NULL OR p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  v_min := coalesce(public._brand_num(v_prof.site_id, 'limits.min_deposit'), 100);
  v_max := coalesce(public._brand_num(v_prof.site_id, 'limits.max_deposit'), 150000);
  IF p_amount < v_min THEN RAISE EXCEPTION 'BELOW_MIN:%', v_min; END IF;
  IF p_amount > v_max THEN RAISE EXCEPTION 'ABOVE_MAX:%', v_max; END IF;
  v_ref := public._brand_value(v_prof.site_id, 'payments.stk_reference') #>> '{}';
  IF v_ref IS NULL THEN
    SELECT left(upper(regexp_replace(coalesce(s.wordmark_text, s.name, 'AVIATOR'), '[^A-Za-z0-9]', '', 'g')), 12) INTO v_ref
      FROM sites s WHERE s.id = v_prof.site_id;
  END IF;
  RETURN jsonb_build_object('site_id', v_prof.site_id, 'reference', coalesce(nullif(v_ref, ''), 'AVIATOR'));
END $$;
REVOKE ALL ON FUNCTION public.fn_deposit_guard(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_deposit_guard(uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_megapay_begin(p_user uuid, p_phone text, p_amount numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_g jsonb; v_id uuid; v_recent int;
BEGIN
  IF coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay') <> 'megapay' THEN
    RAISE EXCEPTION 'MEGAPAY_DISABLED';
  END IF;
  v_g := public.fn_deposit_guard(p_user, p_amount);
  IF p_phone IS NULL OR p_phone !~ '^254(7|1)[0-9]{8}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  -- Throttle: at most 3 prompts per player per 2 minutes (each one rings the player's phone).
  SELECT count(*) INTO v_recent FROM mpesa_stk_requests
   WHERE user_id = p_user AND provider = 'megapay' AND created_at > now() - interval '2 minutes';
  IF v_recent >= 3 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  v_id := gen_random_uuid();
  INSERT INTO mpesa_stk_requests(id, user_id, phone_number, amount, checkout_request_id, status, provider, site_id, reference)
  VALUES (v_id, p_user, p_phone, p_amount, 'mp-pending:' || v_id, 'initiated', 'megapay', (v_g->>'site_id')::uuid, v_g->>'reference');
  RETURN jsonb_build_object('id', v_id, 'reference', v_g->>'reference');
END $function$;

-- Limits and offer for the wallet / sign-up sheets: the caller's brand when signed in, else the
-- brand the page resolved from its host (p_site), else the default brand.
DROP FUNCTION IF EXISTS public.fn_public_payment_config();
CREATE OR REPLACE FUNCTION public.fn_public_payment_config(p_site uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_site uuid; e jsonb;
BEGIN
  v_site := coalesce((SELECT site_id FROM profiles WHERE id = auth.uid()),
                     (SELECT id FROM sites WHERE id = p_site),
                     '00000000-0000-0000-0000-000000000001'::uuid);
  e := public.fn_brand_effective(v_site, true);
  RETURN jsonb_build_object(
    'site_id', v_site,
    'deposit_provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', (e->>'limits.min_deposit')::numeric, 'max_deposit', (e->>'limits.max_deposit')::numeric,
    'deposit_chips', e->'limits.deposit_chips',
    'min_withdrawal', (e->>'limits.min_withdrawal')::numeric,
    'max_withdrawal', (e->>'limits.max_withdrawal')::numeric, 'daily_withdrawal', (e->>'limits.daily_withdrawal')::numeric,
    'min_bet', (e->>'limits.min_bet')::numeric, 'max_bet', (e->>'limits.max_bet')::numeric,
    'max_payout', (e->>'limits.max_payout')::numeric, 'default_bet', (e->>'limits.default_bet')::numeric,
    'bet_chips', e->'limits.bet_chips',
    'deposits', (e->>'features.deposits')::boolean AND NOT (e->>'features.maintenance')::boolean,
    'withdrawals', (e->>'features.withdrawals')::boolean AND NOT (e->>'features.maintenance')::boolean,
    'offer', CASE WHEN (e->>'bonus.welcome_enabled')::boolean OR (e->>'bonus.deposit_enabled')::boolean THEN jsonb_build_object(
        'welcome', CASE WHEN (e->>'bonus.welcome_enabled')::boolean THEN (e->>'bonus.welcome_amount')::numeric ELSE 0 END,
        'match_pct', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_pct')::numeric ELSE 0 END,
        'match_cap', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_cap')::numeric ELSE 0 END,
        'wager_x', greatest((e->>'bonus.welcome_wager_x')::numeric, (e->>'bonus.deposit_wager_x')::numeric)) END);
END $$;
REVOKE ALL ON FUNCTION public.fn_public_payment_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_payment_config(uuid) TO anon, authenticated, service_role;

-- ── withdrawals ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_site uuid; v_min numeric; v_maxreq numeric; v_daily numeric; v_thr numeric; v_today numeric;
  v_real_cents bigint; v_id uuid; v_auto boolean;
  v_risk jsonb; v_score int; v_flags jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.fn_platform_switch('withdrawals_enabled') THEN RAISE EXCEPTION 'WITHDRAWALS_DISABLED'; END IF;
  IF public.fn_is_marketer_account(v_uid) THEN RAISE EXCEPTION 'MARKETER_DEMO_NON_WITHDRAWABLE'; END IF;
  SELECT site_id INTO v_site FROM profiles WHERE id = v_uid;
  IF public._brand_bool(v_site, 'features.maintenance') THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT public._brand_bool(v_site, 'features.withdrawals') THEN RAISE EXCEPTION 'WITHDRAWALS_DISABLED'; END IF;
  v_min    := coalesce(public._brand_num(v_site, 'limits.min_withdrawal'), 100);
  v_maxreq := public._brand_num(v_site, 'limits.max_withdrawal');
  v_daily  := public._brand_num(v_site, 'limits.daily_withdrawal');
  v_thr    := coalesce(public._brand_num(v_site, 'limits.auto_approve'), 5000);
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  IF v_maxreq IS NOT NULL AND p_amount > v_maxreq THEN RAISE EXCEPTION 'AMOUNT_TOO_HIGH: maximum is %', v_maxreq; END IF;
  SELECT real_balance INTO v_real_cents FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_real_cents IS NULL           THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_real_cents < round(p_amount*100)::bigint THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;
  IF v_daily IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO v_today FROM withdrawal_requests
     WHERE user_id = v_uid AND status NOT IN ('rejected','failed','cancelled')
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi');
    IF v_today + p_amount > v_daily THEN RAISE EXCEPTION 'DAILY_LIMIT: % left today', greatest(v_daily - v_today, 0); END IF;
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

-- ── sign-up + bonuses ────────────────────────────────────────────────────────────────────────
SELECT public._patch_fn('public.handle_new_user()',
  '  IF _avatar IS NULL OR _avatar = '''' THEN',
  '  IF NOT public._brand_bool(_site, ''features.registrations'') THEN RAISE EXCEPTION ''REGISTRATIONS_DISABLED''; END IF;

  IF _avatar IS NULL OR _avatar = '''' THEN');

CREATE OR REPLACE FUNCTION public.fn_grant_welcome_bonus(p_user uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_amt bigint; v_wx numeric; v_site uuid; v_bid uuid;
BEGIN
  IF public.fn_is_marketer_account(p_user) THEN RETURN 0; END IF;
  SELECT site_id INTO v_site FROM public.wallets WHERE user_id = p_user FOR UPDATE;
  IF NOT found THEN RETURN 0; END IF;
  IF NOT public._brand_bool(v_site, 'bonus.welcome_enabled') THEN RETURN 0; END IF;
  v_amt := round(coalesce(public._brand_num(v_site, 'bonus.welcome_amount'), 0) * 100)::bigint;
  v_wx  := coalesce(public._brand_num(v_site, 'bonus.welcome_wager_x'), 1);
  IF v_amt <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bonuses WHERE user_id = p_user AND type = 'welcome') THEN RETURN 0; END IF;
  INSERT INTO public.bonuses(user_id, site_id, type, amount, wagering_x, status)
    VALUES (p_user, v_site, 'welcome', v_amt, v_wx, 'active')
    ON CONFLICT DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NULL THEN RETURN 0; END IF;
  PERFORM public._wallet_move(p_user, v_amt, 'bonus', 'welcome_bonus', 'bonuses', v_bid::text);
  INSERT INTO public.transactions(user_id, type, amount, description, status, site_id)
    VALUES (p_user, 'bonus', (v_amt::numeric/100.0),
            'Welcome bonus - KSh ' || (v_amt/100)::int || ' (wager ' || v_wx || 'x to unlock)', 'completed', v_site);
  RETURN v_amt;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_grant_first_deposit_bonus()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pct numeric; v_cap bigint; v_wx numeric; v_dep bigint; v_bonus bigint; v_site uuid; v_bid uuid;
BEGIN
  IF NEW.type <> 'deposit' OR coalesce(NEW.payment_method,'') <> 'mpesa' OR NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF public.fn_is_marketer_account(NEW.user_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.bonuses WHERE user_id = NEW.user_id AND type = 'first_deposit_match') THEN RETURN NEW; END IF;
  SELECT site_id INTO v_site FROM public.wallets WHERE user_id = NEW.user_id FOR UPDATE;
  IF NOT found THEN RETURN NEW; END IF;
  IF NOT public._brand_bool(v_site, 'bonus.deposit_enabled') THEN RETURN NEW; END IF;
  v_pct := coalesce(public._brand_num(v_site, 'bonus.deposit_pct'), 0);
  v_cap := round(coalesce(public._brand_num(v_site, 'bonus.deposit_cap'), 0) * 100)::bigint;
  v_wx  := coalesce(public._brand_num(v_site, 'bonus.deposit_wager_x'), 1);
  v_dep   := round(NEW.amount * 100)::bigint;
  v_bonus := least(floor(v_dep * (v_pct/100.0))::bigint, v_cap);
  IF v_bonus <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.bonuses(user_id, site_id, type, amount, wagering_x, deposit_tx_id, status)
    VALUES (NEW.user_id, v_site, 'first_deposit_match', v_bonus, v_wx, NEW.id, 'active')
    ON CONFLICT DO NOTHING RETURNING id INTO v_bid;
  IF v_bid IS NULL THEN RETURN NEW; END IF;
  PERFORM public._wallet_move(NEW.user_id, v_bonus, 'bonus', 'bonus', 'bonuses', v_bid::text);
  INSERT INTO public.transactions(user_id, type, amount, description, status, site_id)
    VALUES (NEW.user_id, 'bonus', (v_bonus::numeric/100.0),
            'First-deposit match (' || v_pct::int || '%, wager ' || v_wx || 'x to unlock)', 'completed', v_site);
  RETURN NEW;
END $function$;

-- ── promo codes, rain, chat ──────────────────────────────────────────────────────────────────
SELECT public._patch_fn('public.redeem_promo_code(text)',
  'IF v_role <> ''player'' THEN RAISE EXCEPTION ''ONLY_PLAYERS''; END IF;',
  'IF v_role <> ''player'' THEN RAISE EXCEPTION ''ONLY_PLAYERS''; END IF;
  IF NOT public._brand_bool(v_site, ''features.promo_codes'') THEN RAISE EXCEPTION ''PROMO_DISABLED''; END IF;');
SELECT public._patch_fn('public.claim_rain(uuid)',
  '  SELECT * INTO v_ev FROM rain_events WHERE id=p_rain_id FOR UPDATE;',
  '  IF NOT public._brand_bool((SELECT site_id FROM profiles WHERE id = v_uid), ''features.rain'') THEN RAISE EXCEPTION ''RAIN_DISABLED''; END IF;
  SELECT * INTO v_ev FROM rain_events WHERE id=p_rain_id FOR UPDATE;');

DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.chat_messages;
CREATE POLICY "Authenticated users can send messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.fn_my_feature('features.chat')));

COMMIT;
