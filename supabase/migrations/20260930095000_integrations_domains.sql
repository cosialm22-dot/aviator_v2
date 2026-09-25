-- ============================================================================
-- Multi-brand step 5: provider integrations (secrets in Vault) + brand domain automation.
--
-- 1. integrations: one row per provider account at a scope: global (the System), a platform, or
--    one brand. Non-secret settings are in `config`; secret values live ONLY in Supabase Vault and
--    the row keeps each secret's vault id and a short hint ("••••a1b2"). No RPC ever returns a
--    secret to a browser: only the service role (edge functions) can resolve one.
--    Resolution for a brand: brand → its platform → global (most specific enabled + complete wins).
--    Step 6 adds the payment providers to the catalog; this step adds Cloudflare (global only:
--    Worker custom domains must live in the same Cloudflare account as the Worker).
--
-- 2. site_domains gains a provisioning state machine driven by the brand-domains edge function:
--      queued → zone → nameservers → attaching → (conflict) → ssl → live   (+ error)
--    plus the per-domain options: attach www, redirect www → apex, send visitors to the primary.
--    Adding, updating and removing a domain are RPCs (authorised + validated here, testable in
--    SQL); the edge function only talks to Cloudflare and records what it saw.
--
-- 3. public_site_by_host returns the matched host and where it should redirect, and a pg_cron job
--    advances pending domains every 5 minutes (only wakes the function when something is due).
-- ============================================================================

-- ── 1. integrations ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  scope_kind   text NOT NULL CHECK (scope_kind IN ('global','platform','site')),
  scope_id     uuid,
  label        text,
  enabled      boolean NOT NULL DEFAULT true,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- name -> {vault_id, hint, set_at}
  test_ok      boolean,
  test_message text,
  tested_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK ((scope_kind = 'global') = (scope_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_scope
  ON public.integrations(provider, scope_kind, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integrations FROM anon, authenticated;

-- The provider catalog: what each provider needs, where it may be set, who may set it.
--   scopes     : where an account can be configured
--   config     : [{name,label,kind(text|enum|bool|url|email),required,options?,default?,help?}]
--   secrets    : [{name,label,required,help?}]
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
          'help','My Profile → API Tokens → Create token. Permissions: Account · Workers Scripts · Edit; Zone · Zone · Edit; Zone · DNS · Edit; Zone · Workers Routes · Edit. Zone resources: all zones in the account.')))
  );
$$;

