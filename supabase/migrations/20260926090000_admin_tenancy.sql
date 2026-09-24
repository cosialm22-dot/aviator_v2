-- ============================================================================
-- Admin tenancy & security foundation (admin dashboard phase 1).
--
-- Principles:
--   * Anything that affects every brand (global settings, the shared crash queue, the M-Pesa
--     paybill) is the PLATFORM OWNER's. A brand's super_admin runs their own brand only.
--   * Staff tables are read-only from the API; every change goes through an audited RPC.
--   * Support can READ what they need to help players; they never move money or ban.
--   * Every brand has its own owner (one super_admin per brand, not one in total).
--   * Scoped read RPCs take p_site: the platform owner may pass NULL (all brands) or a brand;
--     everyone else is pinned to their own brand.
--
-- Existing function bodies are patched in place (pg_get_functiondef + replace + EXECUTE) so the
-- rest of each body stays exactly as it is in production; each patch fails loudly if its anchor
-- text is not found.
-- ============================================================================
BEGIN;

-- ── helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
    AND role IN ('platform_superadmin','super_admin','admin','finance_admin','support'));
$$;

-- Resolve the brand a scoped read may look at. NULL = all brands (platform owner only).
CREATE OR REPLACE FUNCTION public._admin_scope(p_site uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_site uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role, site_id INTO v_role, v_site FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','super_admin','admin','finance_admin','support') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_role = 'platform_superadmin' THEN RETURN p_site; END IF;
  IF p_site IS NOT NULL AND p_site IS DISTINCT FROM v_site THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN v_site;
END $$;

CREATE OR REPLACE FUNCTION public._patch_fn(p_sig text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(p_sig::regprocedure);
  IF position(p_from in d) = 0 THEN
    IF position(p_to in d) > 0 THEN RETURN; END IF;   -- already applied
    RAISE EXCEPTION 'PATCH_ANCHOR_NOT_FOUND in %: %', p_sig, left(p_from, 80);
  END IF;
  EXECUTE replace(d, p_from, p_to);
END $$;

-- ── support can read players, risk and the live round ───────────────────────
SELECT public._patch_fn('public.admin_get_user(uuid)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$);
SELECT public._patch_fn('public.admin_list_fraud_alerts(text,integer)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$);
SELECT public._patch_fn('public.admin_current_round()',
  $x$IF NOT public._is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$,
  $x$IF NOT public._is_staff() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$);

-- ── brand checks that were missing ──────────────────────────────────────────
SELECT public._patch_fn('public.admin_get_mpesa_detail(uuid)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM transactions WHERE id = p_transaction_id)) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;$x$);

SELECT public._patch_fn('public.admin_upsert_promotion(uuid,jsonb)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_id IS NOT NULL AND NOT public._can_admin_site((SELECT site_id FROM promotions WHERE id = p_id)) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;$x$);
SELECT public._patch_fn('public.admin_upsert_promotion(uuid,jsonb)',
  $x$max_reward, starts_at, ends_at, is_active, display_order, created_by, updated_by)$x$,
  $x$max_reward, starts_at, ends_at, is_active, display_order, created_by, updated_by, site_id)$x$);
SELECT public._patch_fn('public.admin_upsert_promotion(uuid,jsonb)',
  $x$v_max_reward, v_starts, v_ends, v_active, v_order, auth.uid(), auth.uid())$x$,
  $x$v_max_reward, v_starts, v_ends, v_active, v_order, auth.uid(), auth.uid(), public.current_site())$x$);
SELECT public._patch_fn('public.admin_set_promotion_active(uuid,boolean)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM promotions WHERE id = p_id)) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;$x$);
SELECT public._patch_fn('public.admin_delete_promotion(uuid)',
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$x$,
  $x$IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT public._can_admin_site((SELECT site_id FROM promotions WHERE id = p_id)) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;$x$);

-- A brand's owner re-themes only their own brand.
SELECT public._patch_fn('public.admin_set_site_theme(uuid,jsonb,text)',
  $x$IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$,
  $x$IF NOT (public._is_platform_superadmin() OR (public._is_super_admin() AND p_site_id = public.current_site())) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$);

-- ── global controls are the platform owner's ────────────────────────────────
SELECT public._patch_fn('public.admin_set_setting(text,jsonb)',
  $x$IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$,
  $x$IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$);
SELECT public._patch_fn('public.admin_queue_add(numeric)',
  $x$IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$,
  $x$IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$);
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('admin_queue_add_batch','admin_queue_remove','admin_queue_clear') LOOP
    PERFORM public._patch_fn(s,
      $x$IF NOT _is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$,
      $x$IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;$x$);
  END LOOP;
END $$;

-- ── staff tables: read-only from the API ───────────────────────────────────
DROP POLICY IF EXISTS admin_full_access ON public.admin_audit_log;
DROP POLICY IF EXISTS staff_read_site ON public.admin_audit_log;
CREATE POLICY staff_read_site ON public.admin_audit_log FOR SELECT USING (public._can_admin_site(site_id));

DROP POLICY IF EXISTS admin_full_access ON public.withdrawal_requests;
DROP POLICY IF EXISTS staff_read_site ON public.withdrawal_requests;
CREATE POLICY staff_read_site ON public.withdrawal_requests FOR SELECT USING (public._can_admin_site(site_id));

DROP POLICY IF EXISTS admin_full_access ON public.player_risk_scores;
DROP POLICY IF EXISTS staff_read_site ON public.player_risk_scores;
CREATE POLICY staff_read_site ON public.player_risk_scores FOR SELECT USING (public._can_admin_site(site_id));

DROP POLICY IF EXISTS admin_full_access ON public.crash_queue;
DROP POLICY IF EXISTS staff_read ON public.crash_queue;
CREATE POLICY staff_read ON public.crash_queue FOR SELECT USING (public._is_staff());

DROP POLICY IF EXISTS admin_full_access ON public.system_settings;
DROP POLICY IF EXISTS staff_read ON public.system_settings;
CREATE POLICY staff_read ON public.system_settings FOR SELECT USING (public._is_staff());

-- The paybill row holds secrets: nobody reads it from the browser any more (RPCs below).
DROP POLICY IF EXISTS admin_full_access ON public.mpesa_config;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_audit_log, public.withdrawal_requests,
  public.player_risk_scores, public.crash_queue, public.system_settings FROM anon, authenticated;
REVOKE ALL ON public.mpesa_config FROM anon, authenticated;

-- Audit rows written without a brand land on the default brand. Attribute them to the player
-- they are about, else to the acting staff member's brand.
CREATE OR REPLACE FUNCTION public._audit_infer_site()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  IF NEW.site_id IS NULL OR NEW.site_id = '00000000-0000-0000-0000-000000000001'::uuid THEN
    IF NEW.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT site_id INTO v FROM profiles WHERE id = NEW.target_id::uuid;
    END IF;
    IF v IS NULL AND NEW.admin_id IS NOT NULL THEN
      SELECT site_id INTO v FROM profiles WHERE id = NEW.admin_id AND role <> 'platform_superadmin';
    END IF;
    NEW.site_id := coalesce(v, NEW.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_infer_site ON public.admin_audit_log;
CREATE TRIGGER trg_audit_infer_site BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._audit_infer_site();

-- ── one owner per brand ─────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.uniq_one_super_admin;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_super_admin_per_site ON public.profiles(site_id) WHERE role = 'super_admin';

-- ── M-Pesa paybill (Daraja) config: platform owner only, secrets never leave ──
CREATE OR REPLACE FUNCTION public.admin_get_mpesa_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r mpesa_config%ROWTYPE;
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO r FROM mpesa_config ORDER BY is_active DESC, updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'environment', r.environment, 'consumer_key', r.consumer_key,
    'consumer_secret_set', coalesce(r.consumer_secret, '') <> '',
    'passkey_set', coalesce(r.passkey, '') <> '',
    'security_credential_set', coalesce(r.security_credential, '') <> '',
    'shortcode', r.shortcode, 'b2c_shortcode', r.b2c_shortcode, 'initiator_name', r.initiator_name,
    'callback_base_url', r.callback_base_url, 'is_active', r.is_active, 'updated_at', r.updated_at);
END $$;

-- p_secrets: {"passkey": "...", ...} — only keys present and non-empty are replaced.
CREATE OR REPLACE FUNCTION public.admin_save_mpesa_config(p_data jsonb, p_secrets jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_env text := coalesce(p_data->>'environment', 'sandbox'); v_rotated text[] := '{}'; k text;
BEGIN
  IF NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_env NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'INVALID_ENVIRONMENT'; END IF;
  IF coalesce(btrim(p_data->>'shortcode'), '') !~ '^[0-9]{5,7}$' THEN RAISE EXCEPTION 'INVALID_SHORTCODE'; END IF;
  IF coalesce(btrim(p_data->>'callback_base_url'), '') !~ '^https://' THEN RAISE EXCEPTION 'INVALID_CALLBACK_URL'; END IF;
  SELECT id INTO v_id FROM mpesa_config ORDER BY is_active DESC, updated_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO mpesa_config(environment, consumer_key, shortcode, callback_base_url, is_active, updated_by, updated_at)
    VALUES (v_env, btrim(coalesce(p_data->>'consumer_key','')), btrim(p_data->>'shortcode'), btrim(p_data->>'callback_base_url'), true, auth.uid(), now())
    RETURNING id INTO v_id;
  END IF;
  UPDATE mpesa_config SET
    environment = v_env,
    consumer_key = btrim(coalesce(p_data->>'consumer_key', consumer_key)),
    shortcode = btrim(p_data->>'shortcode'),
    b2c_shortcode = nullif(btrim(coalesce(p_data->>'b2c_shortcode', '')), ''),
    initiator_name = nullif(btrim(coalesce(p_data->>'initiator_name', '')), ''),
    callback_base_url = btrim(p_data->>'callback_base_url'),
    is_active = coalesce((p_data->>'is_active')::boolean, is_active),
    updated_by = auth.uid(), updated_at = now()
  WHERE id = v_id;
  FOREACH k IN ARRAY ARRAY['passkey','consumer_secret','security_credential'] LOOP
    IF coalesce(p_secrets->>k, '') <> '' THEN
      EXECUTE format('UPDATE mpesa_config SET %I = $1 WHERE id = $2', k) USING p_secrets->>k, v_id;
      v_rotated := v_rotated || k;
    END IF;
  END LOOP;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'mpesa_config_updated', 'mpesa_config', v_id::text,
          jsonb_build_object('environment', v_env, 'secrets_rotated', to_jsonb(v_rotated)));
  RETURN public.admin_get_mpesa_config();
END $$;

-- ── scoped reads for the dashboard ──────────────────────────────────────────
-- Overview: today's figures (Nairobi day), a daily series, and the "needs attention" queue.
CREATE OR REPLACE FUNCTION public.admin_overview(p_site uuid DEFAULT NULL, p_days int DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_site uuid := public._admin_scope(p_site);
  v_all boolean := v_site IS NULL;
  v_days int := greatest(1, least(coalesce(p_days, 14), 90));
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_from timestamptz := ((v_today - (v_days - 1))::timestamp AT TIME ZONE 'Africa/Nairobi');
  v_t0 timestamptz := (v_today::timestamp AT TIME ZONE 'Africa/Nairobi');
  today jsonb; series jsonb; attn jsonb; totals jsonb;
BEGIN
  WITH b AS (
    SELECT amount, coalesce(winnings, 0) AS win, status, user_id FROM bets
     WHERE NOT is_bot AND created_at >= v_t0 AND (v_all OR site_id = v_site)
  ), tx AS (
    SELECT type, amount, user_id FROM transactions
     WHERE status = 'completed' AND created_at >= v_t0 AND (v_all OR site_id = v_site)
  )
  SELECT jsonb_build_object(
    'deposits_kes',    (SELECT coalesce(sum(amount), 0) FROM tx WHERE type = 'deposit'),
    'deposits_count',  (SELECT count(*) FROM tx WHERE type = 'deposit'),
    'depositors',      (SELECT count(DISTINCT user_id) FROM tx WHERE type = 'deposit'),
    'withdrawals_kes', (SELECT coalesce(sum(amount), 0) FROM withdrawal_requests
                         WHERE status = 'completed' AND completed_at >= v_t0 AND (v_all OR site_id = v_site)),
    'stake_kes',       (SELECT coalesce(sum(amount), 0) FROM b),
    'payouts_kes',     (SELECT coalesce(sum(win), 0) FROM b WHERE status = 'won'),
    'bets_count',      (SELECT count(*) FROM b),
    'bettors',         (SELECT count(DISTINCT user_id) FROM b),
    'new_players',     (SELECT count(*) FROM profiles WHERE role = 'player' AND created_at >= v_t0 AND (v_all OR site_id = v_site)),
    'bonus_kes',       (SELECT coalesce(sum(amount), 0) FROM tx WHERE type = 'bonus')
  ) INTO today;
  today := today || jsonb_build_object('house_revenue_kes', (today->>'stake_kes')::numeric - (today->>'payouts_kes')::numeric);

  WITH d AS (SELECT generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date AS day),
  dep AS (SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day, sum(amount) s, count(*) n FROM transactions
           WHERE type = 'deposit' AND status = 'completed' AND created_at >= v_from AND (v_all OR site_id = v_site) GROUP BY 1),
  wd AS (SELECT (completed_at AT TIME ZONE 'Africa/Nairobi')::date AS day, sum(amount) s FROM withdrawal_requests
           WHERE status = 'completed' AND completed_at >= v_from AND (v_all OR site_id = v_site) GROUP BY 1),
  bt AS (SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day, sum(amount) stake,
                sum(CASE WHEN status = 'won' THEN coalesce(winnings, 0) ELSE 0 END) paid, count(DISTINCT user_id) bettors FROM bets
           WHERE NOT is_bot AND created_at >= v_from AND (v_all OR site_id = v_site) GROUP BY 1),
  np AS (SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day, count(*) n FROM profiles
           WHERE role = 'player' AND created_at >= v_from AND (v_all OR site_id = v_site) GROUP BY 1)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day, 'deposits_kes', coalesce(dep.s, 0), 'deposits_count', coalesce(dep.n, 0),
           'withdrawals_kes', coalesce(wd.s, 0), 'stake_kes', coalesce(bt.stake, 0),
           'house_revenue_kes', coalesce(bt.stake, 0) - coalesce(bt.paid, 0), 'bettors', coalesce(bt.bettors, 0),
           'new_players', coalesce(np.n, 0)) ORDER BY d.day), '[]'::jsonb)
    INTO series
    FROM d LEFT JOIN dep USING (day) LEFT JOIN wd USING (day) LEFT JOIN bt USING (day) LEFT JOIN np USING (day);

  SELECT jsonb_build_object(
    'withdrawals_pending',     (SELECT count(*) FROM withdrawal_requests WHERE status = 'pending' AND (v_all OR site_id = v_site)),
    'withdrawals_pending_kes', (SELECT coalesce(sum(amount), 0) FROM withdrawal_requests WHERE status = 'pending' AND (v_all OR site_id = v_site)),
    'withdrawals_failed',      (SELECT count(*) FROM withdrawal_requests WHERE status = 'failed' AND created_at > now() - interval '7 days' AND (v_all OR site_id = v_site)),
    'deposits_attention',      (SELECT count(*) FROM mpesa_stk_requests WHERE provider = 'megapay' AND (v_all OR site_id = v_site) AND status <> 'completed'
                                  AND ((status = 'timeout' AND created_at < now() - interval '1 hour')
                                    OR (status = 'failed' AND result_description = 'No Mega Pay response' AND created_at > now() - interval '7 days')
                                    OR provider_status LIKE 'AMOUNT_MISMATCH%')),
    'high_risk_players',       (SELECT count(*) FROM player_risk_scores WHERE risk_level IN ('high','critical') AND (v_all OR site_id = v_site)),
    'commissions_pending',     (SELECT count(*) FROM commission_payouts WHERE status = 'pending' AND (v_all OR site_id = v_site)),
    'stuck_rounds',            (SELECT count(*) FROM game_rounds WHERE status = 'flying' AND started_at < now() - interval '5 minutes')
  ) INTO attn;

  SELECT jsonb_build_object(
    'players',          (SELECT count(*) FROM profiles WHERE role = 'player' AND (v_all OR site_id = v_site)),
    'active_7d',        (SELECT count(*) FROM profiles WHERE role = 'player' AND last_active_at > now() - interval '7 days' AND (v_all OR site_id = v_site)),
    'player_balances_kes', (SELECT coalesce(sum(w.real_balance), 0) / 100.0 FROM wallets w JOIN profiles p ON p.id = w.user_id
                             WHERE p.role = 'player' AND (v_all OR p.site_id = v_site)),
    'bonus_balances_kes',  (SELECT coalesce(sum(w.bonus_balance), 0) / 100.0 FROM wallets w JOIN profiles p ON p.id = w.user_id
                             WHERE p.role = 'player' AND (v_all OR p.site_id = v_site))
  ) INTO totals;

  RETURN jsonb_build_object('scope', CASE WHEN v_all THEN 'all' ELSE 'site' END, 'site_id', v_site,
    'days', v_days, 'today', today, 'series', series, 'attention', attn, 'totals', totals, 'generated_at', now());
END $$;

-- Players list: search, filters, sort, pagination, with a total count.
CREATE OR REPLACE FUNCTION public.admin_list_players(
  p_site uuid DEFAULT NULL, p_q text DEFAULT NULL, p_status text DEFAULT 'all', p_role text DEFAULT 'player',
  p_sort text DEFAULT 'newest', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_site uuid := public._admin_scope(p_site);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text; v_rows jsonb; v_total bigint;
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off int := greatest(0, coalesce(p_offset, 0));
BEGIN
  IF p_status NOT IN ('all','active','banned','dormant','depositors','high_risk') THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
  IF p_role NOT IN ('player','marketer','staff','any') THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
  IF p_sort NOT IN ('newest','oldest','last_active','deposited','balance','wagered','username') THEN RAISE EXCEPTION 'INVALID_SORT'; END IF;
  v_digits := regexp_replace(coalesce(v_q, ''), '\D', '', 'g');
  IF v_digits LIKE '0%' THEN v_digits := '254' || substr(v_digits, 2); END IF;

  WITH base AS (
    SELECT p.id, p.username, p.phone_number, p.role, p.is_banned, p.created_at, p.last_active_at,
           coalesce(p.total_deposited, 0) AS total_deposited, coalesce(p.total_withdrawn, 0) AS total_withdrawn,
           coalesce(p.total_wagered, 0) AS total_wagered, coalesce(p.total_won, 0) AS total_won,
           coalesce(w.real_balance, 0) / 100.0 AS balance, coalesce(w.bonus_balance, 0) / 100.0 AS bonus,
           r.risk_level, p.site_id, s.name AS site_name
      FROM profiles p
      LEFT JOIN wallets w ON w.user_id = p.id
      LEFT JOIN player_risk_scores r ON r.user_id = p.id
      LEFT JOIN sites s ON s.id = p.site_id
     WHERE (v_site IS NULL OR p.site_id = v_site)
       AND CASE p_role WHEN 'player' THEN p.role = 'player' WHEN 'marketer' THEN p.role = 'marketer'
                       WHEN 'staff' THEN p.role IN ('super_admin','admin','finance_admin','support','platform_superadmin') ELSE true END
       AND (v_q IS NULL OR p.username ILIKE '%' || v_q || '%'
            OR (length(v_digits) >= 4 AND p.phone_number LIKE '%' || v_digits || '%')
            OR p.id::text = v_q)
       AND CASE p_status WHEN 'active' THEN NOT coalesce(p.is_banned, false) AND p.last_active_at > now() - interval '7 days'
                         WHEN 'banned' THEN coalesce(p.is_banned, false)
                         WHEN 'dormant' THEN NOT coalesce(p.is_banned, false) AND (p.last_active_at IS NULL OR p.last_active_at < now() - interval '30 days')
                         WHEN 'depositors' THEN coalesce(p.total_deposited, 0) > 0
                         WHEN 'high_risk' THEN r.risk_level IN ('high','critical')
                         ELSE true END
  )
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
           SELECT * FROM base
            ORDER BY
              CASE WHEN p_sort = 'newest' THEN created_at END DESC NULLS LAST,
              CASE WHEN p_sort = 'oldest' THEN created_at END ASC NULLS LAST,
              CASE WHEN p_sort = 'last_active' THEN last_active_at END DESC NULLS LAST,
              CASE WHEN p_sort = 'deposited' THEN total_deposited END DESC NULLS LAST,
              CASE WHEN p_sort = 'balance' THEN balance END DESC NULLS LAST,
              CASE WHEN p_sort = 'wagered' THEN total_wagered END DESC NULLS LAST,
              CASE WHEN p_sort = 'username' THEN lower(username) END ASC NULLS LAST,
              id
            LIMIT v_lim OFFSET v_off) x), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'limit', v_lim, 'offset', v_off);
