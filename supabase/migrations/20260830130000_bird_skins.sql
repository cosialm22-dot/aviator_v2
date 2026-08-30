-- ============================================================================
-- Extend the site skin allow-list from the 4 plane skins to the 20 bird species.
-- The skin is now a BIRD id (see src/components/game/birds.ts). Existing sites
-- on a plane skin are migrated to the default bird. Additive + idempotent.
-- ============================================================================

-- Migrate any legacy plane skin to the default bird.
UPDATE public.sites
   SET plane_skin = 'fisheagle'
 WHERE plane_skin IS NULL OR plane_skin IN ('crimson','gold','rocket','prop');

-- Re-apply admin_set_site_theme with the 20-bird allow-list.
CREATE OR REPLACE FUNCTION public.admin_set_site_theme(
  p_site_id uuid,
  p_theme_tokens jsonb DEFAULT NULL,
  p_plane_skin text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_allowed text[] := ARRAY[
  'swift','swallow','falcon','martin','bee-eater',
  'fisheagle','augur','vulture','albatross','osprey',
  'weaver','roller','starling','sunbird','sparrow',
  'flamingo','crownedcrane','pelican','heron','hornbill'
];
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
