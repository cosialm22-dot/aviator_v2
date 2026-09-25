-- ============================================================================
-- Multi-brand, step 1: operator tiers and scope (borrowed from invest254 docs/41 + capabilities.ts).
--
-- Tiers, highest first:
--   platform_superadmin  the System owner. Every brand, the shared engine, global config, integrations.
--   platform_admin       NEW. Runs a "platform": a group of brands (sites.platform_id). Brand console,
--                        payment accounts, domains and staff for ITS brands only. Never the engine.
--   super_admin/admin/finance_admin/support   staff of ONE brand (profiles.site_id).
--   marketer             owns one brand's audience (sites.default_marketer_id) and streams it.
--   player
--
-- Scope invariants (invest254 F-43..F-48, restated for this schema):
--   S1  every staff read/write names a brand that is in the caller's scope (_can_admin_site).
--   S2  the shared engine (crash queue, live crash point, force crash, rain, global config) is
--       owner-only: one brand's staff must never see or steer a round every brand plays.
--   S3  a platform admin works one brand at a time: profiles.acting_site_id (validated against
--       its platform on every read) feeds current_site()/_staff_site(), so every existing
--       brand-scoped RPC and RLS policy serves a platform admin without being rewritten.
--   S4  global tables with no site_id (notification templates, marketing_config, bonus_config)
--       are owner-only writes.
--
-- This migration also closes cross-brand holes found while auditing every role guard:
--   * brand staff could read the crash queue and the live crash point, force a crash, recover
--     rounds and start rain for every brand (S2);
--   * admin_adjust_balance_kind, admin_add_marketer_expense, fn_marketer_funnel/ledger and the
--     support RPCs checked the role but not the brand (S1);
--   * RLS on affiliate_clicks, marketer_expenses, support_conversations and support_messages let
--     any brand's admin read every brand's rows (S1);
--   * any brand's super_admin could edit the global notification templates and the global
--     commission rate / qualifying deposit (S4).
-- Idempotent.
-- ============================================================================
BEGIN;

-- ── 1. platforms + the platform_admin tier ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platforms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  notes       text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;   -- no policies: RPCs only
REVOKE ALL ON public.platforms FROM anon, authenticated;

ALTER TABLE public.sites    ADD COLUMN IF NOT EXISTS platform_id uuid REFERENCES public.platforms(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_id uuid REFERENCES public.platforms(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acting_site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sites_platform ON public.sites(platform_id) WHERE platform_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_platform ON public.profiles(platform_id) WHERE platform_id IS NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN
  ('platform_superadmin','platform_admin','super_admin','admin','finance_admin','support','marketer','player'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_platform_admin_has_platform;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_platform_admin_has_platform
  CHECK (role <> 'platform_admin' OR platform_id IS NOT NULL);

-- The sites.status check allows 'disabled' but platform_update_site accepted 'archived' (a save
-- that always failed). One vocabulary: active | suspended | disabled.
-- (platform_update_site is rewritten in the brand-config migration.)

-- A marketer owns at most one brand.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_default_marketer ON public.sites(default_marketer_id) WHERE default_marketer_id IS NOT NULL;

-- ── 2. role helpers ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._is_operator_role(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_role IN ('platform_superadmin','platform_admin','super_admin','admin','finance_admin','support');
$$;

-- The acting brand of an owner / platform admin, only while it is still in scope.
CREATE OR REPLACE FUNCTION public._acting_site()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p.role = 'platform_superadmin' THEN p.acting_site_id
    WHEN p.role = 'platform_admin' THEN (SELECT s.id FROM sites s WHERE s.id = p.acting_site_id AND s.platform_id = p.platform_id)
  END
  FROM profiles p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public._is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'platform_admin' AND platform_id IS NOT NULL);
$$;

-- Owner or platform admin: the tiers that may use the brand console.
CREATE OR REPLACE FUNCTION public._is_platform_tier()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
     AND (role = 'platform_superadmin' OR (role = 'platform_admin' AND platform_id IS NOT NULL)));
$$;

CREATE OR REPLACE FUNCTION public._is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('platform_superadmin','platform_admin','super_admin'));
$$;

CREATE OR REPLACE FUNCTION public._is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
    AND role IN ('platform_superadmin','platform_admin','super_admin','admin','finance_admin'));
