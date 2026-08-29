-- =====================================================================
-- 20260829060000_platform_global_config.sql
-- Borrow #7: versioned platform-wide master controls (invest254 0092 core).
-- One platform_superadmin console that OVERRIDES all brands with master
-- kill-switches (deposits/withdrawals/play/marketers/registrations) + an
-- optional maintenance banner. Durable, VERSIONED (immutable snapshots),
-- AUDITED (admin_audit_log), and NOTIFY on change ('platform_config_changed').
--
-- SCOPE (grounded exclusions):
--   * OMITS 0092's withdrawal-pool distributor (managed-book / provable-fairness
--     line — excluded platform-wide).
--   * OMITS 0099's per-cohort ECONOMY overrides (house edge / win rate / max
--     multiplier): redundant with aviator's existing global system_settings and
--     would need engine wiring; the odds-shading part is the fairness line.
--
-- Enforced NOW at DB gates: play (place_bet), withdrawals (request_withdrawal),
--   registrations (handle_new_user), marketers (admin_promote_to_marketer).
--   deposits_enabled is stored + surfaced but enforced at STK-push (edge) -> staged.
-- Defaults all-ON => behaviour-neutral until the console flips a switch.
-- Function bodies below are the EXACT current live definitions with ONE guard
--   line added each; all other logic preserved verbatim. Additive + idempotent.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_global_config (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),   -- singleton
  deposits_enabled      boolean NOT NULL DEFAULT true,
  withdrawals_enabled   boolean NOT NULL DEFAULT true,
  play_enabled          boolean NOT NULL DEFAULT true,
  marketers_enabled     boolean NOT NULL DEFAULT true,
  registrations_enabled boolean NOT NULL DEFAULT true,
  maintenance_message   text,
  version               int NOT NULL DEFAULT 1,
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_global_config(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_global_config_versions (
  version    int PRIMARY KEY,
  snapshot   jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_global_config          ENABLE ROW LEVEL SECURITY;  -- no policies: RPC-only
ALTER TABLE public.platform_global_config_versions ENABLE ROW LEVEL SECURITY;

-- Fast switch reader (default-ALLOW if the row is somehow absent).
CREATE OR REPLACE FUNCTION public.fn_platform_switch(p_field text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce((
    SELECT CASE p_field
             WHEN 'deposits_enabled'      THEN deposits_enabled
             WHEN 'withdrawals_enabled'   THEN withdrawals_enabled
             WHEN 'play_enabled'          THEN play_enabled
             WHEN 'marketers_enabled'     THEN marketers_enabled
             WHEN 'registrations_enabled' THEN registrations_enabled
             ELSE true END
      FROM public.platform_global_config WHERE id), true);
$$;

-- Public read (switches + banner) for the frontend/landing.
CREATE OR REPLACE FUNCTION public.fn_platform_get_global_config()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT to_jsonb(g) FROM public.platform_global_config g WHERE g.id; $$;

-- Set switches / banner: platform_superadmin only; versioned + audited + notify.
CREATE OR REPLACE FUNCTION public.fn_platform_set_global_config(p_patch jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE g public.platform_global_config;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'platform_superadmin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;
  UPDATE public.platform_global_config SET
    deposits_enabled      = coalesce((p_patch->>'deposits_enabled')::boolean,      deposits_enabled),
    withdrawals_enabled   = coalesce((p_patch->>'withdrawals_enabled')::boolean,   withdrawals_enabled),
    play_enabled          = coalesce((p_patch->>'play_enabled')::boolean,          play_enabled),
    marketers_enabled     = coalesce((p_patch->>'marketers_enabled')::boolean,     marketers_enabled),
    registrations_enabled = coalesce((p_patch->>'registrations_enabled')::boolean, registrations_enabled),
    maintenance_message   = CASE WHEN p_patch ? 'maintenance_message'
                                 THEN nullif(p_patch->>'maintenance_message','') ELSE maintenance_message END,
    version    = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
   WHERE id RETURNING * INTO g;
  INSERT INTO public.platform_global_config_versions(version, snapshot, changed_by)
    VALUES (g.version, to_jsonb(g), auth.uid());
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'platform_config_set', 'platform', 'global',
            jsonb_build_object('patch', p_patch, 'version', g.version));
  PERFORM pg_notify('platform_config_changed', g.version::text);
  RETURN to_jsonb(g);
END $fn$;

DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public.fn_platform_switch(text)              FROM public;
  REVOKE ALL ON FUNCTION public.fn_platform_get_global_config()       FROM public;
  GRANT  EXECUTE ON FUNCTION public.fn_platform_get_global_config()    TO anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.fn_platform_set_global_config(jsonb)  FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_platform_set_global_config(jsonb) TO authenticated, service_role;
END
$g$;

-- =====================================================================
-- Gate injections (exact live bodies + ONE guard line each)
-- =====================================================================

-- place_bet: block when play_enabled = false
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
  IF NOT public.fn_platform_switch('play_enabled') THEN RAISE EXCEPTION 'PLAY_DISABLED'; END IF;
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

-- request_withdrawal: block when withdrawals_enabled = false
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
  IF NOT public.fn_platform_switch('withdrawals_enabled') THEN RAISE EXCEPTION 'WITHDRAWALS_DISABLED'; END IF;
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

-- handle_new_user: block signup when registrations_enabled = false
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid; _default_mk uuid;
  _site uuid; _site_id_hint text; _site_slug_hint text;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  IF NOT public.fn_platform_switch('registrations_enabled') THEN RAISE EXCEPTION 'REGISTRATIONS_DISABLED'; END IF;
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  _ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')), '');

  _site_id_hint   := nullif(trim(coalesce(NEW.raw_user_meta_data->>'site_id', '')), '');
  _site_slug_hint := nullif(trim(coalesce(NEW.raw_user_meta_data->>'site_slug', '')), '');
  IF _site_id_hint IS NOT NULL THEN
    SELECT id INTO _site FROM public.sites WHERE id = _site_id_hint::uuid AND status = 'active';
    IF _site IS NULL THEN RAISE EXCEPTION 'INVALID_SITE: no active site with id %', _site_id_hint; END IF;
  ELSIF _site_slug_hint IS NOT NULL THEN
    SELECT id INTO _site FROM public.sites WHERE slug = lower(_site_slug_hint) AND status = 'active';
    IF _site IS NULL THEN RAISE EXCEPTION 'INVALID_SITE: no active site with slug %', _site_slug_hint; END IF;
  ELSE
    _site := '00000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN RAISE EXCEPTION 'Username is required'; END IF;
  IF char_length(trim(_username)) < 3 THEN RAISE EXCEPTION 'Username must be at least 3 characters'; END IF;

  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer FROM public.profiles
     WHERE referral_code = upper(_ref) AND role = 'marketer' AND site_id = _site AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, username, avatar_color, phone_number, referred_by, site_id)
    VALUES (NEW.id, trim(_username), _avatar, _phone, _marketer, _site);
  INSERT INTO public.wallets (user_id, balance, currency, real_balance, site_id)
    VALUES (NEW.id, 0, 'KES', 0, _site);
  PERFORM public.fn_grant_welcome_bonus(NEW.id);

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

-- admin_promote_to_marketer: block when marketers_enabled = false
CREATE OR REPLACE FUNCTION public.admin_promote_to_marketer(p_username text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_role text; v_code text;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public.fn_platform_switch('marketers_enabled') THEN RAISE EXCEPTION 'MARKETERS_DISABLED'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE lower(username) = lower(trim(p_username)))) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  SELECT id, role INTO v_id, v_role FROM profiles WHERE lower(username) = lower(trim(p_username));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'CANNOT_CONVERT_OPERATOR'; END IF;
  IF v_role = 'marketer' THEN RAISE EXCEPTION 'ALREADY_MARKETER'; END IF;
  UPDATE profiles SET role = 'marketer' WHERE id = v_id;
  v_code := _ensure_referral_code(v_id);
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'marketer_promoted', 'user', v_id::text,
          jsonb_build_object('old', v_role, 'new', 'marketer', 'referral_code', v_code));
  RETURN jsonb_build_object('user_id', v_id, 'username', trim(p_username), 'role', 'marketer', 'referral_code', v_code);
END $function$;

COMMIT;
-- REVERT: restore the 4 functions from their prior migrations; drop
--   fn_platform_switch / fn_platform_get_global_config / fn_platform_set_global_config;
--   drop platform_global_config_versions, platform_global_config.
