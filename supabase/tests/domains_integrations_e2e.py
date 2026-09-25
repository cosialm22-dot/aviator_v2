#!/usr/bin/env python3
"""E2E for provider integrations (Vault-backed secrets) and brand domains (migration
20260930095000) — the real schema, one transaction, everything rolled back.

Fixtures: platforms P1 (brand B) and P2 (brand C), a platform admin for each, B's brand owner and
admin. Checks, as each caller: who may read/write integrations at which scope, that secrets go to
Vault and never come back out of a console RPC, resolution order, hostname rules, who may add /
update / remove a domain, cross-platform domain isolation, primary + redirect rules, what the
public host resolver returns, the provisioning state machine's bookkeeping, and grants.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/domains_integrations_e2e.py
"""
import json, os, re, sys, urllib.request

TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]

def run(sql: str):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

TESTS = r"""
CREATE OR REPLACE FUNCTION pg_temp.act(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', u::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
DO $t$
DECLARE
  out jsonb := '[]'::jsonb;
  A uuid := '00000000-0000-0000-0000-000000000001'; B uuid; C uuid; P1 uuid; P2 uuid;
  own uuid := public._root_super_admin();
  pa1 uuid := gen_random_uuid(); pa2 uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); ab uuid := gen_random_uuid();
  r jsonb; e text; n int; vid uuid; vid2 uuid; secret text := 'cf-e2e-SECRET-value-7Qx9Zk1234'; ts timestamptz; i int;
BEGIN
  -- ── fixtures ──
  DELETE FROM integrations WHERE provider = 'cloudflare';          -- any real account: rolled back at the end
  INSERT INTO platforms(slug, name) VALUES ('e2e-dom-p1', 'Dom One') RETURNING id INTO P1;
  INSERT INTO platforms(slug, name) VALUES ('e2e-dom-p2', 'Dom Two') RETURNING id INTO P2;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-dom-b', 'Dom Brand B', 'active', P1) RETURNING id INTO B;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-dom-c', 'Dom Brand C', 'active', P2) RETURNING id INTO C;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dom-' || k || '@example.invalid',
         jsonb_build_object('username', 'dom' || k, 'phone', '2547340000' || lpad(v.n::text, 2, '0')), now(), now()
    FROM (VALUES (pa1,'pa1',1),(pa2,'pa2',2),(sb,'sb',3),(ab,'ab',4)) v(u,k,n);
  UPDATE profiles SET role = 'platform_admin', platform_id = P1 WHERE id = pa1;
  UPDATE profiles SET role = 'platform_admin', platform_id = P2 WHERE id = pa2;
  UPDATE profiles SET site_id = B WHERE id IN (sb, ab);
  UPDATE profiles SET role = 'super_admin' WHERE id = sb;
  UPDATE profiles SET role = 'admin' WHERE id = ab;

  -- ═════════ integrations ═════════
  PERFORM pg_temp.act(pa1);
  e := pg_temp.err($$SELECT public.admin_integrations('global', NULL)$$);
  out := out || jsonb_build_object('t','platform admin cannot see the System''s integrations', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_integrations('platform', %L)$$, P2));
  out := out || jsonb_build_object('t','platform admin cannot see another platform''s integrations', 'ok', e = 'FORBIDDEN', 'got', e);
  r := public.admin_integrations('platform', P1);
  out := out || jsonb_build_object('t','platform admin sees its own platform scope (Cloudflare is not offered there)', 'ok', NOT (r->'catalog' ? 'cloudflare'), 'got', r);
  r := public.admin_integrations('site', B);
  out := out || jsonb_build_object('t','platform admin sees its brand scope', 'ok', r ? 'items', 'got', r);
  PERFORM pg_temp.act(sb);
  e := pg_temp.err(format($$SELECT public.admin_integrations('site', %L)$$, B));
  out := out || jsonb_build_object('t','brand owner cannot see gateway accounts', 'ok', e = 'FORBIDDEN', 'got', e);

  PERFORM pg_temp.act(own);
  r := public.admin_integrations('global', NULL);
  out := out || jsonb_build_object('t','owner sees the catalog with Cloudflare', 'ok', r->'catalog' ? 'cloudflare' AND jsonb_array_length(r->'items') = 0, 'got', r->'catalog'->'cloudflare'->'secrets');
  e := pg_temp.err($$SELECT public.admin_integration_save('cloudflare','site','00000000-0000-0000-0000-000000000001','{}'::jsonb)$$);
  out := out || jsonb_build_object('t','Cloudflare can only be set for the System', 'ok', e LIKE 'SCOPE_NOT_ALLOWED%', 'got', e);
  e := pg_temp.err($$SELECT public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"not-hex"}'::jsonb)$$);
  out := out || jsonb_build_object('t','invalid account id is refused in plain words', 'ok', e = 'INVALID: Account ID', 'got', e);
  e := pg_temp.err($$SELECT public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb)$$);
  out := out || jsonb_build_object('t','an enabled account needs its token', 'ok', e = 'REQUIRED: API token', 'got', e);
  e := pg_temp.err($$SELECT public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb,'{"password":"x"}'::jsonb)$$);
  out := out || jsonb_build_object('t','unknown secret names are refused', 'ok', e = 'UNKNOWN_SECRET: password', 'got', e);
  e := pg_temp.err($$SELECT public.admin_integration_save('nope','global',NULL,'{}'::jsonb)$$);
  out := out || jsonb_build_object('t','unknown providers are refused', 'ok', e = 'UNKNOWN_PROVIDER', 'got', e);

  r := public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef","junk":"x"}'::jsonb,
                                     jsonb_build_object('api_token', secret));
  out := out || jsonb_build_object('t','save returns only a hint of the secret', 'ok',
    r->'secrets'->'api_token'->>'hint' = '••••1234' AND position(secret IN r::text) = 0 AND r->'config' = '{"account_id":"0123456789abcdef0123456789abcdef","worker_service":"aviatorv2"}'::jsonb, 'got', r);
  vid := (SELECT (secrets->'api_token'->>'vault_id')::uuid FROM integrations WHERE provider = 'cloudflare' AND scope_kind = 'global');
  out := out || jsonb_build_object('t','the secret is stored in Vault, not in the table', 'ok',
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = vid) = secret
    AND position(secret IN (SELECT i2::text FROM integrations i2 WHERE provider = 'cloudflare')) = 0);
  r := public.admin_integrations('global', NULL);
  out := out || jsonb_build_object('t','reading integrations never returns the secret', 'ok', position(secret IN r::text) = 0 AND r->'items'->0->'secrets'->'api_token'->>'set' = 'true', 'got', r->'items');
  out := out || jsonb_build_object('t','the audit row names what changed, never the value', 'ok',
    EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'integration_save' AND admin_id = own AND details->'changed' ? 'api_token set' AND position(secret IN details::text) = 0));

  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb, '{"api_token":""}'::jsonb);
  out := out || jsonb_build_object('t','an empty secret field keeps the stored value', 'ok', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = vid) = secret);
  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb, '{"api_token":"rotated-token-value-5678"}'::jsonb);
  vid2 := (SELECT (secrets->'api_token'->>'vault_id')::uuid FROM integrations WHERE provider = 'cloudflare' AND scope_kind = 'global');
  out := out || jsonb_build_object('t','rotating updates the same Vault secret', 'ok', vid2 = vid AND (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = vid) = 'rotated-token-value-5678');
  UPDATE integrations SET test_ok = true, test_message = 'fine', tested_at = now() WHERE provider = 'cloudflare';
  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb, '{"api_token":"rotated-again-value-9012"}'::jsonb);
  out := out || jsonb_build_object('t','a changed account is marked untested', 'ok', (SELECT test_ok IS NULL FROM integrations WHERE provider = 'cloudflare'));
  e := pg_temp.err($$SELECT public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb,'{"api_token":null}'::jsonb)$$);
  out := out || jsonb_build_object('t','cannot clear a required secret of an enabled account', 'ok', e = 'REQUIRED: API token', 'got', e);

  -- resolution (service role)
  r := public.svc_integration_resolve('cloudflare', B);
  out := out || jsonb_build_object('t','service resolution returns the secret for the edge function', 'ok', r->'secrets'->>'api_token' = 'rotated-again-value-9012' AND r->>'scope_kind' = 'global');
  out := out || jsonb_build_object('t','browsers can never call the service resolvers', 'ok',
    NOT has_function_privilege('authenticated', 'public.svc_integration_resolve(text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.svc_integration_resolve(text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_domain_record(text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_cron_secret_ok(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.brand_domains_tick()', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.svc_integration_resolve(text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_domain_add(uuid, text, boolean, boolean)', 'EXECUTE'));
  out := out || jsonb_build_object('t','no browser role can read the integrations table', 'ok',
    NOT has_table_privilege('authenticated', 'public.integrations', 'SELECT') AND NOT has_table_privilege('anon', 'public.integrations', 'SELECT'));

  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb,'{}'::jsonb, false);
  out := out || jsonb_build_object('t','a disabled account is not resolved', 'ok', public.svc_integration_resolve('cloudflare', B) IS NULL);
  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb,'{"api_token":null}'::jsonb, false);
  out := out || jsonb_build_object('t','clearing a secret deletes it from Vault', 'ok', NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = vid));
  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb, jsonb_build_object('api_token', secret));
  vid := (SELECT (secrets->'api_token'->>'vault_id')::uuid FROM integrations WHERE provider = 'cloudflare');
  PERFORM public.admin_integration_delete((SELECT id FROM integrations WHERE provider = 'cloudflare'));
  out := out || jsonb_build_object('t','deleting an account deletes its Vault secrets', 'ok', NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = vid) AND NOT EXISTS (SELECT 1 FROM integrations WHERE provider = 'cloudflare'));
  PERFORM public.admin_integration_save('cloudflare','global',NULL,'{"account_id":"0123456789abcdef0123456789abcdef"}'::jsonb, jsonb_build_object('api_token', secret));

  e := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'domains_cron_secret');
  out := out || jsonb_build_object('t','cron secret: right value accepted, wrong / empty / other names refused', 'ok',
    public.svc_cron_secret_ok('domains_cron_secret', e) AND NOT public.svc_cron_secret_ok('domains_cron_secret', e || 'x')
    AND NOT public.svc_cron_secret_ok('domains_cron_secret', '') AND NOT public.svc_cron_secret_ok('project_url', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')));

  -- ═════════ domains ═════════
  out := out || jsonb_build_object('t','hostnames are cleaned', 'ok',
    public._domain_normalize(' https://WWW.Lucky-E2E.co.ke:443/path?q=1 ') = 'lucky-e2e.co.ke' AND public._domain_normalize('play.lucky-e2e.co.ke.') = 'play.lucky-e2e.co.ke',
    'got', public._domain_normalize(' https://WWW.Lucky-E2E.co.ke:443/path?q=1 '));
  out := out || jsonb_build_object('t','non-public hostnames are refused', 'ok',
    public._domain_normalize('1.2.3.4') IS NULL AND public._domain_normalize('app.workers.dev') IS NULL AND public._domain_normalize('nodot') IS NULL
    AND public._domain_normalize('a..b.com') IS NULL AND public._domain_normalize('-bad.com') IS NULL AND public._domain_normalize('x.localhost') IS NULL
    AND public._domain_normalize('') IS NULL AND public._domain_normalize(repeat('a', 64) || '.com') IS NULL);
  out := out || jsonb_build_object('t','registrable domain under second-level suffixes', 'ok',
    public._domain_apex('a.b.lucky.co.ke') = 'lucky.co.ke' AND public._domain_apex('play.lucky.com') = 'lucky.com' AND public._domain_apex('lucky.ke') = 'lucky.ke');

  PERFORM pg_temp.act(pa1);
  r := public.admin_domain_add(B, 'https://www.lucky-e2e.co.ke/', true);
  out := out || jsonb_build_object('t','platform admin adds a domain to its brand: first one is primary, queued', 'ok',
    r->>'hostname' = 'lucky-e2e.co.ke' AND (r->>'is_primary')::boolean AND r->>'stage' = 'queued' AND r->>'status' = 'pending' AND r->>'apex' = 'lucky-e2e.co.ke' AND (r->>'include_www')::boolean, 'got', r);
  out := out || jsonb_build_object('t','the brand''s primary_domain follows', 'ok', (SELECT primary_domain FROM sites WHERE id = B) = 'lucky-e2e.co.ke');
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'other-e2e.com')$$, C));
  out := out || jsonb_build_object('t','platform admin cannot add to another platform''s brand', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'lucky-e2e.co.ke')$$, B));
  out := out || jsonb_build_object('t','the same domain twice is refused, naming the brand in scope', 'ok', e LIKE 'DOMAIN_TAKEN: lucky-e2e.co.ke is already connected to Dom Brand B', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'not a domain')$$, B));
  out := out || jsonb_build_object('t','garbage is refused in plain words', 'ok', e LIKE 'INVALID_DOMAIN:%', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'hand-e2e.com', true, false)$$, B));
  out := out || jsonb_build_object('t','only the owner records a hand-connected domain', 'ok', e = 'FORBIDDEN', 'got', e);
  r := public.admin_domain_add(B, 'play.lucky-e2e.co.ke', true);
  out := out || jsonb_build_object('t','a subdomain never gets www', 'ok', NOT (r->>'include_www')::boolean AND NOT (r->>'is_primary')::boolean AND r->>'apex' = 'lucky-e2e.co.ke', 'got', r);

  PERFORM pg_temp.act(pa2);
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'shop.lucky-e2e.co.ke')$$, C));
  out := out || jsonb_build_object('t','another platform cannot take a subdomain of our domain (same Cloudflare zone)', 'ok',
    e LIKE 'DOMAIN_TAKEN: lucky-e2e.co.ke belongs to another brand%' AND position('Dom Brand B' IN e) = 0, 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'lucky-e2e.co.ke')$$, C));
  out := out || jsonb_build_object('t','…and never learns which brand has it', 'ok', e LIKE '%already connected to another brand' AND position('Dom Brand B' IN e) = 0, 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_authorize('lucky-e2e.co.ke')$$);
  out := out || jsonb_build_object('t','…nor check, replace or remove it', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_remove('lucky-e2e.co.ke')$$);
  out := out || jsonb_build_object('t','…nor delete it directly', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_domains(%L)$$, B));
  out := out || jsonb_build_object('t','…nor list it', 'ok', e = 'FORBIDDEN', 'got', e);

  PERFORM pg_temp.act(sb);
  r := public.admin_domains(B);
  out := out || jsonb_build_object('t','brand owner sees its domains, read-only', 'ok', jsonb_array_length(r->'domains') = 2 AND NOT (r->>'can_manage')::boolean, 'got', r->'can_manage');
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'owner-e2e.com')$$, B));
  out := out || jsonb_build_object('t','brand owner cannot add a domain', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_update('lucky-e2e.co.ke', '{"www_redirect":false}'::jsonb)$$);
  out := out || jsonb_build_object('t','brand owner cannot change domain options', 'ok', e = 'FORBIDDEN', 'got', e);
  PERFORM pg_temp.act(ab);
  e := pg_temp.err(format($$SELECT public.admin_domains(%L)$$, B));
  out := out || jsonb_build_object('t','brand staff do not see domains', 'ok', e = 'FORBIDDEN', 'got', e);

  -- primary, redirects, the public resolver
  PERFORM pg_temp.act(own);
  r := public.admin_domain_add(B, 'lucky-e2e2.com', true);
  e := pg_temp.err($$SELECT public.admin_domain_update('lucky-e2e.co.ke', '{"is_primary":false}'::jsonb)$$);
  out := out || jsonb_build_object('t','cannot un-primary without choosing another', 'ok', e LIKE 'PRIMARY_REQUIRED%', 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_update('lucky-e2e.co.ke', '{"redirect_to_primary":true}'::jsonb)$$);
  out := out || jsonb_build_object('t','the primary cannot redirect to itself', 'ok', e LIKE 'PRIMARY_REDIRECT%', 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_update('lucky-e2e.co.ke', '{"stage":"live"}'::jsonb)$$);
  out := out || jsonb_build_object('t','console cannot set the provisioning state', 'ok', e = 'UNKNOWN_FIELD: stage', 'got', e);
  e := pg_temp.err($$SELECT public.admin_domain_update('lucky-e2e.co.ke', '{"www_redirect":"yes"}'::jsonb)$$);
  out := out || jsonb_build_object('t','options must be true/false', 'ok', e = 'INVALID: www_redirect', 'got', e);
  r := public.admin_domain_update('lucky-e2e2.com', '{"is_primary":true}'::jsonb);
  out := out || jsonb_build_object('t','switching the primary moves primary_domain', 'ok',
    (r->>'is_primary')::boolean AND (SELECT count(*) FROM site_domains WHERE site_id = B AND is_primary) = 1 AND (SELECT primary_domain FROM sites WHERE id = B) = 'lucky-e2e2.com');

  r := public.public_site_by_host('www.lucky-e2e.co.ke:443', NULL);
  out := out || jsonb_build_object('t','www resolves to the brand and redirects to its apex', 'ok',
    (r->>'site_id')::uuid = B AND r->>'matched' = 'domain' AND r->'host'->>'redirect_to' = 'lucky-e2e.co.ke', 'got', r->'host');
  r := public.public_site_by_host('lucky-e2e.co.ke', NULL);
  out := out || jsonb_build_object('t','a secondary domain is served as-is by default', 'ok', (r->>'site_id')::uuid = B AND r->'host'->>'redirect_to' IS NULL, 'got', r->'host');
  PERFORM public.admin_domain_update('lucky-e2e.co.ke', '{"redirect_to_primary":true}'::jsonb);
  out := out || jsonb_build_object('t','…or sent to the primary when asked (www too)', 'ok',
    public.public_site_by_host('lucky-e2e.co.ke', NULL)->'host'->>'redirect_to' = 'lucky-e2e2.com'
    AND public.public_site_by_host('www.lucky-e2e.co.ke', NULL)->'host'->>'redirect_to' = 'lucky-e2e2.com');
  out := out || jsonb_build_object('t','the primary itself never redirects', 'ok', public.public_site_by_host('lucky-e2e2.com', NULL)->'host'->>'redirect_to' IS NULL);
  PERFORM public.admin_domain_update('lucky-e2e2.com', '{"www_redirect":false}'::jsonb);
  out := out || jsonb_build_object('t','www can be served instead of redirected', 'ok',
    public.public_site_by_host('www.lucky-e2e2.com', NULL)->'host'->>'redirect_to' IS NULL AND (public.public_site_by_host('www.lucky-e2e2.com', NULL)->>'site_id')::uuid = B);
  PERFORM public.admin_domain_update('lucky-e2e2.com', '{"include_www":false}'::jsonb);
  r := public.public_site_by_host('www.lucky-e2e2.com', NULL);
  out := out || jsonb_build_object('t','without www, www.<domain> is not this brand', 'ok', (r->>'site_id')::uuid = A AND r->>'matched' = 'default', 'got', r->>'matched');
  out := out || jsonb_build_object('t','the public payload never carries provisioning internals', 'ok',
    NOT (public.public_site_by_host('lucky-e2e2.com', NULL)::text ~ '(zone_id|worker_domains|nameservers|last_error)'));
  out := out || jsonb_build_object('t','unknown host → the default brand, no host block', 'ok',
    (public.public_site_by_host('nobody-e2e.com', NULL)->>'site_id')::uuid = A AND public.public_site_by_host('nobody-e2e.com', NULL)->'host' = 'null'::jsonb);

  -- provisioning bookkeeping (service role)
  r := public.svc_domain_record('play.lucky-e2e.co.ke', '{"stage":"nameservers","zone_id":"z1","zone_status":"pending","nameservers":["ana.ns.cloudflare.com","bob.ns.cloudflare.com"],"ns_current":["dns1.registrar-servers.com"]}'::jsonb);
  out := out || jsonb_build_object('t','recording a step stores what Cloudflare said and backs off', 'ok',
    r->>'stage' = 'nameservers' AND r->>'status' = 'pending' AND r->'nameservers' = '["ana.ns.cloudflare.com","bob.ns.cloudflare.com"]'::jsonb
    AND (r->>'attempts')::int = 1 AND (r->>'next_check_at')::timestamptz > now() + interval '1 minute', 'got', r);
  FOR i IN 1..7 LOOP r := public.svc_domain_record('play.lucky-e2e.co.ke', '{}'::jsonb); END LOOP;
  out := out || jsonb_build_object('t','backoff is capped at an hour', 'ok', (r->>'next_check_at')::timestamptz <= now() + interval '60 minutes 1 second', 'got', r->>'next_check_at');
  r := public.svc_domain_record('play.lucky-e2e.co.ke', '{"stage":"ssl","next_check_seconds":120}'::jsonb);
  out := out || jsonb_build_object('t','an explicit next check is honoured', 'ok', (r->>'next_check_at')::timestamptz BETWEEN now() + interval '119 seconds' AND now() + interval '121 seconds');
  r := public.svc_domain_record('play.lucky-e2e.co.ke', '{"stage":"live","https_ok":true,"worker_domains":{"play.lucky-e2e.co.ke":"wd1"},"last_error":null}'::jsonb);
  out := out || jsonb_build_object('t','live → active, activated, re-verified in 6 hours, attempts reset', 'ok',
    r->>'status' = 'active' AND r->>'activated_at' IS NOT NULL AND (r->>'attempts')::int = 0 AND r->>'last_error' IS NULL
    AND (r->>'next_check_at')::timestamptz > now() + interval '5 hours', 'got', r);
  r := public.svc_domain_record('play.lucky-e2e.co.ke', '{"stage":"error","last_error":"boom"}'::jsonb);
  out := out || jsonb_build_object('t','error → status error with the reason', 'ok', r->>'status' = 'error' AND r->>'last_error' = 'boom');
  out := out || jsonb_build_object('t','unknown hostname records nothing', 'ok', public.svc_domain_record('nobody-e2e.com', '{"stage":"live"}'::jsonb) IS NULL);
  e := pg_temp.err($$SELECT public.svc_domain_record('play.lucky-e2e.co.ke', '{"stage":"hacked"}'::jsonb)$$);
  out := out || jsonb_build_object('t','only known stages', 'ok', e LIKE '%site_domains_stage_check%', 'got', e);
  n := (SELECT count(*) FROM public.svc_domains_due(100) x WHERE x->>'hostname' IN ('lucky-e2e.co.ke','lucky-e2e2.com'));
  out := out || jsonb_build_object('t','queued domains are due for the sweep', 'ok', n = 2, 'got', n);

  r := public.admin_domain_add(B, 'hand-e2e.com', true, false);
  out := out || jsonb_build_object('t','owner records a hand-connected domain: live, never swept', 'ok',
    r->>'stage' = 'live' AND NOT (r->>'managed')::boolean AND NOT EXISTS (SELECT 1 FROM public.svc_domains_due(100) x WHERE x->>'hostname' = 'hand-e2e.com'), 'got', r);

  -- www re-attach after enabling it on a live domain
  PERFORM public.svc_domain_record('lucky-e2e2.com', '{"stage":"live"}'::jsonb);
  r := public.admin_domain_update('lucky-e2e2.com', '{"include_www":true}'::jsonb);
  out := out || jsonb_build_object('t','turning www on sends a live domain back to attach it now', 'ok', r->>'stage' = 'attaching' AND (r->>'next_check_at')::timestamptz <= now());

  -- removal
  PERFORM public.admin_domain_remove('lucky-e2e2.com');
  out := out || jsonb_build_object('t','removing the primary promotes another domain', 'ok',
    (SELECT count(*) FROM site_domains WHERE site_id = B AND is_primary) = 1 AND (SELECT primary_domain FROM sites WHERE id = B) IS NOT NULL
    AND (SELECT primary_domain FROM sites WHERE id = B) <> 'lucky-e2e2.com');
  out := out || jsonb_build_object('t','adds, changes and removals are audited on the brand', 'ok',
    (SELECT count(DISTINCT action) FROM admin_audit_log WHERE site_id = B AND action IN ('domain_add','domain_update','domain_remove')) = 3);

  FOR i IN 1..7 LOOP PERFORM public.admin_domain_add(B, 'many' || i || '-e2e.com'); END LOOP;
  e := pg_temp.err(format($$SELECT public.admin_domain_add(%L, 'toomany-e2e.com')$$, B));
  out := out || jsonb_build_object('t','a brand has at most 10 domains', 'ok', e LIKE 'TOO_MANY_DOMAINS%', 'got', e);

  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

status, body = run("BEGIN;\nSET LOCAL lock_timeout = '15s';\n" + TESTS)
try:
    msg = json.loads(body).get("message", body)
except Exception:
    msg = body
m = re.search(r"E2E_RESULT (\[.*\])", msg, re.S)
if not m:
    print("did not reach the result block:", status, msg[:3000]); sys.exit(2)
results = json.JSONDecoder().raw_decode(m.group(1))[0]
bad = 0
for r in results:
    ok = r.get("ok") is True
    bad += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'), ensure_ascii=False)[:600]}"))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