$$;

CREATE OR REPLACE FUNCTION public._is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND public._is_operator_role(role));
$$;

-- Is this brand in the caller's scope? Owner: all. Platform admin: its platform's brands.
-- Brand staff: their own brand.
CREATE OR REPLACE FUNCTION public._can_admin_site(p_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_site IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (
         p.role = 'platform_superadmin'
      OR (p.role = 'platform_admin' AND EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site AND s.platform_id = p.platform_id))
      OR (p.role IN ('super_admin','admin','finance_admin','support') AND p.site_id = p_site)));
$$;

-- The brand a staff member works on right now (RLS + brand-scoped RPCs).
CREATE OR REPLACE FUNCTION public._staff_site()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p.role = 'platform_admin' THEN public._acting_site()
              WHEN p.role IN ('super_admin','admin','finance_admin','support') THEN p.site_id END
  FROM profiles p WHERE p.id = auth.uid();
$$;

-- The caller's brand: a player's/marketer's/staff's own brand; an owner's or platform admin's
-- acting brand (falling back to its own row for the owner).
CREATE OR REPLACE FUNCTION public.current_site()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p.role = 'platform_admin' THEN public._acting_site()
              WHEN p.role = 'platform_superadmin' THEN coalesce(p.acting_site_id, p.site_id)
              ELSE p.site_id END
  FROM profiles p WHERE p.id = auth.uid();
$$;

-- Brand argument of a scoped read: the owner may pass NULL (= every brand); a platform admin
-- must name one of its brands (NULL = its acting brand); brand staff always get their own.
CREATE OR REPLACE FUNCTION public._admin_scope(p_site uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_site uuid; v_plat uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role, site_id, platform_id INTO v_role, v_site, v_plat FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR NOT public._is_operator_role(v_role) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_role = 'platform_superadmin' THEN RETURN p_site; END IF;
  IF v_role = 'platform_admin' THEN
    v_site := coalesce(p_site, public._acting_site());
    IF v_site IS NULL THEN RAISE EXCEPTION 'SITE_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = v_site AND platform_id = v_plat) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    RETURN v_site;
  END IF;
  IF p_site IS NOT NULL AND p_site IS DISTINCT FROM v_site THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN v_site;
END $$;

-- ── 3. brands the caller may pick, and the acting brand ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_my_sites()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_site uuid; v_plat uuid;
BEGIN
  SELECT role, site_id, platform_id INTO v_role, v_site, v_plat FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR NOT public._is_operator_role(v_role) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status,
                                        'platform_id', s.platform_id, 'primary_domain', s.primary_domain) ORDER BY s.name)
      FROM sites s
     WHERE v_role = 'platform_superadmin'
        OR (v_role = 'platform_admin' AND s.platform_id = v_plat)
        OR (v_role NOT IN ('platform_superadmin','platform_admin') AND s.id = v_site)), '[]'::jsonb);
END $$;

