-- =====================================================================
-- 20260828050000_p2_roles_guards.sql
-- Borrow P2: role ladder canonicalization + site-scoped guards (invest254 §6).
--
--   platform_superadmin  (root; sees ALL sites — the central console)
--     └ super_admin (legacy alias) / admin / finance_admin / support  (per site)
--         └ marketer (per site)
--             └ player (per site)
--
-- - Canonicalize the root account to `platform_superadmin` and update
--   _enforce_super_admin_lock so THAT role is the protected root role.
-- - Add site-scope helpers: current_site(), _is_platform_superadmin(),
--   _can_admin_site(site) (requireSite equivalent).
-- - Add the `site_id` SECOND DIMENSION to the admin RLS policies so a brand
--   admin can only touch their own site's rows; platform_superadmin sees all.
--   Global config tables (system_settings, mpesa_config) become platform-only.
--
-- NOTE: SECURITY DEFINER admin_* RPCs bypass RLS (owner). Per-function site
-- scoping (requireSite inside each admin_* RPC) is deferred to P2b/P4, and is
-- not yet an isolation gap because the only privileged account today is the
-- platform_superadmin (who legitimately sees all). It becomes relevant when a
-- per-site admin is provisioned during brand onboarding (P4).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Role helpers (widen to the ladder; add platform tier + site scope)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_platform_superadmin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'platform_superadmin'); $$;

CREATE OR REPLACE FUNCTION public._is_super_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('platform_superadmin','super_admin')); $$;

CREATE OR REPLACE FUNCTION public._is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
        AND role IN ('platform_superadmin','super_admin','admin','finance_admin')); $$;

-- caller's home site (auth model = single global identity; site scopes data)
CREATE OR REPLACE FUNCTION public.current_site()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT site_id FROM profiles WHERE id = auth.uid(); $$;

-- requireSite: may the caller administer THIS site? platform sees all; a scoped
-- admin/finance/support may only administer their own site.
CREATE OR REPLACE FUNCTION public._can_admin_site(p_site uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT public._is_platform_superadmin()
      OR EXISTS (SELECT 1 FROM profiles
                  WHERE id = auth.uid()
                    AND role IN ('super_admin','admin','finance_admin','support')
                    AND site_id = p_site);
$$;

-- ---------------------------------------------------------------------
-- 2) Root protection re-based on platform_superadmin
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enforce_super_admin_lock()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = public._root_super_admin() THEN
      RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED: the platform super admin cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id = public._root_super_admin() THEN
      NEW.role := 'platform_superadmin'; NEW.is_banned := false; NEW.ban_reason := NULL; NEW.banned_at := NULL;
      RETURN NEW;
    END IF;
    IF NEW.role = 'platform_superadmin' THEN
      RAISE EXCEPTION 'PLATFORM_SUPERADMIN_LOCKED: only the designated root may hold this role';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.id = public._root_super_admin() THEN
    NEW.role := 'platform_superadmin';                 -- force canonical (also permits the migration below)
    IF coalesce(NEW.is_banned, false) THEN
      RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED: the platform super admin cannot be banned';
    END IF;
  ELSE
    IF NEW.role = 'platform_superadmin' THEN
      RAISE EXCEPTION 'PLATFORM_SUPERADMIN_LOCKED: only the designated root may hold this role';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Canonicalize the root account (super_admin -> platform_superadmin).
UPDATE public.profiles SET role = 'platform_superadmin' WHERE id = public._root_super_admin();

-- ---------------------------------------------------------------------
-- 3) Operator bet block covers the whole operator set
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_operator_bets()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NEW.is_bot = false AND NEW.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id
                  AND role IN ('platform_superadmin','super_admin','admin','finance_admin','support')) THEN
    RAISE EXCEPTION 'OPERATORS_CANNOT_BET';
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 4) RLS second dimension: site-scope the admin policies.
-- ---------------------------------------------------------------------
DO $do$
DECLARE t text;
DECLARE scoped text[] := ARRAY['admin_audit_log','crash_queue','mpesa_stk_requests',
                               'player_risk_scores','withdrawal_requests'];
BEGIN
  FOREACH t IN ARRAY scoped LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_full_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY admin_full_access ON public.%I FOR ALL TO public '
      || 'USING (public._can_admin_site(site_id)) WITH CHECK (public._can_admin_site(site_id))', t);
  END LOOP;
END $do$;

-- Global (non-tenant) config tables -> platform owner only.
DROP POLICY IF EXISTS admin_full_access ON public.system_settings;
CREATE POLICY admin_full_access ON public.system_settings FOR ALL TO public
  USING (public._is_super_admin()) WITH CHECK (public._is_super_admin());
DROP POLICY IF EXISTS admin_full_access ON public.mpesa_config;
CREATE POLICY admin_full_access ON public.mpesa_config FOR ALL TO public
  USING (public._is_super_admin()) WITH CHECK (public._is_super_admin());

COMMIT;
