-- =====================================================================
-- Borrow #1: Notifications (adapted from invest254 user_notifications +
-- notification_templates + fn_broadcast/audience/resolve).
-- =====================================================================
-- Per-user in-app notifications with levels, dismissible flag, category-based
-- resolve (a "restored" broadcast clears the incident banners it supersedes),
-- reusable templates, and audience targeting. Adapted to aviator: profiles use
-- is_banned (not status), the aviator role ladder, and site scoping via
-- current_site()/_is_platform_superadmin() so a brand admin can only notify
-- their own brand while the platform owner can target any/all brands.
-- Writes are RPC-only (SECURITY DEFINER); users read their own rows and dismiss
-- via RPC. Realtime-enabled for a live bell. Idempotent.
-- =====================================================================

BEGIN;

-- ---- Tables --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level        text NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','error')),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body         text NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  dismissible  boolean NOT NULL DEFAULT true,
  category     text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  resolved_at  timestamptz,
  site_id      uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.sites(id)
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_inbox
  ON public.user_notifications (user_id, created_at DESC) WHERE dismissed_at IS NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_category
  ON public.user_notifications (category) WHERE dismissed_at IS NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_site ON public.user_notifications (site_id);

CREATE TABLE IF NOT EXISTS public.notification_templates (
  key               text PRIMARY KEY,
  level             text NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','error')),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body              text NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  dismissible       boolean NOT NULL DEFAULT true,
  category          text NOT NULL,
  resolves_category text,
  default_audience  jsonb NOT NULL DEFAULT '{"status":"active","roles":["player"]}'::jsonb,
  active            boolean NOT NULL DEFAULT true,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---- RLS: users read their own; writes are RPC-only -----------------
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS un_select_own ON public.user_notifications;
CREATE POLICY un_select_own ON public.user_notifications FOR SELECT USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_notifications FROM anon, authenticated;
GRANT SELECT ON public.user_notifications TO anon, authenticated;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;  -- no policy -> definer-only
REVOKE ALL ON public.notification_templates FROM anon, authenticated;

-- ---- site_id auto-stamp (owner = user_id), like other user-owned tables
DROP TRIGGER IF EXISTS trg_inherit_site ON public.user_notifications;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

-- ---- Realtime (live bell) ------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_notifications') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications';
  END IF;
END $$;

-- ---- Audience resolver ---------------------------------------------
-- Filters: status ('active'=not banned | 'all'), roles[], user_ids[], sites[].
-- p_scope_site: when non-null (brand admin) forces that site; when null
-- (platform) honours an optional audience 'sites' filter, else all sites.
CREATE OR REPLACE FUNCTION public._notification_audience(p_audience jsonb, p_scope_site uuid)
 RETURNS TABLE(user_id uuid, site_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT p.id, p.site_id
  FROM public.profiles p
  WHERE (coalesce(p_audience->>'status','active') = 'all' OR p.is_banned = false)
    AND ( NOT (p_audience ? 'roles')
          OR p.role IN (SELECT jsonb_array_elements_text(p_audience->'roles')) )
    AND ( NOT (p_audience ? 'user_ids')
          OR p.id IN (SELECT (jsonb_array_elements_text(p_audience->'user_ids'))::uuid) )
    AND (
          (p_scope_site IS NOT NULL AND p.site_id = p_scope_site)
       OR (p_scope_site IS NULL AND ( NOT (p_audience ? 'sites')
             OR p.site_id IN (SELECT (jsonb_array_elements_text(p_audience->'sites'))::uuid) ))
        );
$function$;

-- ---- Broadcast (ad-hoc content) ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
   p_level text, p_title text, p_body text DEFAULT '',
   p_category text DEFAULT NULL, p_dismissible boolean DEFAULT true, p_audience jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_scope uuid; v_aud jsonb; v_count int;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_level NOT IN ('info','success','warning','error') THEN RAISE EXCEPTION 'INVALID_LEVEL'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) < 1 OR length(p_title) > 120 THEN RAISE EXCEPTION 'INVALID_TITLE'; END IF;
  IF length(coalesce(p_body,'')) > 1000 THEN RAISE EXCEPTION 'BODY_TOO_LONG'; END IF;

  v_scope := CASE WHEN _is_platform_superadmin() THEN NULL ELSE current_site() END;
  v_aud   := coalesce(p_audience, '{"status":"active","roles":["player"]}'::jsonb);

  WITH ins AS (
    INSERT INTO public.user_notifications (user_id, level, title, body, dismissible, category, created_by, site_id)
    SELECT a.user_id, p_level, trim(p_title), coalesce(p_body,''), coalesce(p_dismissible,true),
           p_category, auth.uid(), a.site_id
    FROM public._notification_audience(v_aud, v_scope) a
    WHERE p_category IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_notifications n
      WHERE n.user_id = a.user_id AND n.category = p_category
        AND n.dismissed_at IS NULL AND n.resolved_at IS NULL)
    RETURNING 1
  ) SELECT count(*)::int INTO v_count FROM ins;

  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'notification_broadcast', 'notification', coalesce(p_category,'ad-hoc'),
          jsonb_build_object('level',p_level,'title',trim(p_title),'recipients',v_count,'audience',v_aud),
          coalesce(v_scope, current_site()));
  RETURN jsonb_build_object('recipients', v_count);
END $function$;