-- Who am I (role, brand, platform, acting brand) — one call for the admin shell.
CREATE OR REPLACE FUNCTION public.admin_whoami()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', p.id, 'role', p.role, 'username', p.username, 'site_id', p.site_id,
           'platform_id', p.platform_id, 'platform_name', pl.name, 'acting_site_id', public._acting_site())
    FROM profiles p LEFT JOIN platforms pl ON pl.id = p.platform_id
   WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.admin_set_acting_site(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._is_platform_tier() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_site IS NOT NULL AND NOT public._can_admin_site(p_site) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE profiles SET acting_site_id = p_site WHERE id = auth.uid();
  RETURN jsonb_build_object('acting_site_id', p_site);
END $$;

-- ── 4. platforms console (owner) ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_list_platforms()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', pl.id, 'slug', pl.slug, 'name', pl.name, 'status', pl.status, 'notes', pl.notes, 'created_at', pl.created_at,
      'brands', (SELECT count(*) FROM sites s WHERE s.platform_id = pl.id),
      'admins', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username) ORDER BY p.username), '[]'::jsonb)
                   FROM profiles p WHERE p.platform_id = pl.id AND p.role = 'platform_admin')) ORDER BY pl.name)
    FROM platforms pl), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.platform_upsert_platform(p_id uuid, p_slug text, p_name text, p_status text DEFAULT 'active', p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_slug text := lower(trim(coalesce(p_slug,'')));
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN RAISE EXCEPTION 'INVALID_SLUG'; END IF;
  IF coalesce(trim(p_name),'') = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM platforms WHERE slug = v_slug) THEN RAISE EXCEPTION 'SLUG_TAKEN'; END IF;
    INSERT INTO platforms(slug, name, status, notes, created_by) VALUES (v_slug, trim(p_name), p_status, p_notes, auth.uid()) RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM platforms WHERE slug = v_slug AND id <> p_id) THEN RAISE EXCEPTION 'SLUG_TAKEN'; END IF;
    UPDATE platforms SET slug = v_slug, name = trim(p_name), status = p_status, notes = p_notes, updated_at = now() WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'platform_created' ELSE 'platform_updated' END, 'platform', v_id::text,
            jsonb_build_object('slug', v_slug, 'name', trim(p_name), 'status', p_status));
  RETURN jsonb_build_object('id', v_id, 'slug', v_slug);
END $$;

-- Put a brand under a platform (NULL = the System owns it directly).
CREATE OR REPLACE FUNCTION public.platform_set_site_platform(p_site uuid, p_platform uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_platform IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platforms WHERE id = p_platform) THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
  UPDATE sites SET platform_id = p_platform, updated_at = now() WHERE id = p_site;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  -- Platform admins of the old platform lose this brand as their acting brand.
  UPDATE profiles SET acting_site_id = NULL
   WHERE acting_site_id = p_site AND role = 'platform_admin' AND platform_id IS DISTINCT FROM p_platform;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'site_platform_set', 'site', p_site::text, jsonb_build_object('platform_id', p_platform), p_site);
  RETURN jsonb_build_object('site_id', p_site, 'platform_id', p_platform);
END $$;

-- Make a user a platform admin of p_platform (or, with NULL, demote a platform admin to player).
CREATE OR REPLACE FUNCTION public.platform_set_platform_admin(p_user uuid, p_platform uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text;
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_user = auth.uid() OR p_user = public._root_super_admin() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  SELECT role INTO v_old FROM profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_platform IS NULL THEN
    IF v_old <> 'platform_admin' THEN RAISE EXCEPTION 'NOT_A_PLATFORM_ADMIN'; END IF;
    UPDATE profiles SET role = 'player', platform_id = NULL, acting_site_id = NULL WHERE id = p_user;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM platforms WHERE id = p_platform) THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
    IF v_old = 'marketer' THEN RAISE EXCEPTION 'DEMOTE_MARKETER_FIRST'; END IF;
    UPDATE profiles SET role = 'platform_admin', platform_id = p_platform, acting_site_id = NULL WHERE id = p_user;
  END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'platform_admin_set', 'user', p_user::text, jsonb_build_object('old', v_old, 'platform_id', p_platform));
  RETURN jsonb_build_object('user_id', p_user, 'platform_id', p_platform);
END $$;

-- ── 5. staff roles: every brand role is assignable, within scope ──────────────────────────────
-- Brand super_admin: assignable by the owner or the brand's platform admin (not by another brand
-- super_admin). admin / finance_admin / support / marketer / player: by any super-admin tier in scope.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_site uuid; v_me text;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT role INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT role, site_id INTO v_old, v_site FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public._can_admin_site(v_site) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  IF p_role NOT IN ('player','marketer','support','finance_admin','admin','super_admin') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF p_user_id = public._root_super_admin() THEN RAISE EXCEPTION 'ROOT_SUPER_ADMIN_PROTECTED'; END IF;
  IF v_old IN ('platform_superadmin','platform_admin') THEN RAISE EXCEPTION 'USE_PLATFORM_CONSOLE'; END IF;
  -- Only the tier above a brand super_admin may create or change one.
  IF (p_role = 'super_admin' OR v_old = 'super_admin') AND v_me NOT IN ('platform_superadmin','platform_admin') THEN
    RAISE EXCEPTION 'SUPER_ADMIN_LOCKED';
  END IF;
  IF v_old = p_role THEN RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false); END IF;
  UPDATE profiles SET role = p_role WHERE id = p_user_id;
  IF p_role = 'marketer' THEN PERFORM public._ensure_referral_code(p_user_id); END IF;
  IF v_old = 'marketer' THEN UPDATE sites SET default_marketer_id = NULL WHERE default_marketer_id = p_user_id; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'role_changed', 'user', p_user_id::text, jsonb_build_object('old', v_old, 'new', p_role), v_site);
  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END $$;