END $$;

-- Audit log with filters and pagination.
CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_site uuid DEFAULT NULL, p_action text DEFAULT NULL, p_actor text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_site uuid := public._admin_scope(p_site);
  v_role text := (SELECT role FROM profiles WHERE id = auth.uid());
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off int := greatest(0, coalesce(p_offset, 0));
  v_total bigint; v_rows jsonb; v_actions jsonb;
BEGIN
  -- The audit trail is for owners and admins, not front-line roles.
  IF v_role NOT IN ('platform_superadmin','super_admin','admin') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  WITH base AS (
    SELECT a.id, a.created_at, a.action, a.target_type, a.target_id, a.details, a.site_id, s.name AS site_name,
           a.admin_id, p.username AS actor, p.role AS actor_role
      FROM admin_audit_log a
      LEFT JOIN profiles p ON p.id = a.admin_id
      LEFT JOIN sites s ON s.id = a.site_id
     WHERE (v_site IS NULL OR a.site_id = v_site)
       AND (p_action IS NULL OR p_action = '' OR a.action = p_action)
       AND (p_actor IS NULL OR p_actor = '' OR p.username ILIKE '%' || p_actor || '%')
       AND (p_from IS NULL OR a.created_at >= p_from)
       AND (p_to IS NULL OR a.created_at < p_to)
  )
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_lim OFFSET v_off) x), '[]'::jsonb)
    INTO v_total, v_rows;
  SELECT coalesce(jsonb_agg(DISTINCT action ORDER BY action), '[]'::jsonb) INTO v_actions
    FROM admin_audit_log WHERE v_site IS NULL OR site_id = v_site;
  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'actions', v_actions, 'limit', v_lim, 'offset', v_off);
END $$;

-- Brands the caller may pick in the scope switcher.
CREATE OR REPLACE FUNCTION public.admin_my_sites()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_site uuid;
BEGIN
  SELECT role, site_id INTO v_role, v_site FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','super_admin','admin','finance_admin','support') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug, 'status', status) ORDER BY name)
                     FROM sites WHERE v_role = 'platform_superadmin' OR id = v_site), '[]'::jsonb);
END $$;

-- ── grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._patch_fn(text,text,text) FROM PUBLIC, anon, authenticated;
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_is_staff()', '_admin_scope(uuid)', 'admin_get_mpesa_config()', 'admin_save_mpesa_config(jsonb,jsonb)',
    'admin_overview(uuid,integer)', 'admin_list_players(uuid,text,text,text,text,integer,integer)',
    'admin_list_audit(uuid,text,text,timestamptz,timestamptz,integer,integer)', 'admin_my_sites()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $g$;

COMMIT;
