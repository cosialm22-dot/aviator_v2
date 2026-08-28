-- =====================================================================
-- public_site_by_host: anon-callable brand resolver for the web app
-- =====================================================================
-- The web app is a single shared codebase serving many branded domains
-- (the franchise-chain model). On boot it must learn which brand it is
-- serving so signups attribute to the right site (see handle_new_user's
-- site_slug metadata) and theming can follow. The `sites` table is not
-- anon-readable (RLS lockdown), so this SECURITY DEFINER RPC exposes ONLY
-- public brand fields (never mpesa creds / master seed / owner / notes),
-- matched by primary_domain, falling back to the default site.
-- Idempotent.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.public_site_by_host(p_host text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb; _h text := lower(nullif(trim(p_host), ''));
BEGIN
  -- Public, non-sensitive brand fields only.
  IF _h IS NOT NULL THEN
    SELECT to_jsonb(s) INTO v FROM (
      SELECT id AS site_id, slug, name, status, theme,
             color_primary, color_bg, color_accent, wordmark_text,
             logo_url, favicon_url, currency, locale, withdrawals_enabled
      FROM public.sites WHERE lower(primary_domain) = _h
      ORDER BY (status = 'active') DESC LIMIT 1
    ) s;
  END IF;
  IF v IS NULL THEN
    SELECT to_jsonb(s) INTO v FROM (
      SELECT id AS site_id, slug, name, status, theme,
             color_primary, color_bg, color_accent, wordmark_text,
             logo_url, favicon_url, currency, locale, withdrawals_enabled
      FROM public.sites WHERE id = '00000000-0000-0000-0000-000000000001' LIMIT 1
    ) s;
  END IF;
  RETURN v;
END $function$;

-- Callable by the public web client (anon) and logged-in users.
REVOKE ALL ON FUNCTION public.public_site_by_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_site_by_host(text) TO anon, authenticated;

COMMIT;
