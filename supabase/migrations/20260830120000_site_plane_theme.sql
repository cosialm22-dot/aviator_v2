-- ============================================================================
-- Per-site plane skin + theme tokens (Stage 1: diverse planes / brand theming).
-- Borrowed from invest254's brand engine: branding is DATA on the sites row,
-- served live by public_site_by_host, never hard-coded. Adds:
--   * sites.plane_skin  — key into the curated plane set (public/planes/*).
--   * public_site_by_host now returns plane_skin + theme_tokens so the web app
--     can skin the plane + palette per domain with no redeploy.
--   * admin_set_site_theme() — audited super-admin write for theme + plane.
-- Additive + idempotent; default brand keeps the classic red plane.
-- ============================================================================

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS plane_skin text;

-- Default brand keeps the existing red plane.
UPDATE public.sites SET plane_skin = 'crimson'
 WHERE id = '00000000-0000-0000-0000-000000000001' AND plane_skin IS NULL;

-- ---------------------------------------------------------------------------
-- public_site_by_host: add plane_skin + theme_tokens to the public payload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_site_by_host(p_host text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb; _h text := lower(nullif(trim(p_host), ''));
BEGIN
  IF _h IS NOT NULL THEN
    SELECT to_jsonb(s) INTO v FROM (
      SELECT id AS site_id, slug, name, status, theme,
             color_primary, color_bg, color_accent, wordmark_text,
             logo_url, favicon_url, currency, locale, withdrawals_enabled,
             plane_skin, theme_tokens
      FROM public.sites WHERE lower(primary_domain) = _h
      ORDER BY (status = 'active') DESC LIMIT 1
    ) s;
  END IF;
  IF v IS NULL THEN
    SELECT to_jsonb(s) INTO v FROM (
      SELECT id AS site_id, slug, name, status, theme,
             color_primary, color_bg, color_accent, wordmark_text,
             logo_url, favicon_url, currency, locale, withdrawals_enabled,
             plane_skin, theme_tokens
      FROM public.sites WHERE id = '00000000-0000-0000-0000-000000000001' LIMIT 1
    ) s;
  END IF;
  RETURN v;
END $function$;

-- ---------------------------------------------------------------------------
-- admin_set_site_theme: super-admin sets a site's theme tokens + plane skin.
-- Audited. plane_skin must be one of the curated set (or NULL = default).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_site_theme(
  p_site_id uuid,
  p_theme_tokens jsonb DEFAULT NULL,
  p_plane_skin text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_allowed text[] := ARRAY['crimson','gold','rocket','prop'];
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_theme_tokens IS NOT NULL AND jsonb_typeof(p_theme_tokens) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_THEME';
  END IF;
  IF p_plane_skin IS NOT NULL AND NOT (p_plane_skin = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_PLANE_SKIN';
  END IF;
  UPDATE public.sites SET
    theme_tokens = coalesce(p_theme_tokens, theme_tokens),
    plane_skin   = coalesce(p_plane_skin, plane_skin),
    updated_at   = now()
   WHERE id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'site_theme_set', 'site', p_site_id::text,
          jsonb_build_object('plane_skin', p_plane_skin, 'has_theme', p_theme_tokens IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'site_id', p_site_id, 'plane_skin', p_plane_skin);
END $function$;

REVOKE ALL ON FUNCTION public.admin_set_site_theme(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_site_theme(uuid, jsonb, text) TO authenticated, service_role;
