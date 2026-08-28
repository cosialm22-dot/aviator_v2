-- =====================================================================
-- P4: Platform console RPCs (platform_superadmin only)
-- =====================================================================
-- Powers the all-brands console: an all-sites KPI overview and brand
-- (site) management. All functions are SECURITY DEFINER and gated on
-- _is_platform_superadmin(). Per-brand financials come from the
-- site-stamped transactions / withdrawal_requests tables (see the
-- site_id auto-stamp triggers), so figures are correct per brand.
-- Game config is shared globally across brands (single engine) by design,
-- so no per-site game economy is surfaced here.
-- Idempotent (CREATE OR REPLACE).
-- =====================================================================

BEGIN;

-- ---- All-sites KPI overview ----------------------------------------
CREATE OR REPLACE FUNCTION public.platform_sites_overview()
 RETURNS TABLE(
   site_id uuid, name text, slug text, status text, withdrawals_enabled boolean,
   default_marketer_id uuid, default_marketer_username text, created_at timestamptz,
   player_count bigint, marketer_count bigint,
   deposit_total numeric, ggr numeric,
   withdrawal_pending_count bigint, withdrawal_pending_total numeric,
   withdrawal_paid_total numeric, net_cashflow numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT
    s.id, s.name, s.slug, s.status, s.withdrawals_enabled,
    s.default_marketer_id, dm.username, s.created_at,
    coalesce(pc.players, 0), coalesce(pc.marketers, 0),
    coalesce(tx.deposit_total, 0),
    coalesce(tx.bet_stakes, 0) - coalesce(tx.win_total, 0) AS ggr,
    coalesce(wr.pending_count, 0), coalesce(wr.pending_total, 0),
    coalesce(wr.paid_total, 0),
    coalesce(tx.deposit_total, 0) - coalesce(wr.paid_total, 0) AS net_cashflow
  FROM sites s
  LEFT JOIN profiles dm ON dm.id = s.default_marketer_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE p.role = 'player')   AS players,
           count(*) FILTER (WHERE p.role = 'marketer') AS marketers
    FROM profiles p WHERE p.site_id = s.id
  ) pc ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(t.amount) FILTER (WHERE t.type = 'deposit' AND t.status = 'completed'), 0) AS deposit_total,
           coalesce(sum(abs(t.amount)) FILTER (WHERE t.type = 'bet'), 0) AS bet_stakes,
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'win'), 0) AS win_total
    FROM transactions t WHERE t.site_id = s.id
  ) tx ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE w.status = 'pending') AS pending_count,
           coalesce(sum(w.amount) FILTER (WHERE w.status = 'pending'), 0) AS pending_total,
           coalesce(sum(w.amount) FILTER (WHERE w.status = 'completed' AND w.amount > 0), 0) AS paid_total
    FROM withdrawal_requests w WHERE w.site_id = s.id
  ) wr ON true
  ORDER BY s.created_at ASC;
END $function$;

-- ---- Create a brand (site) -----------------------------------------
CREATE OR REPLACE FUNCTION public.platform_create_site(
   p_slug text, p_name text, p_currency text DEFAULT 'KES', p_locale text DEFAULT 'en-KE')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_slug text;
BEGIN
  IF NOT _is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_slug := lower(trim(coalesce(p_slug, '')));
  IF v_slug = '' OR v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'INVALID_SLUG';  -- 3-40 chars, lowercase alnum + hyphen
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM sites WHERE slug = v_slug) THEN RAISE EXCEPTION 'SLUG_TAKEN'; END IF;

  INSERT INTO sites (slug, name, currency, locale)
  VALUES (v_slug, trim(p_name), coalesce(nullif(trim(p_currency),''),'KES'), coalesce(nullif(trim(p_locale),''),'en-KE'))
  RETURNING id INTO v_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'site_created', 'site', v_id::text,
          jsonb_build_object('slug', v_slug, 'name', trim(p_name)), v_id);

  RETURN jsonb_build_object('site_id', v_id, 'slug', v_slug, 'name', trim(p_name));
END $function$;

-- ---- Update a brand (selective; NULL = leave unchanged) -------------
CREATE OR REPLACE FUNCTION public.platform_update_site(
   p_site uuid,
   p_name text DEFAULT NULL,
   p_status text DEFAULT NULL,
   p_withdrawals_enabled boolean DEFAULT NULL,
   p_default_marketer_id uuid DEFAULT NULL,
   p_clear_default_marketer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exists boolean;
BEGIN
  IF NOT _is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT true INTO v_exists FROM sites WHERE id = p_site;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','suspended','archived') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  -- A default marketer must be a marketer that belongs to THIS brand.
  IF p_default_marketer_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_default_marketer_id AND role = 'marketer' AND site_id = p_site) THEN
      RAISE EXCEPTION 'INVALID_DEFAULT_MARKETER';
    END IF;
  END IF;

  UPDATE sites SET
    name = coalesce(nullif(trim(coalesce(p_name,'')),''), name),
    status = coalesce(p_status, status),
    withdrawals_enabled = coalesce(p_withdrawals_enabled, withdrawals_enabled),
    default_marketer_id = CASE WHEN p_clear_default_marketer THEN NULL
                               WHEN p_default_marketer_id IS NOT NULL THEN p_default_marketer_id
                               ELSE default_marketer_id END,
    updated_at = now()
  WHERE id = p_site;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'site_updated', 'site', p_site::text,
          jsonb_build_object('name', p_name, 'status', p_status,
            'withdrawals_enabled', p_withdrawals_enabled,
            'default_marketer_id', p_default_marketer_id,
            'clear_default_marketer', p_clear_default_marketer), p_site);

  RETURN (SELECT to_jsonb(x) FROM (
    SELECT id AS site_id, name, slug, status, withdrawals_enabled, default_marketer_id
    FROM sites WHERE id = p_site) x);
END $function$;

COMMIT;
