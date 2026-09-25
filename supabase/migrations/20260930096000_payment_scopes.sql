-- ============================================================================
-- Multi-brand step 6: per-brand / per-platform payment gateway accounts ("payment scopes"),
-- ported from invest254 docs/43 (PAY-1). Owner decision: "for now all brands share the same
-- gateway, but add config where each brand can have its own".
--
-- A payment scope is whose gateway account a brand's money flows through:
--   global        the System (default for every brand): the System's Mega Pay account, or the
--                 server environment (MEGAPAY_* secrets) when none is saved — today's behaviour
--   platform:<id> a platform's own account, for all its brands
--   site:<id>     one brand's own account
-- A brand's PAYMENT OWNER = its own scope if live → its platform's scope if live → global.
-- Each non-global scope has an explicit go-live switch; until then its account is a draft
-- (stored, testable, never used by live payments).
--
-- Money-safety invariants (tested in supabase/tests/payment_scopes_e2e.py):
--   1. No mixing: a brand's deposits use its payment owner's account only. If that account is
--      missing or off, deposits are unavailable (GATEWAY_NOT_CONFIGURED); never a silent fallback
--      to the System's account.
--   2. Verification uses the initiating account: every deposit row records its scope and account
--      at initiation; status checks, the webhook and the reconcile sweep use THAT account.
--   3. A platform admin cannot redirect verification: the environment (sandbox) and the API
--      address are System-owner-only fields.
--   4. Go-live needs a complete, successfully tested account; while a scope is live its account
--      cannot be switched off or deleted.
--   5. Secrets are write-only (Vault; see 20260930095000).
-- Only providers that live payments honour are in the catalog (Mega Pay deposits). Payouts are
-- approved in the back office and paid by the brand's finance staff (see BUGLOG).
-- ============================================================================

-- ── 1. catalog: Mega Pay at every scope; owner-only fields ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._integration_catalog()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'cloudflare', jsonb_build_object(
      'label', 'Cloudflare (domains)',
      'help', 'Creates each brand''s Cloudflare zone, connects its domain to the app and issues HTTPS. The account must be the one that runs the app''s Worker.',
      'scopes', jsonb_build_array('global'),
      'config', jsonb_build_array(
        jsonb_build_object('name','account_id','label','Account ID','kind','text','required',true,'pattern','^[0-9a-f]{32}$',
          'help','Cloudflare dashboard → any domain → Overview → API → Account ID.'),
        jsonb_build_object('name','worker_service','label','Worker name','kind','text','required',true,'default','aviatorv2','pattern','^[a-z0-9][a-z0-9-]{0,62}$',
          'help','The Worker that serves the app (wrangler.jsonc "name").')),
      'secrets', jsonb_build_array(
        jsonb_build_object('name','api_token','label','API token','required',true,
          'help','My Profile → API Tokens → Create token. Permissions: Account · Workers Scripts · Edit; Zone · Zone · Edit; Zone · DNS · Edit; Zone · Workers Routes · Edit. Zone resources: all zones in the account.'))),
    'megapay', jsonb_build_object(
      'label', 'Mega Pay (M-Pesa deposits)',
      'help', 'Players pay by M-Pesa prompt into this Mega Pay account. The business name on the prompt is set in the Mega Pay merchant account; the account name is the brand''s "M-Pesa account name".',
      'scopes', jsonb_build_array('global','platform','site'),
      'config', jsonb_build_array(
        jsonb_build_object('name','email','label','Account email','kind','email','required',true,
          'help','The email of the Mega Pay merchant account (Mega Pay dashboard → Profile).'),
        jsonb_build_object('name','env','label','Environment','kind','enum','required',true,'default','production','options',jsonb_build_array('production','sandbox'),'owner_only',true,
          'help','Sandbox is for tests with a sandbox key. Only the System owner can choose it.'),
        jsonb_build_object('name','base_url','label','API address','kind','url','required',false,'owner_only',true,
          'help','Leave empty to use Mega Pay''s own address. Only the System owner can change it.')),
      'secrets', jsonb_build_array(
        jsonb_build_object('name','api_key','label','API key','required',true,
          'help','Mega Pay dashboard → API keys. Test the connection before going live.')))
  );
