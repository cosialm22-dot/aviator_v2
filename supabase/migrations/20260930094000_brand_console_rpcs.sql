-- ============================================================================
-- Multi-brand, step 5: RPCs behind the brand console.
--   platform_find_users  find a person to make a brand's marketer / staff / platform admin
--                        (owner: everyone; platform admin: its platform's brands only)
--   (the brand cards use platform_sites_overview, which now carries each brand's look)
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_find_users(p_q text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_plat uuid; q text := lower(trim(coalesce(p_q, ''))); d text;
BEGIN
  SELECT role, platform_id INTO v_role, v_plat FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','platform_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  d := regexp_replace(q, '\D', '', 'g');
  IF d ~ '^0[17][0-9]{8}$' THEN d := '254' || substr(d, 2); END IF;
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', p.id, 'username', p.username, 'role', p.role, 'phone', p.phone_number,
             'site_id', p.site_id, 'site_name', s.name, 'platform_id', p.platform_id,
             'owns_brand', (SELECT name FROM sites o WHERE o.default_marketer_id = p.id),
             'referred_players', (SELECT count(*) FROM profiles r WHERE r.referred_by = p.id)) AS x
      FROM profiles p LEFT JOIN sites s ON s.id = p.site_id
     WHERE (lower(p.username) LIKE '%' || q || '%' OR (length(d) >= 4 AND p.phone_number LIKE '%' || d || '%'))
       AND p.role <> 'platform_superadmin'
       AND (v_role = 'platform_superadmin' OR s.platform_id = v_plat)
     ORDER BY (lower(p.username) = q) DESC, p.username
     LIMIT least(greatest(p_limit, 1), 50)) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_find_users(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_find_users(text, int) TO authenticated;

COMMIT;