-- ── 6. operator role lists: platform_admin is an operator everywhere ──────────────────────────
-- (operators cannot bet, claim rain or deposit; staff lists and brand pickers include them)
DO $$
DECLARE r record; v_from text; v_to text;
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.prosrc ~ '''finance_admin'',''support'''
              AND p.prosrc !~ 'platform_admin'
              AND p.proname NOT IN ('_can_admin_site','_staff_site','_admin_scope','admin_my_sites','_is_staff','_is_admin','_is_super_admin','admin_set_role')
  LOOP
    FOREACH v_from IN ARRAY ARRAY[
      $a$('admin','super_admin','platform_superadmin','finance_admin','support')$a$,
      $a$('platform_superadmin','super_admin','admin','finance_admin','support')$a$,
      $a$('super_admin','admin','finance_admin','support','platform_superadmin')$a$,
      $a$('super_admin','admin','finance_admin','support')$a$] LOOP
      v_to := replace(v_from, $a$'support'$a$, $a$'support','platform_admin'$a$);
      IF position(v_from in pg_get_functiondef(r.sig::regprocedure)) > 0 THEN
        PERFORM public._patch_fn(r.sig, v_from, v_to);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 7. S2: the shared engine is owner-only ─────────────────────────────────────────────────────
SELECT public._patch_fn('public.admin_current_round()', 'IF NOT public._is_staff() THEN', 'IF NOT public._is_platform_superadmin() THEN');
-- (the crash-queue RPCs are already owner-only)
SELECT public._patch_fn(p.oid::regprocedure::text, 'IF NOT _is_admin() THEN', 'IF NOT _is_platform_superadmin() THEN')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('admin_force_crash','admin_recover_zombies','admin_start_rain');
DROP POLICY IF EXISTS staff_read ON public.crash_queue;
CREATE POLICY owner_read ON public.crash_queue FOR SELECT TO authenticated USING ((SELECT public._is_platform_superadmin()));

-- ── 8. S4: global tables are owner-only writes ────────────────────────────────────────────────
SELECT public._patch_fn(p.oid::regprocedure::text, 'IF NOT (_is_super_admin() OR _is_platform_superadmin()) THEN', 'IF NOT _is_platform_superadmin() THEN')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('admin_upsert_notification_template','admin_delete_notification_template');
SELECT public._patch_fn('public.admin_set_commission_rate(numeric)', 'IF NOT _is_super_admin() THEN', 'IF NOT _is_platform_superadmin() THEN');
SELECT public._patch_fn('public.admin_set_qualifying_deposit(numeric)', 'IF NOT _is_super_admin() THEN', 'IF NOT _is_platform_superadmin() THEN');

-- ── 9. S1: brand checks where only the role was checked ───────────────────────────────────────
SELECT public._patch_fn('public.admin_adjust_balance_kind(uuid,numeric,text,text)',
  'IF NOT _is_admin() THEN RAISE EXCEPTION ''FORBIDDEN''; END IF;',
  'IF NOT _is_admin() THEN RAISE EXCEPTION ''FORBIDDEN''; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_user_id)) THEN RAISE EXCEPTION ''FORBIDDEN_SITE''; END IF;');
