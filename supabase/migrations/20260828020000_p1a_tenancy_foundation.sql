-- =====================================================================
-- 20260828020000_p1a_tenancy_foundation.sql
-- Borrow P1a: multi-tenant SKELETON (from invest254 migs 0044/0045 + roles).
--
-- Model (invest254 "franchise chain"): one DB serves many branded sites tied by
-- `site_id`. This migration is INTENTIONALLY additive & NON-BREAKING:
--   * `site_id` is added with a DEFAULT of the default Aviator site, so every
--     existing SECURITY DEFINER money/game RPC keeps inserting valid rows without
--     yet being aware of tenancy. P1b/P1c then stamp site_id explicitly and add
--     per-site game config + the cents/3-balance money model.
--   * No money math, game functions, or per-site config keying changes here.
--
-- Decisions locked: engine = graft onto aviator SQL/pg_cron; money = cents (P1b);
-- roles = full ladder; pool = per-brand toggle (sites.pool_mode); demo isolation (P1b/c).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) sites — one row per brand (mirrors invest254 0044, adapted for KES)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sites (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        text UNIQUE NOT NULL,
  status                      text NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','suspended','disabled')),
  name                        text NOT NULL,
  primary_domain              text UNIQUE,
  logo_url                    text,
  favicon_url                 text,
  color_primary               text,
  color_bg                    text,
  color_accent                text,
  theme                       text DEFAULT 'dark',
  wordmark_text               text,
  currency                    text NOT NULL DEFAULT 'KES',
  locale                      text NOT NULL DEFAULT 'en-KE',
  licence_line                text,
  support_email               text,
  legal_copy                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Payments: per-brand M-Pesa, secrets stored BY REFERENCE (never plaintext)
  mpesa_env                   text NOT NULL DEFAULT 'sandbox' CHECK (mpesa_env IN ('sandbox','production')),
  mpesa_shortcode             text,
  mpesa_consumer_key_ref      text,
  mpesa_consumer_secret_ref   text,
  mpesa_passkey_ref           text,
  mpesa_b2c_initiator         text,
  mpesa_b2c_credential_ref    text,
  mpesa_callback_base         text,
  -- Fairness: per-brand provably-fair seed lineage (by reference)
  master_seed_ref             text,
  -- Ops / economy
  owner_user_id               uuid,
  notes                       text,
  theme_tokens                jsonb NOT NULL DEFAULT '{}'::jsonb,
  pool_mode                   boolean NOT NULL DEFAULT false,          -- per-brand managed-book toggle
  default_daily_pool_cents    bigint  NOT NULL DEFAULT 0,
  withdrawals_enabled         boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public._sites_touch_updated_at() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sites_updated_at ON public.sites;
CREATE TRIGGER trg_sites_updated_at BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public._sites_touch_updated_at();

-- Default (existing) brand. Fixed id so backfill + code can reference it.
INSERT INTO public.sites (id, slug, name, primary_domain, theme, currency, locale, status)
VALUES ('00000000-0000-0000-0000-000000000001','aviator','Aviator', NULL, 'dark','KES','en-KE','active')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) site_id on every tenant-owned DATA table (default -> default site).
--    Config tables (system_settings, mpesa_config, marketing_config) are left
--    for P1c (per-site config redesign) to keep this migration non-breaking.
-- ---------------------------------------------------------------------
DO $do$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'profiles','wallets','transactions','bets','game_rounds','round_secrets',
  'withdrawal_requests','referrals','commission_payouts','free_bets','rain_claims',
  'rain_events','chat_messages','device_fingerprints','player_risk_scores','promotions',
  'admin_audit_log','mpesa_stk_requests','mpesa_b2c_requests','crash_queue'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='site_id') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN site_id uuid NOT NULL '
        || 'DEFAULT ''00000000-0000-0000-0000-000000000001''::uuid '
        || 'REFERENCES public.sites(id) ON DELETE RESTRICT', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_site_id ON public.%I(site_id)', t, t);
    END IF;
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- 3) Role ladder (adopt invest254's) — additive; existing roles preserved.
--    Target ladder: platform_superadmin > admin (+ finance_admin, support)
--    > marketer > player. We only WIDEN the allowed set here; the canonical
--    promotion of the root (super_admin -> platform_superadmin), the
--    `_enforce_super_admin_lock` update and the API/RLS guards land together in
--    P2 (roles & guards) so the root-account lock is never weakened piecemeal.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('platform_superadmin','super_admin','admin','finance_admin','support','marketer','player'));

-- Make the root operator the default site owner (central-console operator).
UPDATE public.sites SET owner_user_id = public._root_super_admin()
 WHERE id='00000000-0000-0000-0000-000000000001'::uuid
   AND owner_user_id IS NULL;

COMMIT;
