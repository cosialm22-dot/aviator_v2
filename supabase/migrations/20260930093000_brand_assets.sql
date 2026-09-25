-- ============================================================================
-- Multi-brand, step 4: brand assets (uploaded plane images, logos, favicons, app icons, share
-- images) and the referral-link switch.
--
-- Storage bucket "brand-assets": public read (the images appear on public pages), writes only by
-- someone who may edit that brand. Every object lives under "<site_id>/…", and the write policies
-- check the caller against that brand (_brand_can_edit, brand tier) — so a platform admin can only
-- upload into its own brands and a brand owner into its own brand. Raster images only (no SVG: an
-- SVG opened directly runs script on the storage origin), 2 MB each.
--
-- features.referrals: when a brand turns it off, sign-ups that arrive through a ?ref= link are
-- no longer credited to that marketer (the brand's own marketer still gets unreferred players).
-- ============================================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('brand-assets', 'brand-assets', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the caller write object `p_name` (first path segment = the brand's site id)?
CREATE OR REPLACE FUNCTION public.fn_can_manage_brand_asset(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_seg text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_seg !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN public._brand_can_edit(v_seg::uuid, 'brand');
END $$;
REVOKE ALL ON FUNCTION public.fn_can_manage_brand_asset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_manage_brand_asset(text) TO authenticated;

DROP POLICY IF EXISTS "brand assets: editors list" ON storage.objects;
DROP POLICY IF EXISTS "brand assets: editors upload" ON storage.objects;
DROP POLICY IF EXISTS "brand assets: editors replace" ON storage.objects;
DROP POLICY IF EXISTS "brand assets: editors delete" ON storage.objects;
CREATE POLICY "brand assets: editors list" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brand-assets' AND (SELECT public.fn_can_manage_brand_asset(name)));
CREATE POLICY "brand assets: editors upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND (SELECT public.fn_can_manage_brand_asset(name)));
CREATE POLICY "brand assets: editors replace" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND (SELECT public.fn_can_manage_brand_asset(name)))
  WITH CHECK (bucket_id = 'brand-assets' AND (SELECT public.fn_can_manage_brand_asset(name)));
CREATE POLICY "brand assets: editors delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND (SELECT public.fn_can_manage_brand_asset(name)));

-- The referral-link switch now means exactly what the server does with it.
UPDATE public.brand_setting_defs
   SET label = 'Referral links', help = 'Sign-ups through a marketer''s ?ref= link are credited to that marketer.'
 WHERE key = 'features.referrals';

SELECT public._patch_fn('public.handle_new_user()',
  '  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer',
  '  IF _ref IS NOT NULL AND NOT public._brand_bool(_site, ''features.referrals'') THEN _ref := NULL; END IF;
  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer');

COMMIT;
