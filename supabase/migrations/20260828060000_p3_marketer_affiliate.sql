-- =====================================================================
-- 20260828060000_p3_marketer_affiliate.sql
-- Borrow P3: per-site marketer/affiliate (invest254 docs 09/19/29).
--
-- Aviator's affiliate model is flat + GLOBAL (single marketing_config rate,
-- all-time GGR). This phase makes it PER-SITE and roots unattributed players at
-- each brand's DEFAULT MARKETER (invest254: "rooted at each brand's default
-- marketer"), while preserving the existing on-demand commission contracts
-- (_marketer_ggr / _marketer_commission_earned / marketer_dashboard).
--
--   commission(marketer) = Σ_site  GGR(referred players on site) × rate(site)
--   GGR = Σ(bet.amount − bet.winnings) over qualified referred players' real bets
--
-- Marketer demo isolation already enforced in P1b (marketers play demo money).
-- NON-BREAKING: per-site config falls back to global marketing_config; default
-- marketer rooting only activates when a site sets default_marketer_id.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Per-site affiliate config on site_game_config (seeded from global).
-- ---------------------------------------------------------------------
ALTER TABLE public.site_game_config
  ADD COLUMN IF NOT EXISTS commission_rate        numeric,
  ADD COLUMN IF NOT EXISTS qualifying_deposit_cents bigint;

ALTER TABLE public.site_game_config DROP CONSTRAINT IF EXISTS site_cfg_commission_valid;
ALTER TABLE public.site_game_config ADD CONSTRAINT site_cfg_commission_valid
  CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));

UPDATE public.site_game_config c
   SET commission_rate = coalesce(c.commission_rate,
        (SELECT commission_rate FROM public.marketing_config WHERE id = true), 0.25),
       qualifying_deposit_cents = coalesce(c.qualifying_deposit_cents,
        round(coalesce((SELECT qualifying_deposit_min FROM public.marketing_config WHERE id = true),50)*100)::bigint);

-- ---------------------------------------------------------------------
-- 2) Default marketer per brand (roots unattributed players).
-- ---------------------------------------------------------------------
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS default_marketer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3) Per-site readers.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._site_commission_rate(p_site uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce(
    (SELECT commission_rate FROM site_game_config WHERE site_id = p_site),
    (SELECT commission_rate FROM marketing_config WHERE id = true),
    0.25);
$$;

-- Effective marketer for a player: explicit referrer, else the brand default.
CREATE OR REPLACE FUNCTION public.fn_effective_marketer(p_player uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce(
    (SELECT referred_by FROM profiles WHERE id = p_player),
    (SELECT s.default_marketer_id FROM profiles p JOIN sites s ON s.id = p.site_id WHERE p.id = p_player));
$$;

-- ---------------------------------------------------------------------
-- 4) Per-site GGR + commission (preserve no-arg contracts; add site overloads).
-- ---------------------------------------------------------------------
-- Per-site GGR for a marketer's qualified referred players on one site.
CREATE OR REPLACE FUNCTION public._marketer_ggr(p_marketer uuid, p_site uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT greatest(coalesce(sum(b.amount),0) - coalesce(sum(b.winnings),0), 0)
  FROM referrals r
  JOIN bets b ON b.user_id = r.player_id AND b.is_bot = false AND b.site_id = p_site
  WHERE r.marketer_id = p_marketer AND r.status = 'qualified';
$$;

-- Total GGR across all sites (backward-compatible signature).
CREATE OR REPLACE FUNCTION public._marketer_ggr(p_marketer uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT greatest(coalesce(sum(b.amount),0) - coalesce(sum(b.winnings),0), 0)
  FROM referrals r
  JOIN bets b ON b.user_id = r.player_id AND b.is_bot = false
  WHERE r.marketer_id = p_marketer AND r.status = 'qualified';
$$;

-- Commission = Σ over sites (site GGR × site rate) — respects per-brand rates.
CREATE OR REPLACE FUNCTION public._marketer_commission_earned(p_marketer uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT round(coalesce(sum(
           greatest(coalesce(t.stakes,0) - coalesce(t.wins,0),0) * public._site_commission_rate(t.site_id)
         ),0), 2)
  FROM (
    SELECT b.site_id, sum(b.amount) stakes, sum(b.winnings) wins
    FROM referrals r
    JOIN bets b ON b.user_id = r.player_id AND b.is_bot = false
    WHERE r.marketer_id = p_marketer AND r.status = 'qualified'
    GROUP BY b.site_id
  ) t;
$$;

-- ---------------------------------------------------------------------
-- 5) Deposit qualification uses the depositing player's SITE threshold.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._referral_qualify_on_deposit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_min numeric; v_site uuid;
BEGIN
  IF NEW.type = 'deposit' AND NEW.status = 'completed' AND NEW.payment_method = 'mpesa' THEN
    SELECT site_id INTO v_site FROM profiles WHERE id = NEW.user_id;
    v_min := coalesce(
      (SELECT qualifying_deposit_cents/100.0 FROM site_game_config WHERE site_id = v_site),
      (SELECT qualifying_deposit_min FROM marketing_config WHERE id = true), 50);
    IF NEW.amount >= v_min THEN
      UPDATE referrals SET status = 'qualified', qualified_at = now(), first_deposit_amount = NEW.amount
       WHERE player_id = NEW.user_id AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 6) Per-site commission-rate admin (site admin or platform). Keeps the legacy
--    global setter for backward-compat.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_commission_rate(p_rate numeric, p_site uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_old numeric;
BEGIN
  IF NOT public._can_admin_site(p_site) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN RAISE EXCEPTION 'INVALID_RATE: must be in [0,1]'; END IF;
  SELECT commission_rate INTO v_old FROM site_game_config WHERE site_id = p_site;
  UPDATE site_game_config SET commission_rate = p_rate, updated_by = auth.uid() WHERE site_id = p_site;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'commission_rate_changed', 'site_game_config', p_site::text,
          jsonb_build_object('old', v_old, 'new', p_rate, 'site_id', p_site), p_site);
  RETURN jsonb_build_object('commission_rate', p_rate, 'site_id', p_site);
END $function$;

-- ---------------------------------------------------------------------
-- 7) Root unattributed players at the brand default marketer on signup.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid; _default_mk uuid;
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
  INSERT INTO public.wallets (user_id, balance, currency, real_balance) VALUES (NEW.id, 500.00, 'KES', 50000);
  INSERT INTO public.ledger_entries (user_id, type, amount, balance_kind, ref_table, ref_id)
    VALUES (NEW.id, 'deposit', 50000, 'real', 'signup', NEW.id::text);
  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed');
  -- Attribution: explicit referrer, else the brand's default marketer (if set).
  IF _marketer IS NULL THEN
    SELECT s.default_marketer_id INTO _default_mk
      FROM profiles p JOIN sites s ON s.id = p.site_id WHERE p.id = NEW.id;
    _marketer := _default_mk;
  END IF;
  IF _marketer IS NOT NULL THEN
    INSERT INTO public.referrals (marketer_id, player_id, status)
      VALUES (_marketer, NEW.id, 'pending') ON CONFLICT (player_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;

COMMIT;