SELECT public._patch_fn('public.admin_add_marketer_expense(uuid,text,bigint,text)',
  'IF v_role <> ''marketer'' THEN RAISE EXCEPTION ''NOT_A_MARKETER''; END IF;',
  'IF v_role <> ''marketer'' THEN RAISE EXCEPTION ''NOT_A_MARKETER''; END IF;
  IF NOT public._can_admin_site(v_site) THEN RAISE EXCEPTION ''FORBIDDEN_SITE''; END IF;');
SELECT public._patch_fn('public.fn_marketer_funnel(uuid)',
  'IF NOT (public._is_admin() OR auth.uid() = p_marketer) THEN',
  'IF NOT (auth.uid() = p_marketer OR (public._is_admin() AND public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_marketer)))) THEN');
SELECT public._patch_fn('public.fn_marketer_ledger(uuid,integer)',
  'IF NOT (public._is_admin() OR auth.uid() = p_marketer) THEN',
  'IF NOT (auth.uid() = p_marketer OR (public._is_admin() AND public._can_admin_site((SELECT site_id FROM public.profiles WHERE id = p_marketer)))) THEN');
SELECT public._patch_fn('public.fn_support_send(uuid,text)',
  'IF v_owner IS DISTINCT FROM v_uid AND NOT public._is_admin() THEN',
  'IF v_owner IS DISTINCT FROM v_uid AND NOT (public._is_admin() AND public._can_admin_site(v_site)) THEN');
SELECT public._patch_fn('public.fn_support_escalate(uuid,text,text)',
  'IF v_uid IS NOT NULL AND v_owner IS DISTINCT FROM v_uid AND NOT public._is_admin() THEN',
  'IF v_uid IS NOT NULL AND v_owner IS DISTINCT FROM v_uid AND NOT (public._is_admin() AND public._can_admin_site((SELECT site_id FROM public.support_conversations WHERE id = p_conversation))) THEN');

-- RLS: brand staff read their own brand's rows only.
DROP POLICY IF EXISTS "clicks marketer/admin read" ON public.affiliate_clicks;
CREATE POLICY "clicks marketer/admin read" ON public.affiliate_clicks FOR SELECT TO authenticated
  USING (affiliate_id = (SELECT auth.uid()) OR (SELECT public._is_platform_superadmin())
         OR ((SELECT public._is_admin()) AND site_id = (SELECT public._staff_site())));
DROP POLICY IF EXISTS "expenses marketer/admin read" ON public.marketer_expenses;
CREATE POLICY "expenses marketer/admin read" ON public.marketer_expenses FOR SELECT TO authenticated
  USING (marketer_id = (SELECT auth.uid()) OR (SELECT public._is_platform_superadmin())
         OR ((SELECT public._is_admin()) AND site_id = (SELECT public._staff_site())));
DROP POLICY IF EXISTS sel_own_or_admin ON public.support_conversations;
CREATE POLICY sel_own_or_admin ON public.support_conversations FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public._is_platform_superadmin())
         OR ((SELECT public._is_admin()) AND site_id = (SELECT public._staff_site())));
DROP POLICY IF EXISTS sel_own_or_admin ON public.support_messages;
CREATE POLICY sel_own_or_admin ON public.support_messages FOR SELECT TO authenticated
  USING ((SELECT public._is_platform_superadmin())
         OR ((SELECT public._is_admin()) AND site_id = (SELECT public._staff_site()))
         OR EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id = support_messages.conversation_id AND c.user_id = (SELECT auth.uid())));

-- ── 10. grants ────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._acting_site(), public._is_platform_admin(), public._is_platform_tier(), public._is_operator_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._acting_site(), public._is_platform_admin(), public._is_platform_tier(), public._is_operator_role(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_whoami(), public.admin_set_acting_site(uuid), public.platform_list_platforms(),
  public.platform_upsert_platform(uuid,text,text,text,text), public.platform_set_site_platform(uuid,uuid),
  public.platform_set_platform_admin(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_whoami(), public.admin_set_acting_site(uuid), public.platform_list_platforms(),
  public.platform_upsert_platform(uuid,text,text,text,text), public.platform_set_site_platform(uuid,uuid),
  public.platform_set_platform_admin(uuid,uuid) TO authenticated;

COMMIT;
