-- =====================================================================
-- Borrow #2: Promo codes (adapted from invest254 promo_codes).
-- =====================================================================
-- Redeemable codes that grant a reward to a player. Two reward kinds:
--   * free_bet   -> inserts a free_bets row (fully wired: place_free_bet +
--                   settlement already handle it). Works today.
--   * bonus_cash -> credits wallets.bonus_balance via _wallet_move (reserved;
--                   becomes spendable when the bonus/wagering engine (#3) lands.
--                   wagering_x is carried for that phase).
-- Codes are per-brand (unique per site), with total + per-user redemption caps
-- and optional expiry. Redemption is a SECURITY DEFINER RPC (row-locked to be
-- race-safe); admin management is site-scoped. Idempotent.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.sites(id),
  code            text NOT NULL,
  reward_kind     text NOT NULL CHECK (reward_kind IN ('free_bet','bonus_cash')),
  reward_value    numeric NOT NULL CHECK (reward_value > 0),
  wagering_x      numeric NOT NULL DEFAULT 1.0 CHECK (wagering_x >= 0),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_user_limit  integer NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  redeemed_count  integer NOT NULL DEFAULT 0,
  expires_at      timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- One code per brand (two brands may share a code string).
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_codes_site_code ON public.promo_codes (site_id, code);

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id    uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.sites(id),
  reward_kind text NOT NULL,
  amount      numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON public.promo_redemptions (promo_id, user_id);

-- RLS: both tables are RPC-only (no direct client access).
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promo_codes FROM anon, authenticated;
REVOKE ALL ON public.promo_redemptions FROM anon, authenticated;

-- site_id auto-stamp for the user-owned redemptions (owner = user_id).
DROP TRIGGER IF EXISTS trg_inherit_site ON public.promo_redemptions;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.promo_redemptions
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

-- ---- Player redemption (race-safe) ---------------------------------
CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
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
  END IF;

  INSERT INTO public.promo_redemptions (promo_id, user_id, reward_kind, amount)
  VALUES (v.id, v_uid, v.reward_kind, v.reward_value);
  UPDATE public.promo_codes SET redeemed_count = redeemed_count + 1, updated_at = now() WHERE id = v.id;

  RETURN jsonb_build_object('reward_kind', v.reward_kind, 'amount', v.reward_value,
                            'message', CASE v.reward_kind
                              WHEN 'free_bet' THEN 'Free bet of KSh '||v.reward_value||' added!'
                              ELSE 'Bonus of KSh '||v.reward_value||' credited!' END);
END $function$;

-- ---- Admin management (site-scoped) --------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_promo_code(
   p_code text, p_reward_kind text, p_reward_value numeric,
   p_max_redemptions integer DEFAULT NULL, p_per_user_limit integer DEFAULT 1,
   p_expires_at timestamptz DEFAULT NULL, p_active boolean DEFAULT true,
   p_wagering_x numeric DEFAULT 1.0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_site uuid; v_code text; v_id uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_site := current_site();
  v_code := upper(trim(coalesce(p_code,'')));
  IF v_code = '' OR v_code !~ '^[A-Z0-9][A-Z0-9_-]{1,30}$' THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  IF p_reward_kind NOT IN ('free_bet','bonus_cash') THEN RAISE EXCEPTION 'INVALID_REWARD_KIND'; END IF;
  IF p_reward_value IS NULL OR p_reward_value <= 0 THEN RAISE EXCEPTION 'INVALID_REWARD_VALUE'; END IF;

  INSERT INTO public.promo_codes (site_id, code, reward_kind, reward_value, wagering_x,
                                  max_redemptions, per_user_limit, expires_at, active, created_by, updated_at)
  VALUES (v_site, v_code, p_reward_kind, p_reward_value, coalesce(p_wagering_x,1.0),
          p_max_redemptions, coalesce(p_per_user_limit,1), p_expires_at, coalesce(p_active,true), auth.uid(), now())
  ON CONFLICT (site_id, code) DO UPDATE SET
    reward_kind=excluded.reward_kind, reward_value=excluded.reward_value, wagering_x=excluded.wagering_x,
    max_redemptions=excluded.max_redemptions, per_user_limit=excluded.per_user_limit,
    expires_at=excluded.expires_at, active=excluded.active, updated_at=now()
  RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'promo_upsert', 'promo_code', v_code,
          jsonb_build_object('reward_kind',p_reward_kind,'reward_value',p_reward_value), v_site);
  RETURN jsonb_build_object('id', v_id, 'code', v_code);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_promo_active(p_code text, p_active boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_site uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_site := current_site();
  UPDATE public.promo_codes SET active = coalesce(p_active,false), updated_at = now()
   WHERE site_id = (CASE WHEN _is_platform_superadmin() THEN site_id ELSE v_site END)
     AND code = upper(trim(coalesce(p_code,'')))
     AND (_is_platform_superadmin() OR site_id = v_site);
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('code', upper(trim(p_code)), 'active', coalesce(p_active,false));
END $function$;

CREATE OR REPLACE FUNCTION public.admin_list_promo_codes()
 RETURNS TABLE(id uuid, site_id uuid, code text, reward_kind text, reward_value numeric,
   wagering_x numeric, max_redemptions integer, per_user_limit integer, redeemed_count integer,
   expires_at timestamptz, active boolean, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT p.id, p.site_id, p.code, p.reward_kind, p.reward_value, p.wagering_x,
         p.max_redemptions, p.per_user_limit, p.redeemed_count, p.expires_at, p.active, p.created_at
  FROM public.promo_codes p
  WHERE _is_platform_superadmin() OR p.site_id = current_site()
  ORDER BY p.created_at DESC;
END $function$;

COMMIT;
