-- =====================================================================
-- Signup site attribution: handle_new_user() now stamps site_id
-- =====================================================================
-- FINDING (P2b-2 audit): handle_new_user created profile/wallet/ledger_entries/
-- transactions/referrals WITHOUT site_id, so every signup fell to the site_id
-- column DEFAULT (the default site). Multi-brand signups were misattributed to
-- the default site (proved: 6 signups across 2 brands -> all welcome bonuses on
-- the default site).
--
-- FIX: resolve the signup's brand from the auth metadata, then stamp site_id on
-- every row the trigger creates. Resolution priority:
--   1. raw_user_meta_data->>'site_id'   (explicit uuid)
--   2. raw_user_meta_data->>'site_slug' (brand slug)
--   3. default site (00000000-0000-0000-0000-000000000001) -- back-compat
-- An explicitly-provided-but-unresolvable hint FAILS LOUD (RAISE INVALID_SITE):
-- for a real-money platform we never silently misattribute a signup. When NO
-- hint is provided we keep the historical default-site behaviour so the current
-- single-brand frontend is unaffected until it starts passing the brand.
--
-- Also: the referral-code lookup is now SITE-SCOPED (a player may only be
-- referred by a marketer of their own brand) and the default-marketer rooting
-- reads directly from the resolved site.
--
-- Non-money logic (username validation, avatar colour, welcome-bonus amounts)
-- is preserved byte-for-byte. Idempotent (CREATE OR REPLACE).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  INSERT INTO public.wallets (user_id, balance, currency, real_balance, site_id)
    VALUES (NEW.id, 500.00, 'KES', 50000, _site);
  INSERT INTO public.ledger_entries (user_id, type, amount, balance_kind, ref_table, ref_id, site_id)
    VALUES (NEW.id, 'deposit', 50000, 'real', 'signup', NEW.id::text, _site);
  INSERT INTO public.transactions (user_id, type, amount, description, status, site_id)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed', _site);

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

COMMIT;