CREATE OR REPLACE FUNCTION public._integration_hint(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(p_value) >= 12 THEN '••••' || right(p_value, 4) ELSE '••••' END;
$$;

-- Who may see / change integrations at a scope.
--   global   : the System owner only.
--   platform : the owner, or that platform's admins.
--   site     : the owner, or the platform admin whose platform runs the brand.
CREATE OR REPLACE FUNCTION public._integration_can(p_scope_kind text, p_scope_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_scope_kind
    WHEN 'global'   THEN p_scope_id IS NULL AND public._is_platform_superadmin()
    WHEN 'platform' THEN p_scope_id IS NOT NULL AND EXISTS (SELECT 1 FROM platforms WHERE id = p_scope_id) AND EXISTS (
                           SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                              AND (p.role = 'platform_superadmin' OR (p.role = 'platform_admin' AND p.platform_id = p_scope_id)))
    WHEN 'site'     THEN public._brand_can_edit(p_scope_id, 'platform')
    ELSE false END;
$$;

-- A row as the console may see it: config + secret hints, never a secret.
CREATE OR REPLACE FUNCTION public._integration_public(i integrations)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'provider', i.provider, 'scope_kind', i.scope_kind, 'scope_id', i.scope_id, 'label', i.label,
    'enabled', i.enabled, 'config', i.config,
    'secrets', coalesce((SELECT jsonb_object_agg(k, jsonb_build_object('set', true, 'hint', v->>'hint', 'set_at', v->>'set_at'))
                           FROM jsonb_each(i.secrets) e(k, v)), '{}'::jsonb),
    'test_ok', i.test_ok, 'test_message', i.test_message, 'tested_at', i.tested_at,
    'updated_at', i.updated_at, 'updated_by', (SELECT username FROM profiles WHERE id = i.updated_by));
$$;

CREATE OR REPLACE FUNCTION public.admin_integrations(p_scope_kind text DEFAULT 'global', p_scope_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cat jsonb := public._integration_catalog();
BEGIN
  IF NOT public._integration_can(p_scope_kind, p_scope_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'catalog', (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(cat) e(k, v) WHERE v->'scopes' ? p_scope_kind),
    'items', coalesce((SELECT jsonb_agg(public._integration_public(i) ORDER BY i.provider)
                         FROM integrations i
                        WHERE i.scope_kind = p_scope_kind AND i.scope_id IS NOT DISTINCT FROM p_scope_id), '[]'::jsonb));
END $$;

-- Create or update one provider account at a scope.
--   p_config  : the full non-secret settings (validated against the catalog)
--   p_secrets : {name: "new value"} sets, {name: null} clears, absent / "" keeps the stored value
CREATE OR REPLACE FUNCTION public.admin_integration_save(
  p_provider text, p_scope_kind text, p_scope_id uuid, p_config jsonb, p_secrets jsonb DEFAULT '{}'::jsonb,
  p_enabled boolean DEFAULT true, p_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE
  cat jsonb := public._integration_catalog() -> p_provider;
  f jsonb; v text; i integrations; clean jsonb := '{}'::jsonb; sec jsonb; k text; val jsonb;
  v_id uuid; changed text[] := '{}'; v_site uuid;
BEGIN
  IF cat IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PROVIDER' USING ERRCODE = '22023'; END IF;
  IF NOT (cat->'scopes' ? p_scope_kind) THEN RAISE EXCEPTION 'SCOPE_NOT_ALLOWED: % can only be set for %', p_provider, cat->'scopes' USING ERRCODE = '22023'; END IF;
  IF NOT public._integration_can(p_scope_kind, p_scope_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_label IS NOT NULL AND length(p_label) > 60 THEN RAISE EXCEPTION 'LABEL_TOO_LONG' USING ERRCODE = '22023'; END IF;

  -- config: only catalog fields, each validated
  FOR f IN SELECT * FROM jsonb_array_elements(cat->'config') LOOP
    v := nullif(trim(coalesce(p_config ->> (f->>'name'), f->>'default', '')), '');
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
  IF NOT FOUND THEN
    INSERT INTO integrations(provider, scope_kind, scope_id, config, enabled, label, updated_by)
    VALUES (p_provider, p_scope_kind, p_scope_id, clean, p_enabled, p_label, auth.uid()) RETURNING * INTO i;
    changed := array_append(changed, 'created');
  ELSE
    IF i.config IS DISTINCT FROM clean THEN changed := array_append(changed, 'config'); END IF;
    IF i.enabled IS DISTINCT FROM p_enabled THEN changed := array_append(changed, CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END); END IF;
  END IF;
  sec := i.secrets;

  -- secrets → Vault
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

  -- an enabled account must be complete
  IF p_enabled THEN
    FOR f IN SELECT * FROM jsonb_array_elements(cat->'secrets') LOOP
      IF coalesce((f->>'required')::boolean, false) AND NOT (sec ? (f->>'name')) THEN
        RAISE EXCEPTION 'REQUIRED: %', f->>'label' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE integrations SET config = clean, secrets = sec, enabled = p_enabled, label = coalesce(p_label, label),
         updated_at = now(), updated_by = auth.uid(),
         -- a changed account has not been tested yet
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
  FOR k, v IN SELECT * FROM jsonb_each(i.secrets) LOOP
    DELETE FROM vault.secrets WHERE id = (v->>'vault_id')::uuid;
  END LOOP;
  DELETE FROM integrations WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'integration_delete', 'integration', p_id::text,
          jsonb_build_object('provider', i.provider, 'scope', i.scope_kind, 'scope_id', i.scope_id),
          CASE WHEN i.scope_kind = 'site' THEN i.scope_id END);
END $$;

-- Service role only (edge functions): the account a brand uses for a provider, WITH secret values.
-- Brand → its platform → global; only enabled accounts whose required secrets are all present.
CREATE OR REPLACE FUNCTION public.svc_integration_resolve(p_provider text, p_site uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE i integrations; v_platform uuid; cat jsonb := public._integration_catalog() -> p_provider; out jsonb := '{}'::jsonb; k text; v jsonb;
BEGIN
  IF cat IS NULL THEN RETURN NULL; END IF;
  IF p_site IS NOT NULL THEN SELECT platform_id INTO v_platform FROM sites WHERE id = p_site; END IF;
  SELECT x.* INTO i FROM integrations x
   WHERE x.provider = p_provider AND x.enabled
     AND ((x.scope_kind = 'site' AND x.scope_id = p_site)
       OR (x.scope_kind = 'platform' AND x.scope_id = v_platform)
       OR  x.scope_kind = 'global')
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cat->'secrets') s
                      WHERE coalesce((s->>'required')::boolean, false) AND NOT (x.secrets ? (s->>'name')))
   ORDER BY CASE x.scope_kind WHEN 'site' THEN 0 WHEN 'platform' THEN 1 ELSE 2 END
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(i.secrets) LOOP
    out := out || jsonb_build_object(k, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = (v->>'vault_id')::uuid));
  END LOOP;
  RETURN jsonb_build_object('id', i.id, 'provider', i.provider, 'scope_kind', i.scope_kind, 'scope_id', i.scope_id,
                            'config', i.config, 'secrets', out);
END $$;

CREATE OR REPLACE FUNCTION public.svc_integration_record_test(p_id uuid, p_ok boolean, p_message text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE integrations SET test_ok = p_ok, test_message = left(p_message, 300), tested_at = now() WHERE id = p_id;
$$;

-- ── 2. domains: hostname rules ───────────────────────────────────────────────────────────────
-- Registrable domain (the Cloudflare zone): the last two labels, or three under a known
-- second-level public suffix (example.co.ke). Mirrored in src/admin/brand/domains.ts.
CREATE OR REPLACE FUNCTION public._domain_apex(p_host text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE l text[] := string_to_array(lower(p_host), '.'); n int := cardinality(string_to_array(lower(p_host), '.'));
BEGIN
  IF n < 2 THEN RETURN lower(p_host); END IF;
  IF n >= 3 AND (l[n-1] || '.' || l[n]) = ANY (ARRAY[
      'co.ke','or.ke','ne.ke','go.ke','ac.ke','sc.ke','me.ke','mobi.ke','info.ke',
      'co.tz','or.tz','ne.tz','go.tz','ac.tz','co.ug','or.ug','ne.ug','go.ug','ac.ug','co.rw','ac.rw',
      'com.ng','org.ng','net.ng','co.za','org.za','net.za','com.gh','org.gh','co.zm','co.zw','co.mz','com.et',
      'co.uk','org.uk','me.uk','ltd.uk','plc.uk','net.uk','com.au','net.au','org.au','co.nz','net.nz','org.nz',
      'co.in','net.in','org.in','com.br','com.mx','co.jp','com.cn','com.tr','com.sg','com.my','com.ph','co.id']) THEN
    RETURN l[n-2] || '.' || l[n-1] || '.' || l[n];
  END IF;
  RETURN l[n-1] || '.' || l[n];
END $$;

-- Clean what an operator typed ("https://WWW.Example.com:443/path") → "example.com"; NULL if it
-- is not a public hostname we can serve.
CREATE OR REPLACE FUNCTION public._domain_normalize(p_input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE h text := lower(trim(coalesce(p_input, '')));
BEGIN
  h := regexp_replace(h, '^[a-z][a-z0-9+.-]*://', '');   -- scheme
  h := regexp_replace(h, '[/?#].*$', '');                 -- path, query, fragment
  h := regexp_replace(h, '^[^@]*@', '');                  -- user@
  h := regexp_replace(h, ':[0-9]*$', '');                 -- port
  h := regexp_replace(h, '\.$', '');                      -- trailing dot
  h := regexp_replace(h, '^www\.', '');                   -- www is an option, not a domain
  IF h = '' OR length(h) > 253 THEN RETURN NULL; END IF;
  IF h !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN RETURN NULL; END IF;
  IF split_part(h, '.', -1) !~ '^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$' THEN RETURN NULL; END IF;   -- a real TLD (no IPs)
  IF h ~ '(^|\.)(workers\.dev|pages\.dev|supabase\.co|supabase\.in|cloudflare\.com|localhost|local|test|example|invalid)$' THEN RETURN NULL; END IF;
  RETURN h;
END $$;

-- ── 3. domains: provisioning state ──────────────────────────────────────────────────────────
ALTER TABLE public.site_domains
  ADD COLUMN IF NOT EXISTS apex                text,
  ADD COLUMN IF NOT EXISTS include_www         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS www_redirect        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS redirect_to_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage               text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS worker_domains      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- hostname -> Cloudflare custom-domain id
  ADD COLUMN IF NOT EXISTS ns_current          text[],
  ADD COLUMN IF NOT EXISTS conflict_records    jsonb,
  ADD COLUMN IF NOT EXISTS https_ok            boolean,
  ADD COLUMN IF NOT EXISTS activated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS attempts            int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_check_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS managed             boolean NOT NULL DEFAULT true;  -- false: connected by hand, never touched in Cloudflare
DO $$ BEGIN
  ALTER TABLE public.site_domains DROP CONSTRAINT IF EXISTS site_domains_stage_check;
  ALTER TABLE public.site_domains ADD CONSTRAINT site_domains_stage_check
    CHECK (stage IN ('queued','zone','nameservers','attaching','conflict','ssl','live','error'));
END $$;
UPDATE public.site_domains SET apex = public._domain_apex(hostname) WHERE apex IS NULL;
UPDATE public.site_domains SET stage = 'live' WHERE status = 'active' AND stage = 'queued';
CREATE INDEX IF NOT EXISTS idx_site_domains_due ON public.site_domains(next_check_at) WHERE stage <> 'live';
CREATE INDEX IF NOT EXISTS idx_site_domains_apex ON public.site_domains(apex);

-- www.<host> must never be registered as its own row when <host> exists (it is an option).
CREATE OR REPLACE FUNCTION public._site_domains_before()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.apex := public._domain_apex(NEW.hostname);
  NEW.updated_at := now();
  -- www is only meaningful on the apex itself
  IF NEW.hostname <> NEW.apex THEN NEW.include_www := false; END IF;
  NEW.status := CASE WHEN NEW.stage = 'live' THEN 'active' WHEN NEW.stage = 'error' THEN 'error' ELSE 'pending' END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_site_domains_before ON public.site_domains;
CREATE TRIGGER trg_site_domains_before BEFORE INSERT OR UPDATE ON public.site_domains
  FOR EACH ROW EXECUTE FUNCTION public._site_domains_before();

-- A site_domains row as the console shows it.
CREATE OR REPLACE FUNCTION public._domain_public(d site_domains)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(d) - 'created_by' || jsonb_build_object('created_by_name', (SELECT username FROM profiles WHERE id = d.created_by));
$$;

-- ── 4. domains: RPCs (console and edge function, as the caller) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_domains(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._can_admin_site(p_site) OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
       AND role IN ('platform_superadmin','platform_admin','super_admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'can_manage', public._brand_can_edit(p_site, 'platform'),
    'automation', EXISTS (SELECT 1 FROM integrations WHERE provider = 'cloudflare' AND scope_kind = 'global' AND enabled AND secrets ? 'api_token'),
    'domains', coalesce((SELECT jsonb_agg(public._domain_public(d) ORDER BY d.is_primary DESC, d.hostname) FROM site_domains d WHERE d.site_id = p_site), '[]'::jsonb));
END $$;

-- Add a domain to a brand. p_managed=false records a domain connected by hand (owner only).
CREATE OR REPLACE FUNCTION public.admin_domain_add(p_site uuid, p_hostname text, p_include_www boolean DEFAULT true, p_managed boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h text := public._domain_normalize(p_hostname); d site_domains; v_other uuid; v_first boolean;
BEGIN
  IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF h IS NULL THEN RAISE EXCEPTION 'INVALID_DOMAIN: Enter a domain like mybrand.com' USING ERRCODE = '22023'; END IF;
  IF NOT p_managed AND NOT public._is_platform_superadmin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM site_domains WHERE hostname = h) THEN
    RAISE EXCEPTION 'DOMAIN_TAKEN: % is already connected to %', h,
      CASE WHEN public._can_admin_site((SELECT site_id FROM site_domains WHERE hostname = h))
           THEN (SELECT s.name FROM site_domains x JOIN sites s ON s.id = x.site_id WHERE x.hostname = h) ELSE 'another brand' END
      USING ERRCODE = '23505';
  END IF;
  -- One registrable domain belongs to one scope: a platform admin can't take a subdomain of a
  -- domain another platform's brand uses (it would sit in the same Cloudflare zone).
  SELECT site_id INTO v_other FROM site_domains WHERE apex = public._domain_apex(h) AND NOT public._can_admin_site(site_id) LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'DOMAIN_TAKEN: % belongs to another brand''s domain', public._domain_apex(h) USING ERRCODE = '23505'; END IF;
  IF (SELECT count(*) FROM site_domains WHERE site_id = p_site) >= 10 THEN RAISE EXCEPTION 'TOO_MANY_DOMAINS: A brand can have up to 10 domains' USING ERRCODE = '22023'; END IF;
  v_first := NOT EXISTS (SELECT 1 FROM site_domains WHERE site_id = p_site);
  INSERT INTO site_domains(hostname, site_id, is_primary, stage, include_www, managed, created_by, next_check_at)
  VALUES (h, p_site, v_first, CASE WHEN p_managed THEN 'queued' ELSE 'live' END, coalesce(p_include_www, true), p_managed, auth.uid(), now())
  RETURNING * INTO d;
  IF NOT p_managed THEN UPDATE site_domains SET activated_at = now() WHERE hostname = h RETURNING * INTO d; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'domain_add', 'site', p_site::text, jsonb_build_object('hostname', h, 'include_www', d.include_www, 'managed', p_managed), p_site);
  RETURN public._domain_public(d);
END $$;

-- The edge function asks this (as the caller) before touching Cloudflare for a domain.
CREATE OR REPLACE FUNCTION public.admin_domain_authorize(p_hostname text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d site_domains;
BEGIN
  SELECT * INTO d FROM site_domains WHERE hostname = lower(trim(p_hostname));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._brand_can_edit(d.site_id, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN public._domain_public(d);
END $$;

-- Options and the primary domain. Changing www changes what must be attached → re-check.
CREATE OR REPLACE FUNCTION public.admin_domain_update(p_hostname text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d site_domains; k text;
BEGIN
  SELECT * INTO d FROM site_domains WHERE hostname = lower(trim(p_hostname)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._brand_can_edit(d.site_id, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('is_primary','include_www','www_redirect','redirect_to_primary') THEN RAISE EXCEPTION 'UNKNOWN_FIELD: %', k USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(p_patch->k) <> 'boolean' THEN RAISE EXCEPTION 'INVALID: %', k USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF (p_patch->>'is_primary')::boolean IS true AND NOT d.is_primary THEN
    UPDATE site_domains SET is_primary = false WHERE site_id = d.site_id AND is_primary;
    UPDATE site_domains SET is_primary = true, redirect_to_primary = false WHERE hostname = d.hostname;
  ELSIF (p_patch->>'is_primary')::boolean IS false AND d.is_primary THEN
    RAISE EXCEPTION 'PRIMARY_REQUIRED: Make another domain primary instead' USING ERRCODE = '22023';
  END IF;
  IF (p_patch->>'redirect_to_primary')::boolean IS true AND (d.is_primary OR (p_patch->>'is_primary')::boolean IS true) THEN
    RAISE EXCEPTION 'PRIMARY_REDIRECT: The primary domain cannot redirect to itself' USING ERRCODE = '22023';
  END IF;
  UPDATE site_domains SET
    include_www = coalesce((p_patch->>'include_www')::boolean, include_www),
    www_redirect = coalesce((p_patch->>'www_redirect')::boolean, www_redirect),
    redirect_to_primary = coalesce((p_patch->>'redirect_to_primary')::boolean, redirect_to_primary),
    -- a newly wanted www must be attached: send a live managed domain back through the check
    stage = CASE WHEN managed AND stage = 'live' AND (p_patch->>'include_www')::boolean IS true AND NOT include_www THEN 'attaching' ELSE stage END,
    next_check_at = CASE WHEN (p_patch ? 'include_www') THEN now() ELSE next_check_at END
   WHERE hostname = d.hostname RETURNING * INTO d;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'domain_update', 'site', d.site_id::text, jsonb_build_object('hostname', d.hostname, 'patch', p_patch), d.site_id);
  RETURN public._domain_public(d);
END $$;

-- Remove the row (the edge function detaches it from Cloudflare first). Removing the primary
-- promotes the oldest remaining domain.
CREATE OR REPLACE FUNCTION public.admin_domain_remove(p_hostname text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d site_domains;
BEGIN
  SELECT * INTO d FROM site_domains WHERE hostname = lower(trim(p_hostname)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._brand_can_edit(d.site_id, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  DELETE FROM site_domains WHERE hostname = d.hostname;
  IF d.is_primary THEN
    UPDATE site_domains SET is_primary = true, redirect_to_primary = false
     WHERE hostname = (SELECT hostname FROM site_domains WHERE site_id = d.site_id ORDER BY (stage = 'live') DESC, created_at LIMIT 1);
  END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'domain_remove', 'site', d.site_id::text, jsonb_build_object('hostname', d.hostname), d.site_id);
END $$;

-- ── 5. domains: service-role helpers for the edge function ──────────────────────────────────
-- Record what Cloudflare / DNS / HTTPS said. Only known columns; stage drives status.
CREATE OR REPLACE FUNCTION public.svc_domain_record(p_hostname text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d site_domains;
BEGIN
  UPDATE site_domains SET
    stage            = coalesce(p_patch->>'stage', stage),
    zone_id          = CASE WHEN p_patch ? 'zone_id' THEN p_patch->>'zone_id' ELSE zone_id END,
    zone_status      = CASE WHEN p_patch ? 'zone_status' THEN p_patch->>'zone_status' ELSE zone_status END,
    nameservers      = CASE WHEN p_patch ? 'nameservers' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'nameservers')) ELSE nameservers END,
    ns_current       = CASE WHEN p_patch ? 'ns_current' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'ns_current')) ELSE ns_current END,
    worker_status    = CASE WHEN p_patch ? 'worker_status' THEN p_patch->>'worker_status' ELSE worker_status END,
    worker_domains   = CASE WHEN p_patch ? 'worker_domains' THEN p_patch->'worker_domains' ELSE worker_domains END,
    ssl_status       = CASE WHEN p_patch ? 'ssl_status' THEN p_patch->>'ssl_status' ELSE ssl_status END,
    https_ok         = CASE WHEN p_patch ? 'https_ok' THEN (p_patch->>'https_ok')::boolean ELSE https_ok END,
    conflict_records = CASE WHEN p_patch ? 'conflict_records' THEN nullif(p_patch->'conflict_records', 'null'::jsonb) ELSE conflict_records END,
    last_error       = CASE WHEN p_patch ? 'last_error' THEN left(p_patch->>'last_error', 500) ELSE last_error END,
    activated_at     = CASE WHEN p_patch->>'stage' = 'live' AND stage <> 'live' THEN now() ELSE activated_at END,
    attempts         = CASE WHEN p_patch->>'stage' = 'live' THEN 0 ELSE attempts + 1 END,
    -- back off: 2, 5, 10, 20, 40 min … capped at an hour; a live domain is re-verified every 6 h
    next_check_at    = now() + CASE
                         WHEN p_patch ? 'next_check_seconds' THEN make_interval(secs => (p_patch->>'next_check_seconds')::int)
                         WHEN coalesce(p_patch->>'stage', stage) = 'live' THEN interval '6 hours'
                         WHEN coalesce(p_patch->>'stage', stage) IN ('error','conflict') THEN interval '1 hour'
                         ELSE least(interval '60 minutes', interval '2 minutes' * power(2, least(attempts, 5)))
                       END,
    last_checked_at  = now()
   WHERE hostname = lower(p_hostname) RETURNING * INTO d;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public._domain_public(d);
END $$;

-- Rows the sweep should look at now.
CREATE OR REPLACE FUNCTION public.svc_domains_due(p_limit int DEFAULT 25)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._domain_public(d) FROM site_domains d
   WHERE d.managed AND d.next_check_at <= now()
   ORDER BY (d.stage = 'live'), d.next_check_at LIMIT greatest(1, least(p_limit, 100));
$$;

CREATE OR REPLACE FUNCTION public.svc_domain_delete(p_hostname text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM site_domains WHERE hostname = lower(p_hostname);
$$;

-- Cron authentication without an environment secret: the job and the function both read the
-- same Vault secret, compared in constant time here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'domains_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'domains_cron_secret', 'brand-domains sweep');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.svc_cron_secret_ok(p_name text, p_value text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault, extensions, pg_temp AS $$
DECLARE v text;
BEGIN
  IF p_name NOT IN ('domains_cron_secret') OR coalesce(p_value, '') = '' THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  RETURN v IS NOT NULL AND length(v) = length(p_value)
     AND extensions.digest(v, 'sha256') = extensions.digest(p_value, 'sha256');
END $$;

CREATE OR REPLACE FUNCTION public.brand_domains_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault AS $$
DECLARE v_url text; v_secret text; v_req bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM site_domains WHERE managed AND next_check_at <= now()) THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM integrations WHERE provider = 'cloudflare' AND scope_kind = 'global' AND enabled AND secrets ? 'api_token') THEN RETURN 0; END IF;
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'domains_cron_secret' LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN RETURN NULL; END IF;
  SELECT net.http_post(url := rtrim(v_url, '/') || '/functions/v1/brand-domains',
                       body := '{"action":"sweep"}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
                       timeout_milliseconds := 60000) INTO v_req;
  RETURN v_req;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brand_domains') THEN PERFORM cron.unschedule('brand_domains'); END IF;
  PERFORM cron.schedule('brand_domains', '*/5 * * * *', 'SELECT public.brand_domains_tick();');
END $$;

-- ── 6. host → brand: matched host and redirect target ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_site_by_host(p_host text, p_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h text := lower(regexp_replace(regexp_replace(coalesce(trim(p_host), ''), ':[0-9]+$', ''), '\.$', ''));
  v_site uuid; s sites; v_matched text := 'default'; d site_domains; v_redirect text; v_primary text;
BEGIN
  IF h <> '' THEN
    SELECT * INTO d FROM site_domains WHERE hostname = h OR ('www.' || hostname = h AND include_www) ORDER BY (hostname = h) DESC LIMIT 1;
    IF FOUND THEN
      v_site := d.site_id; v_matched := 'domain';
      SELECT hostname INTO v_primary FROM site_domains WHERE site_id = d.site_id AND is_primary;
      IF d.redirect_to_primary AND NOT d.is_primary AND v_primary IS NOT NULL THEN v_redirect := v_primary;
      ELSIF h = 'www.' || d.hostname AND d.www_redirect THEN v_redirect := d.hostname;
      END IF;
    END IF;
  END IF;
  IF v_site IS NULL AND nullif(trim(coalesce(p_slug, '')), '') IS NOT NULL THEN
    SELECT id INTO v_site FROM sites WHERE slug = lower(trim(p_slug)) AND status = 'active';
    IF v_site IS NOT NULL THEN v_matched := 'preview'; END IF;
  END IF;
  IF v_site IS NULL THEN v_site := '00000000-0000-0000-0000-000000000001'; END IF;
  SELECT * INTO s FROM sites WHERE id = v_site;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'site_id', s.id, 'slug', s.slug, 'name', s.name, 'status', s.status, 'matched', v_matched,
    'host', CASE WHEN v_matched = 'domain' THEN jsonb_build_object('hostname', d.hostname, 'redirect_to', v_redirect) END,
    'version', s.config_version, 'theme', s.theme, 'wordmark_text', s.wordmark_text,
    'logo_url', s.logo_url, 'favicon_url', s.favicon_url, 'currency', s.currency, 'locale', s.locale,
    'licence_line', s.licence_line, 'support_email', s.support_email, 'primary_domain', s.primary_domain,
    'theme_tokens', coalesce(s.theme_tokens, '{}'::jsonb),
    'config', public.fn_brand_effective(s.id, true),
    -- legacy fields read by builds before the brand runtime
    'color_primary', s.color_primary, 'color_bg', s.color_bg, 'color_accent', s.color_accent,
    'withdrawals_enabled', s.withdrawals_enabled, 'plane_skin', s.plane_skin);
END $$;

-- ── 7. grants ───────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._integration_catalog(), public._integration_hint(text), public._integration_can(text, uuid),
  public._integration_public(integrations), public._domain_public(site_domains), public._site_domains_before(),
  public.svc_integration_resolve(text, uuid), public.svc_integration_record_test(uuid, boolean, text),
  public.svc_domain_record(text, jsonb), public.svc_domains_due(int), public.svc_domain_delete(text),
  public.svc_cron_secret_ok(text, text), public.brand_domains_tick()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.svc_integration_resolve(text, uuid), public.svc_integration_record_test(uuid, boolean, text),
  public.svc_domain_record(text, jsonb), public.svc_domains_due(int), public.svc_domain_delete(text),
  public.svc_cron_secret_ok(text, text), public.brand_domains_tick() TO service_role;
REVOKE ALL ON FUNCTION public.admin_integrations(text, uuid), public.admin_integration_save(text, text, uuid, jsonb, jsonb, boolean, text),
  public.admin_integration_delete(uuid), public.admin_domains(uuid), public.admin_domain_add(uuid, text, boolean, boolean),
  public.admin_domain_authorize(text), public.admin_domain_update(text, jsonb), public.admin_domain_remove(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_integrations(text, uuid), public.admin_integration_save(text, text, uuid, jsonb, jsonb, boolean, text),
  public.admin_integration_delete(uuid), public.admin_domains(uuid), public.admin_domain_add(uuid, text, boolean, boolean),
  public.admin_domain_authorize(text), public.admin_domain_update(text, jsonb), public.admin_domain_remove(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._domain_apex(text), public._domain_normalize(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_site_by_host(text, text) TO anon, authenticated;