$$;

-- admin_integration_save: + owner-only fields, + a live payment scope's account can't be switched off.
CREATE OR REPLACE FUNCTION public.admin_integration_save(
  p_provider text, p_scope_kind text, p_scope_id uuid, p_config jsonb, p_secrets jsonb DEFAULT '{}'::jsonb,
  p_enabled boolean DEFAULT true, p_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE
  cat jsonb := public._integration_catalog() -> p_provider;
  f jsonb; v text; i integrations; clean jsonb := '{}'::jsonb; sec jsonb; k text; val jsonb;
  v_id uuid; changed text[] := '{}'; v_site uuid; v_owner boolean := public._is_platform_superadmin();
BEGIN
  IF cat IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PROVIDER' USING ERRCODE = '22023'; END IF;
  IF NOT (cat->'scopes' ? p_scope_kind) THEN RAISE EXCEPTION 'SCOPE_NOT_ALLOWED: % can only be set for %', p_provider, cat->'scopes' USING ERRCODE = '22023'; END IF;
  IF NOT public._integration_can(p_scope_kind, p_scope_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_label IS NOT NULL AND length(p_label) > 60 THEN RAISE EXCEPTION 'LABEL_TOO_LONG' USING ERRCODE = '22023'; END IF;

  FOR f IN SELECT * FROM jsonb_array_elements(cat->'config') LOOP
    v := nullif(trim(coalesce(p_config ->> (f->>'name'), f->>'default', '')), '');
    -- where we talk to / which environment: the System owner only (a platform admin could
    -- otherwise point status checks at a server that reports fake payments)
    IF coalesce((f->>'owner_only')::boolean, false) AND NOT v_owner AND v IS DISTINCT FROM nullif(f->>'default', '') THEN
      RAISE EXCEPTION 'OWNER_ONLY_FIELD: %', f->>'label' USING ERRCODE = '42501';
    END IF;
    IF v IS NULL THEN
      IF coalesce((f->>'required')::boolean, false) AND p_enabled THEN
        RAISE EXCEPTION 'REQUIRED: %', f->>'label' USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF length(v) > 300 THEN RAISE EXCEPTION 'TOO_LONG: %', f->>'label' USING ERRCODE = '22023'; END IF;
    IF f ? 'pattern' AND v !~ (f->>'pattern') THEN RAISE EXCEPTION 'INVALID: %', f->>'label' USING ERRCODE = '22023'; END IF;
    IF f->>'kind' = 'enum' AND NOT (f->'options' ? v) THEN RAISE EXCEPTION 'INVALID: %', f->>'label' USING ERRCODE = '22023'; END IF;
    IF f->>'kind' = 'url' AND v !~ '^https://[^\s/$.?#].[^\s]*$' THEN RAISE EXCEPTION 'INVALID_URL: % must be an https:// address', f->>'label' USING ERRCODE = '22023'; END IF;
    IF f->>'kind' = 'email' AND v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'INVALID: %', f->>'label' USING ERRCODE = '22023'; END IF;
    IF f->>'kind' = 'bool' THEN
      IF v NOT IN ('true','false') THEN RAISE EXCEPTION 'INVALID: %', f->>'label' USING ERRCODE = '22023'; END IF;
      clean := clean || jsonb_build_object(f->>'name', v::boolean);
    ELSE
      clean := clean || jsonb_build_object(f->>'name', v);
    END IF;
  END LOOP;

  SELECT * INTO i FROM integrations
   WHERE provider = p_provider AND scope_kind = p_scope_kind AND scope_id IS NOT DISTINCT FROM p_scope_id FOR UPDATE;
  IF FOUND AND i.enabled AND NOT p_enabled AND p_scope_kind <> 'global'
     AND EXISTS (SELECT 1 FROM payment_scopes WHERE scope_kind = p_scope_kind AND scope_id = p_scope_id AND active)
     AND p_provider = 'megapay' THEN
    RAISE EXCEPTION 'SCOPE_LIVE: Turn off go-live before switching this account off' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    INSERT INTO integrations(provider, scope_kind, scope_id, config, enabled, label, updated_by)
    VALUES (p_provider, p_scope_kind, p_scope_id, clean, p_enabled, p_label, auth.uid()) RETURNING * INTO i;
    changed := array_append(changed, 'created');
  ELSE
    IF i.config IS DISTINCT FROM clean THEN changed := array_append(changed, 'config'); END IF;
    IF i.enabled IS DISTINCT FROM p_enabled THEN changed := array_append(changed, CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END); END IF;
  END IF;
  sec := i.secrets;

  FOR k, val IN SELECT * FROM jsonb_each(coalesce(p_secrets, '{}'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cat->'secrets') s WHERE s->>'name' = k) THEN
      RAISE EXCEPTION 'UNKNOWN_SECRET: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(val) = 'null' THEN
      IF sec ? k THEN
        DELETE FROM vault.secrets WHERE id = (sec->k->>'vault_id')::uuid;
        sec := sec - k; changed := array_append(changed, k || ' cleared');
      END IF;
    ELSIF jsonb_typeof(val) = 'string' AND trim(val #>> '{}') <> '' THEN
      v := trim(val #>> '{}');
      IF length(v) > 4000 THEN RAISE EXCEPTION 'TOO_LONG: %', k USING ERRCODE = '22023'; END IF;
      IF sec ? k AND EXISTS (SELECT 1 FROM vault.secrets WHERE id = (sec->k->>'vault_id')::uuid) THEN
        v_id := (sec->k->>'vault_id')::uuid;
        PERFORM vault.update_secret(v_id, v);
      ELSE
        v_id := vault.create_secret(v, 'integration:' || i.id || ':' || k, p_provider || ' ' || k || ' (' || p_scope_kind || ')');
      END IF;
      sec := sec || jsonb_build_object(k, jsonb_build_object('vault_id', v_id, 'hint', public._integration_hint(v), 'set_at', now()));
      changed := array_append(changed, k || ' set');
    END IF;
  END LOOP;

  IF p_enabled THEN
    FOR f IN SELECT * FROM jsonb_array_elements(cat->'secrets') LOOP
      IF coalesce((f->>'required')::boolean, false) AND NOT (sec ? (f->>'name')) THEN
        RAISE EXCEPTION 'REQUIRED: %', f->>'label' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE integrations SET config = clean, secrets = sec, enabled = p_enabled, label = coalesce(p_label, label),
         updated_at = now(), updated_by = auth.uid(),
         test_ok = CASE WHEN cardinality(changed) > 0 THEN NULL ELSE test_ok END,
         test_message = CASE WHEN cardinality(changed) > 0 THEN NULL ELSE test_message END,
         tested_at = CASE WHEN cardinality(changed) > 0 THEN NULL ELSE tested_at END
   WHERE id = i.id RETURNING * INTO i;

  v_site := CASE WHEN p_scope_kind = 'site' THEN p_scope_id END;
  IF cardinality(changed) > 0 THEN
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'integration_save', 'integration', i.id::text,
            jsonb_build_object('provider', p_provider, 'scope', p_scope_kind, 'scope_id', p_scope_id, 'changed', to_jsonb(changed)), v_site);
  END IF;
  RETURN public._integration_public(i);
END $$;

CREATE OR REPLACE FUNCTION public.admin_integration_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE i integrations; k text; v jsonb;
BEGIN
  SELECT * INTO i FROM integrations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._integration_can(i.scope_kind, i.scope_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF i.provider = 'megapay' AND i.scope_kind <> 'global'
     AND EXISTS (SELECT 1 FROM payment_scopes WHERE scope_kind = i.scope_kind AND scope_id = i.scope_id AND active) THEN
    RAISE EXCEPTION 'SCOPE_LIVE: Turn off go-live before deleting this account' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(i.secrets) LOOP
    DELETE FROM vault.secrets WHERE id = (v->>'vault_id')::uuid;
  END LOOP;
  DELETE FROM integrations WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'integration_delete', 'integration', p_id::text,
          jsonb_build_object('provider', i.provider, 'scope', i.scope_kind, 'scope_id', i.scope_id),
          CASE WHEN i.scope_kind = 'site' THEN i.scope_id END);
END $$;

-- ── 2. payment scopes + the payment owner ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_scopes (
  scope_kind   text NOT NULL CHECK (scope_kind IN ('platform','site')),
  scope_id     uuid NOT NULL,
  active       boolean NOT NULL DEFAULT false,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  changed_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (scope_kind, scope_id)
);
ALTER TABLE public.payment_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_scopes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._scope_key(p_kind text, p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_kind = 'global' OR p_id IS NULL THEN 'global' ELSE p_kind || ':' || p_id END;
$$;

-- A complete, enabled Mega Pay account at EXACTLY this scope (no fallback), or NULL.
CREATE OR REPLACE FUNCTION public._megapay_account(p_kind text, p_id uuid)
RETURNS integrations LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.* FROM integrations i
   WHERE i.provider = 'megapay' AND i.scope_kind = p_kind AND i.scope_id IS NOT DISTINCT FROM p_id
     AND i.enabled AND i.secrets ? 'api_key' AND nullif(i.config->>'email', '') IS NOT NULL;
$$;

-- Whose account a brand's money uses right now.
CREATE OR REPLACE FUNCTION public.fn_payment_owner(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_platform uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM payment_scopes WHERE scope_kind = 'site' AND scope_id = p_site AND active) THEN
    RETURN jsonb_build_object('kind', 'site', 'id', p_site, 'key', public._scope_key('site', p_site),
                              'name', (SELECT name FROM sites WHERE id = p_site));
  END IF;
  SELECT platform_id INTO v_platform FROM sites WHERE id = p_site;
  IF v_platform IS NOT NULL AND EXISTS (SELECT 1 FROM payment_scopes WHERE scope_kind = 'platform' AND scope_id = v_platform AND active) THEN
    RETURN jsonb_build_object('kind', 'platform', 'id', v_platform, 'key', public._scope_key('platform', v_platform),
                              'name', (SELECT name FROM platforms WHERE id = v_platform));
  END IF;
  RETURN jsonb_build_object('kind', 'global', 'id', NULL, 'key', 'global', 'name', 'System');
END $$;

-- Can this brand take deposits through its payment owner right now? The System scope is ready
-- when it has a saved account OR the server environment is configured (the edge function knows
-- the latter; here we assume it is, as before this migration).
CREATE OR REPLACE FUNCTION public._payment_gateway_ready(p_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN o->>'kind' = 'global' THEN true
              ELSE (public._megapay_account(o->>'kind', (o->>'id')::uuid)).id IS NOT NULL END
    FROM (SELECT public.fn_payment_owner(p_site) o) x;
$$;

-- ── 3. deposits record their scope and account ───────────────────────────────────────────────
ALTER TABLE public.mpesa_stk_requests
  ADD COLUMN IF NOT EXISTS payment_scope  text,
  ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL;
UPDATE public.mpesa_stk_requests SET payment_scope = 'global' WHERE payment_scope IS NULL AND provider = 'megapay';

CREATE OR REPLACE FUNCTION public.fn_megapay_begin(p_user uuid, p_phone text, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_g jsonb; v_id uuid; v_recent int; v_owner jsonb; v_acc integrations;
BEGIN
  IF coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay') <> 'megapay' THEN
    RAISE EXCEPTION 'MEGAPAY_DISABLED';
  END IF;
  v_g := public.fn_deposit_guard(p_user, p_amount);
  IF p_phone IS NULL OR p_phone !~ '^254(7|1)[0-9]{8}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  -- the brand's payment owner and its account (invariant 1: no fallback for a non-System owner)
  v_owner := public.fn_payment_owner((v_g->>'site_id')::uuid);
  v_acc := public._megapay_account(v_owner->>'kind', (v_owner->>'id')::uuid);
  IF v_owner->>'kind' <> 'global' AND v_acc.id IS NULL THEN RAISE EXCEPTION 'GATEWAY_NOT_CONFIGURED'; END IF;
  SELECT count(*) INTO v_recent FROM mpesa_stk_requests
   WHERE user_id = p_user AND provider = 'megapay' AND created_at > now() - interval '2 minutes';
  IF v_recent >= 3 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  v_id := gen_random_uuid();
  INSERT INTO mpesa_stk_requests(id, user_id, phone_number, amount, checkout_request_id, status, provider, site_id, reference, payment_scope, integration_id)
  VALUES (v_id, p_user, p_phone, p_amount, 'mp-pending:' || v_id, 'initiated', 'megapay', (v_g->>'site_id')::uuid, v_g->>'reference',
          v_owner->>'key', v_acc.id);
  RETURN jsonb_build_object('id', v_id, 'reference', v_g->>'reference', 'payment_scope', v_owner->>'key', 'integration_id', v_acc.id);
END $$;

-- The reconcile sweep needs each row's account.
DROP FUNCTION IF EXISTS public.fn_megapay_due(integer);
CREATE FUNCTION public.fn_megapay_due(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, trid text, created_at timestamptz, site_id uuid, payment_scope text, integration_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.checkout_request_id, r.created_at, r.site_id, coalesce(r.payment_scope, 'global'), r.integration_id FROM mpesa_stk_requests r
   WHERE r.provider = 'megapay' AND r.status IN ('pending', 'timeout')
     AND r.created_at > now() - interval '3 days'
     AND (r.last_checked_at IS NULL OR r.last_checked_at < now() - interval '20 seconds')
   ORDER BY r.created_at LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- Service role: the account (with secrets) of one integration, enabled or not — a deposit made
-- through it must still be verifiable after the account is switched off (invariant 2).
CREATE OR REPLACE FUNCTION public.svc_integration_by_id(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE i integrations; out jsonb := '{}'::jsonb; k text; v jsonb;
BEGIN
  SELECT * INTO i FROM integrations WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(i.secrets) LOOP
    out := out || jsonb_build_object(k, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = (v->>'vault_id')::uuid));
  END LOOP;
  RETURN jsonb_build_object('id', i.id, 'provider', i.provider, 'scope_kind', i.scope_kind, 'scope_id', i.scope_id,
                            'enabled', i.enabled, 'config', i.config, 'secrets', out);
END $$;

-- Service role: the account saved at exactly this scope (for "Test connection"), or NULL.
CREATE OR REPLACE FUNCTION public.svc_integration_at(p_provider text, p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.svc_integration_by_id(i.id) FROM integrations i
   WHERE i.provider = p_provider AND i.scope_kind = p_kind AND i.scope_id IS NOT DISTINCT FROM p_id;
$$;

-- Service role: may this user (staff) act on this brand? (edge functions run as service role)
CREATE OR REPLACE FUNCTION public.svc_staff_can_site(p_user uuid, p_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_site IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = p_user AND (
         p.role = 'platform_superadmin'
      OR (p.role = 'platform_admin' AND EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site AND s.platform_id = p.platform_id))
      OR (p.role IN ('super_admin','admin','finance_admin','support') AND p.site_id = p_site)));
$$;

-- ── 4. go-live ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_payment_scope_set(p_kind text, p_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acc integrations; v_was boolean; v_site uuid;
BEGIN
  IF p_kind NOT IN ('platform','site') OR p_id IS NULL THEN RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = '22023'; END IF;
  IF NOT public._integration_can(p_kind, p_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT active INTO v_was FROM payment_scopes WHERE scope_kind = p_kind AND scope_id = p_id FOR UPDATE;
  IF p_active THEN
    v_acc := public._megapay_account(p_kind, p_id);
    IF v_acc.id IS NULL THEN RAISE EXCEPTION 'GATEWAY_INCOMPLETE: Save a complete Mega Pay account first' USING ERRCODE = '22023'; END IF;
    IF v_acc.test_ok IS NOT TRUE THEN RAISE EXCEPTION 'GATEWAY_UNTESTED: Test the connection successfully first' USING ERRCODE = '22023'; END IF;
    IF v_acc.config->>'env' = 'sandbox' THEN RAISE EXCEPTION 'GATEWAY_SANDBOX: A sandbox account cannot take real deposits' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO payment_scopes(scope_kind, scope_id, active, changed_at, changed_by) VALUES (p_kind, p_id, p_active, now(), auth.uid())
  ON CONFLICT (scope_kind, scope_id) DO UPDATE SET active = EXCLUDED.active, changed_at = now(), changed_by = auth.uid();
  IF v_was IS DISTINCT FROM p_active THEN
    v_site := CASE WHEN p_kind = 'site' THEN p_id END;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), CASE WHEN p_active THEN 'payment_scope_live' ELSE 'payment_scope_off' END, p_kind, p_id::text,
            jsonb_build_object('scope', public._scope_key(p_kind, p_id), 'account', v_acc.id), v_site);
  END IF;
  RETURN public.admin_payment_overview(p_kind, p_id);
END $$;

-- What the Payments screens show: the scope's switch + account summary + (platform) each brand's
-- payment owner; (site) the brand's owner and its platform's state. Never a secret.
CREATE OR REPLACE FUNCTION public.admin_payment_overview(p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_platform uuid; out jsonb;
BEGIN
  IF p_kind = 'site' THEN
    -- a brand owner may SEE whose account its money goes to; changing it is platform tier
    IF NOT public._can_admin_site(p_id) OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('platform_superadmin','platform_admin','super_admin','finance_admin')) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    SELECT platform_id INTO v_platform FROM sites WHERE id = p_id;
  ELSIF NOT public._integration_can(p_kind, p_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  out := jsonb_build_object(
    'scope', public._scope_key(p_kind, p_id),
    'can_manage', CASE WHEN p_kind = 'global' THEN public._is_platform_superadmin() ELSE public._integration_can(p_kind, p_id) END,
    'active', CASE WHEN p_kind = 'global' THEN true ELSE coalesce((SELECT active FROM payment_scopes WHERE scope_kind = p_kind AND scope_id = p_id), false) END,
    'changed_at', (SELECT changed_at FROM payment_scopes WHERE scope_kind = p_kind AND scope_id = p_id),
    'changed_by', (SELECT username FROM payment_scopes ps JOIN profiles pr ON pr.id = ps.changed_by WHERE ps.scope_kind = p_kind AND ps.scope_id = p_id),
    'account', (SELECT jsonb_build_object('id', i.id, 'enabled', i.enabled, 'complete', (public._megapay_account(p_kind, p_id)).id IS NOT NULL,
                  'test_ok', i.test_ok, 'env', i.config->>'env', 'email_hint', regexp_replace(i.config->>'email', '^(.).*(@.*)$', '\1•••\2'))
                  FROM integrations i WHERE i.provider = 'megapay' AND i.scope_kind = p_kind AND i.scope_id IS NOT DISTINCT FROM p_id));
  IF p_kind = 'site' THEN
    out := out || jsonb_build_object('owner', public.fn_payment_owner(p_id), 'ready', public._payment_gateway_ready(p_id),
      'platform', CASE WHEN v_platform IS NULL THEN NULL ELSE jsonb_build_object('id', v_platform, 'name', (SELECT name FROM platforms WHERE id = v_platform),
                  'active', coalesce((SELECT active FROM payment_scopes WHERE scope_kind = 'platform' AND scope_id = v_platform), false)) END);
  ELSIF p_kind = 'platform' THEN
    out := out || jsonb_build_object('brands', coalesce((SELECT jsonb_agg(jsonb_build_object('site_id', s.id, 'name', s.name, 'owner', public.fn_payment_owner(s.id),
                  'ready', public._payment_gateway_ready(s.id)) ORDER BY s.name) FROM sites s WHERE s.platform_id = p_id), '[]'::jsonb));
  ELSE
    out := out || jsonb_build_object('live_scopes', coalesce((SELECT jsonb_agg(jsonb_build_object('scope', public._scope_key(ps.scope_kind, ps.scope_id),
                  'kind', ps.scope_kind, 'id', ps.scope_id,
                  'name', CASE ps.scope_kind WHEN 'site' THEN (SELECT name FROM sites WHERE id = ps.scope_id) ELSE (SELECT name FROM platforms WHERE id = ps.scope_id) END,
                  'changed_at', ps.changed_at) ORDER BY ps.changed_at DESC) FROM payment_scopes ps WHERE ps.active), '[]'::jsonb));
  END IF;
  RETURN out;
END $$;

-- ── 5. players see deposits only when their brand's gateway is ready ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_public_payment_config(p_site uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_site uuid; e jsonb;
BEGIN
  v_site := coalesce((SELECT site_id FROM profiles WHERE id = auth.uid()),
                     (SELECT id FROM sites WHERE id = p_site),
                     '00000000-0000-0000-0000-000000000001'::uuid);
  e := public.fn_brand_effective(v_site, true);
  RETURN jsonb_build_object(
    'site_id', v_site,
    'deposit_provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', (e->>'limits.min_deposit')::numeric, 'max_deposit', (e->>'limits.max_deposit')::numeric,
    'deposit_chips', e->'limits.deposit_chips',
    'min_withdrawal', (e->>'limits.min_withdrawal')::numeric,
    'max_withdrawal', (e->>'limits.max_withdrawal')::numeric, 'daily_withdrawal', (e->>'limits.daily_withdrawal')::numeric,
    'min_bet', (e->>'limits.min_bet')::numeric, 'max_bet', (e->>'limits.max_bet')::numeric,
    'max_payout', (e->>'limits.max_payout')::numeric, 'default_bet', (e->>'limits.default_bet')::numeric,
    'bet_chips', e->'limits.bet_chips',
    'deposits', (e->>'features.deposits')::boolean AND NOT (e->>'features.maintenance')::boolean AND public._payment_gateway_ready(v_site),
    'withdrawals', (e->>'features.withdrawals')::boolean AND NOT (e->>'features.maintenance')::boolean,
    'offer', CASE WHEN (e->>'bonus.welcome_enabled')::boolean OR (e->>'bonus.deposit_enabled')::boolean THEN jsonb_build_object(
        'welcome', CASE WHEN (e->>'bonus.welcome_enabled')::boolean THEN (e->>'bonus.welcome_amount')::numeric ELSE 0 END,
        'match_pct', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_pct')::numeric ELSE 0 END,
        'match_cap', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_cap')::numeric ELSE 0 END,
        'wager_x', greatest((e->>'bonus.welcome_wager_x')::numeric, (e->>'bonus.deposit_wager_x')::numeric)) END);
END $$;

-- ── 6. grants ───────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._scope_key(text, uuid), public._megapay_account(text, uuid), public._payment_gateway_ready(uuid),
  public.fn_payment_owner(uuid), public.svc_integration_by_id(uuid), public.svc_integration_at(text, text, uuid),
  public.svc_staff_can_site(uuid, uuid), public.fn_megapay_begin(uuid, text, numeric), public.fn_megapay_due(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.svc_integration_by_id(uuid), public.svc_integration_at(text, text, uuid), public.svc_staff_can_site(uuid, uuid),
  public.fn_megapay_begin(uuid, text, numeric), public.fn_megapay_due(integer), public.fn_payment_owner(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_payment_scope_set(text, uuid, boolean), public.admin_payment_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_scope_set(text, uuid, boolean), public.admin_payment_overview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_payment_config(uuid) TO anon, authenticated;