-- ---- Broadcast from a saved template -------------------------------
CREATE OR REPLACE FUNCTION public.admin_broadcast_from_template(p_key text, p_audience jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE t public.notification_templates; v_scope uuid; v_aud jsonb; v_count int;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO t FROM public.notification_templates WHERE key = p_key AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEMPLATE_NOT_FOUND'; END IF;

  v_scope := CASE WHEN _is_platform_superadmin() THEN NULL ELSE current_site() END;
  v_aud   := coalesce(p_audience, t.default_audience, '{}'::jsonb);

  IF t.resolves_category IS NOT NULL THEN
    UPDATE public.user_notifications SET resolved_at = now()
    WHERE category = t.resolves_category AND dismissed_at IS NULL AND resolved_at IS NULL
      AND (v_scope IS NULL OR site_id = v_scope);
  END IF;

  WITH ins AS (
    INSERT INTO public.user_notifications (user_id, level, title, body, dismissible, category, created_by, site_id)
    SELECT a.user_id, t.level, t.title, t.body, t.dismissible, t.category, auth.uid(), a.site_id
    FROM public._notification_audience(v_aud, v_scope) a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_notifications n
      WHERE n.user_id = a.user_id AND n.category = t.category
        AND n.dismissed_at IS NULL AND n.resolved_at IS NULL)
    RETURNING 1
  ) SELECT count(*)::int INTO v_count FROM ins;

  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'notification_broadcast_template', 'template', p_key,
          jsonb_build_object('recipients',v_count,'audience',v_aud), coalesce(v_scope, current_site()));
  RETURN jsonb_build_object('recipients', v_count, 'template', p_key);
END $function$;

-- ---- Resolve a whole category (clear an incident banner) -----------
CREATE OR REPLACE FUNCTION public.admin_resolve_notifications_by_category(p_category text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_scope uuid; v_count int;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_category IS NULL OR length(trim(p_category))=0 THEN RAISE EXCEPTION 'CATEGORY_REQUIRED'; END IF;
  v_scope := CASE WHEN _is_platform_superadmin() THEN NULL ELSE current_site() END;
  UPDATE public.user_notifications SET resolved_at = now()
  WHERE category = p_category AND dismissed_at IS NULL AND resolved_at IS NULL
    AND (v_scope IS NULL OR site_id = v_scope);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'notification_resolve_category', 'category', p_category,
          jsonb_build_object('cleared',v_count), coalesce(v_scope, current_site()));
  RETURN jsonb_build_object('cleared', v_count);
END $function$;

-- ---- Player-facing reads / dismiss ---------------------------------
CREATE OR REPLACE FUNCTION public.my_notifications(p_include_dismissed boolean DEFAULT false)
 RETURNS SETOF public.user_notifications
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT * FROM public.user_notifications
  WHERE user_id = auth.uid() AND resolved_at IS NULL
    AND (p_include_dismissed OR dismissed_at IS NULL)
  ORDER BY created_at DESC LIMIT 100;
$function$;

CREATE OR REPLACE FUNCTION public.unread_notification_count()
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT count(*)::int FROM public.user_notifications
  WHERE user_id = auth.uid() AND dismissed_at IS NULL AND resolved_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_notification(p_id bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  UPDATE public.user_notifications SET dismissed_at = now()
  WHERE id = p_id AND user_id = auth.uid() AND dismissed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('id', p_id, 'dismissed', true);
END $function$;

CREATE OR REPLACE FUNCTION public.dismiss_all_notifications()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE public.user_notifications SET dismissed_at = now()
  WHERE user_id = auth.uid() AND dismissible = true AND dismissed_at IS NULL AND resolved_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('dismissed', v_count);
END $function$;

-- ---- Template management (super admin / platform) ------------------
CREATE OR REPLACE FUNCTION public.admin_list_notification_templates()
 RETURNS SETOF public.notification_templates
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT * FROM public.notification_templates
  WHERE public._is_super_admin() OR public._is_platform_superadmin()
  ORDER BY key;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_notification_template(
   p_key text, p_level text, p_title text, p_body text,
   p_category text, p_dismissible boolean DEFAULT true,
   p_resolves_category text DEFAULT NULL, p_default_audience jsonb DEFAULT NULL,
   p_active boolean DEFAULT true, p_description text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT (_is_super_admin() OR _is_platform_superadmin()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z0-9][a-z0-9._-]{1,60}$' THEN RAISE EXCEPTION 'INVALID_KEY'; END IF;
  IF p_level NOT IN ('info','success','warning','error') THEN RAISE EXCEPTION 'INVALID_LEVEL'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) < 1 OR length(p_title) > 120 THEN RAISE EXCEPTION 'INVALID_TITLE'; END IF;
  IF length(coalesce(p_body,'')) > 1000 THEN RAISE EXCEPTION 'BODY_TOO_LONG'; END IF;
  IF p_category IS NULL OR length(trim(p_category))=0 THEN RAISE EXCEPTION 'CATEGORY_REQUIRED'; END IF;

  INSERT INTO public.notification_templates
    (key, level, title, body, dismissible, category, resolves_category, default_audience, active, description, updated_at)
  VALUES (p_key, p_level, trim(p_title), coalesce(p_body,''), coalesce(p_dismissible,true), trim(p_category),
          p_resolves_category, coalesce(p_default_audience, '{"status":"active","roles":["player"]}'::jsonb),
          coalesce(p_active,true), p_description, now())
  ON CONFLICT (key) DO UPDATE SET
    level=excluded.level, title=excluded.title, body=excluded.body, dismissible=excluded.dismissible,
    category=excluded.category, resolves_category=excluded.resolves_category,
    default_audience=excluded.default_audience, active=excluded.active, description=excluded.description,
    updated_at=now();
  RETURN jsonb_build_object('key', p_key);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_notification_template(p_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT (_is_super_admin() OR _is_platform_superadmin()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  DELETE FROM public.notification_templates WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('key', p_key, 'deleted', true);
END $function$;

COMMIT;
