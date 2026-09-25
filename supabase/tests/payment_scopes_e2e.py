#!/usr/bin/env python3
"""E2E for payment scopes (migration 20260930096000; invest254 docs/43 PAY-1) — the real schema,
one transaction, everything rolled back.

Platforms P1 (brands B, D) and P2 (brand C); the default brand A. Checks who may configure which
Mega Pay account, owner-only fields, go-live requirements, the payment-owner order (brand → platform
→ System), that a deposit records the account it is paid into, that a live owner's missing account
closes deposits instead of falling back to the System's (no mixing), and grants.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/payment_scopes_e2e.py
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
  A uuid := '00000000-0000-0000-0000-000000000001'; B uuid; C uuid; D uuid; P1 uuid; P2 uuid;
  own uuid := public._root_super_admin();
  pa1 uuid := gen_random_uuid(); pa2 uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); ab uuid := gen_random_uuid(); fb uuid := gen_random_uuid();
  plb uuid := gen_random_uuid(); pld uuid := gen_random_uuid(); pla uuid := gen_random_uuid();
  r jsonb; e text; accB uuid; accP uuid; key text := 'mp-e2e-KEY-secret-value-4321';
BEGIN
  DELETE FROM integrations WHERE provider = 'megapay';              -- start clean (rolled back)
  DELETE FROM payment_scopes;
  INSERT INTO platforms(slug, name) VALUES ('e2e-pay-p1', 'Pay One') RETURNING id INTO P1;
  INSERT INTO platforms(slug, name) VALUES ('e2e-pay-p2', 'Pay Two') RETURNING id INTO P2;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-pay-b', 'Pay Brand B', 'active', P1) RETURNING id INTO B;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-pay-d', 'Pay Brand D', 'active', P1) RETURNING id INTO D;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-pay-c', 'Pay Brand C', 'active', P2) RETURNING id INTO C;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pay-' || k || '@example.invalid',
         jsonb_build_object('username', 'pay' || k, 'phone', '2547350000' || lpad(v.n::text, 2, '0'), 'site_slug', s), now(), now()
    FROM (VALUES (pa1,'pa1',1,NULL),(pa2,'pa2',2,NULL),(sb,'sb',3,'e2e-pay-b'),(ab,'ab',4,'e2e-pay-b'),(fb,'fb',5,'e2e-pay-b'),
                 (plb,'plb',6,'e2e-pay-b'),(pld,'pld',7,'e2e-pay-d'),(pla,'pla',8,NULL)) v(u,k,n,s);
  UPDATE profiles SET role = 'platform_admin', platform_id = P1 WHERE id = pa1;
  UPDATE profiles SET role = 'platform_admin', platform_id = P2 WHERE id = pa2;
  UPDATE profiles SET site_id = B WHERE id IN (sb, ab, fb);
  UPDATE profiles SET role = 'super_admin' WHERE id = sb;
  UPDATE profiles SET role = 'admin' WHERE id = ab;
  UPDATE profiles SET role = 'finance_admin' WHERE id = fb;
  out := out || jsonb_build_object('t','fixture players land on their brands', 'ok',
    (SELECT site_id FROM profiles WHERE id = plb) = B AND (SELECT site_id FROM profiles WHERE id = pld) = D AND (SELECT site_id FROM profiles WHERE id = pla) = A,
    'got', (SELECT jsonb_agg(site_id) FROM profiles WHERE id IN (plb, pld, pla)));

  -- ═════════ who may configure what ═════════
  PERFORM pg_temp.act(pa1);
  r := public.admin_integrations('site', B);
  out := out || jsonb_build_object('t','Mega Pay is offered for a brand', 'ok', r->'catalog' ? 'megapay' AND NOT (r->'catalog' ? 'cloudflare'), 'got', r->'catalog');
  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','site',%L,'{"email":"b@pay.example","env":"sandbox"}'::jsonb,'{"api_key":"k-123456789012"}'::jsonb)$$, B));
  out := out || jsonb_build_object('t','a platform admin cannot choose the sandbox', 'ok', e = 'OWNER_ONLY_FIELD: Environment', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','site',%L,'{"email":"b@pay.example","base_url":"https://evil.example/api"}'::jsonb,'{"api_key":"k-123456789012"}'::jsonb)$$, B));
  out := out || jsonb_build_object('t','…nor point status checks at another server', 'ok', e = 'OWNER_ONLY_FIELD: API address', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','site',%L,'{"email":"c@pay.example"}'::jsonb,'{"api_key":"k-123456789012"}'::jsonb)$$, C));
  out := out || jsonb_build_object('t','…nor configure another platform''s brand', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','platform',%L,'{"email":"c@pay.example"}'::jsonb,'{"api_key":"k-123456789012"}'::jsonb)$$, P2));
  out := out || jsonb_build_object('t','…nor another platform', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err($$SELECT public.admin_integration_save('megapay','global',NULL,'{"email":"x@pay.example"}'::jsonb,'{"api_key":"k-123456789012"}'::jsonb)$$);
  out := out || jsonb_build_object('t','…nor the System''s account', 'ok', e = 'FORBIDDEN', 'got', e);
  r := public.admin_integration_save('megapay','site',B,'{"email":"b@pay.example"}'::jsonb, jsonb_build_object('api_key', key));
  accB := (r->>'id')::uuid;
  out := out || jsonb_build_object('t','a platform admin saves its brand''s account (production by default, key hidden)', 'ok',
    r->'config'->>'env' = 'production' AND position(key IN r::text) = 0 AND r->'secrets'->'api_key'->>'hint' = '••••4321', 'got', r);

  PERFORM pg_temp.act(sb);
  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','site',%L,'{"email":"b2@pay.example"}'::jsonb)$$, B));
  out := out || jsonb_build_object('t','a brand owner cannot change where its money goes', 'ok', e = 'FORBIDDEN', 'got', e);
  r := public.admin_payment_overview('site', B);
  out := out || jsonb_build_object('t','…but sees whose account it is, without secrets', 'ok',
    r->'owner'->>'kind' = 'global' AND NOT (r->>'can_manage')::boolean AND position(key IN r::text) = 0 AND r->'account'->>'email_hint' = 'b•••@pay.example', 'got', r);
  PERFORM pg_temp.act(fb);
  out := out || jsonb_build_object('t','finance staff also see it', 'ok', pg_temp.err(format($$SELECT public.admin_payment_overview('site', %L)$$, B)) = 'ok');
  PERFORM pg_temp.act(ab);
  e := pg_temp.err(format($$SELECT public.admin_payment_overview('site', %L)$$, B));
  out := out || jsonb_build_object('t','other brand staff do not', 'ok', e = 'FORBIDDEN', 'got', e);
  PERFORM pg_temp.act(pa2);
  e := pg_temp.err(format($$SELECT public.admin_payment_overview('site', %L)$$, B));
  out := out || jsonb_build_object('t','another platform''s admin does not', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_payment_scope_set('site', %L, true)$$, B));
  out := out || jsonb_build_object('t','…and cannot switch it live', 'ok', e = 'FORBIDDEN', 'got', e);

  -- ═════════ go-live requirements ═════════
  PERFORM pg_temp.act(pa1);
  out := out || jsonb_build_object('t','before go-live the brand uses the System''s account', 'ok',
    public.fn_payment_owner(B)->>'kind' = 'global' AND public._payment_gateway_ready(B));
  e := pg_temp.err(format($$SELECT public.admin_payment_scope_set('site', %L, true)$$, D));
  out := out || jsonb_build_object('t','go-live needs a saved account', 'ok', e LIKE 'GATEWAY_INCOMPLETE%', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_payment_scope_set('site', %L, true)$$, B));
  out := out || jsonb_build_object('t','go-live needs a passed connection test', 'ok', e LIKE 'GATEWAY_UNTESTED%', 'got', e);
  PERFORM public.svc_integration_record_test(accB, false, 'Mega Pay rejected the API key.');
  e := pg_temp.err(format($$SELECT public.admin_payment_scope_set('site', %L, true)$$, B));
  out := out || jsonb_build_object('t','a failed test does not count', 'ok', e LIKE 'GATEWAY_UNTESTED%', 'got', e);
  PERFORM pg_temp.act(own);
  PERFORM public.admin_integration_save('megapay','site',B,'{"email":"b@pay.example","env":"sandbox"}'::jsonb, '{}'::jsonb);
  out := out || jsonb_build_object('t','the owner may choose the sandbox; the change resets the test', 'ok', (SELECT test_ok IS NULL AND config->>'env' = 'sandbox' FROM integrations WHERE id = accB));
  PERFORM public.svc_integration_record_test(accB, true, 'ok');
  e := pg_temp.err(format($$SELECT public.admin_payment_scope_set('site', %L, true)$$, B));
  out := out || jsonb_build_object('t','a sandbox account cannot go live', 'ok', e LIKE 'GATEWAY_SANDBOX%', 'got', e);
  PERFORM public.admin_integration_save('megapay','site',B,'{"email":"b@pay.example","env":"production"}'::jsonb, '{}'::jsonb);
  PERFORM public.svc_integration_record_test(accB, true, 'Mega Pay accepted the API key and email.');
  PERFORM pg_temp.act(pa1);
  r := public.admin_payment_scope_set('site', B, true);
  out := out || jsonb_build_object('t','a tested production account goes live', 'ok', (r->>'active')::boolean AND r->'owner'->>'kind' = 'site' AND (r->>'ready')::boolean, 'got', r);
  out := out || jsonb_build_object('t','going live is audited', 'ok', EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'payment_scope_live' AND admin_id = pa1 AND site_id = B));
  out := out || jsonb_build_object('t','the sibling brand still uses the System (platform not live)', 'ok', public.fn_payment_owner(D)->>'kind' = 'global');

  e := pg_temp.err(format($$SELECT public.admin_integration_save('megapay','site',%L,'{"email":"b@pay.example"}'::jsonb,'{}'::jsonb,false)$$, B));
  out := out || jsonb_build_object('t','a live account cannot be switched off', 'ok', e LIKE 'SCOPE_LIVE%', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_integration_delete(%L)$$, accB));
  out := out || jsonb_build_object('t','…or deleted', 'ok', e LIKE 'SCOPE_LIVE%', 'got', e);

  -- platform account for P1
  r := public.admin_integration_save('megapay','platform',P1,'{"email":"p1@pay.example"}'::jsonb,'{"api_key":"p1-key-value-000000"}'::jsonb);
  accP := (r->>'id')::uuid;
  PERFORM public.svc_integration_record_test(accP, true, 'ok');
  r := public.admin_payment_scope_set('platform', P1, true);
  out := out || jsonb_build_object('t','platform account live: its brands use it, a brand''s own live account wins', 'ok',
    public.fn_payment_owner(D)->>'kind' = 'platform' AND public.fn_payment_owner(B)->>'kind' = 'site' AND public.fn_payment_owner(C)->>'kind' = 'global' AND public.fn_payment_owner(A)->>'kind' = 'global');
  out := out || jsonb_build_object('t','the platform overview lists each brand''s payment owner', 'ok',
    jsonb_array_length(r->'brands') = 2 AND (SELECT count(*) FROM jsonb_array_elements(r->'brands') x WHERE x->'owner'->>'kind' IN ('site','platform')) = 2, 'got', r->'brands');

  -- ═════════ deposits record their account ═════════
  r := public.fn_megapay_begin(plb, '254712000001', 500);
  out := out || jsonb_build_object('t','a deposit on brand B is paid into B''s account', 'ok',
    r->>'payment_scope' = 'site:' || B AND (r->>'integration_id')::uuid = accB
    AND (SELECT payment_scope = 'site:' || B AND integration_id = accB FROM mpesa_stk_requests WHERE id = (r->>'id')::uuid), 'got', r);
  r := public.fn_megapay_begin(pld, '254712000002', 500);
  out := out || jsonb_build_object('t','a deposit on brand D is paid into the platform''s account', 'ok', r->>'payment_scope' = 'platform:' || P1 AND (r->>'integration_id')::uuid = accP, 'got', r);
  r := public.fn_megapay_begin(pla, '254712000003', 500);
  out := out || jsonb_build_object('t','a deposit on the System''s brand uses the System (server settings)', 'ok', r->>'payment_scope' = 'global' AND r->>'integration_id' IS NULL, 'got', r);
  out := out || jsonb_build_object('t','the sweep sees each deposit''s account', 'ok',
    (SELECT count(*) FROM information_schema.routines WHERE routine_name = 'fn_megapay_due') = 1
    AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_megapay_due' AND pg_get_function_result(oid) LIKE '%integration_id uuid%'));

  -- verification keeps using the initiating account after it is switched off
  PERFORM public.admin_payment_scope_set('site', B, false);
  PERFORM public.admin_integration_save('megapay','site',B,'{"email":"b@pay.example"}'::jsonb,'{}'::jsonb,false);
  r := public.svc_integration_by_id(accB);
  out := out || jsonb_build_object('t','a switched-off account can still verify its deposits (service role)', 'ok', r->'secrets'->>'api_key' = key AND NOT (r->>'enabled')::boolean);
  out := out || jsonb_build_object('t','after B stops, new deposits follow the next owner (its platform)', 'ok',
    public.fn_payment_owner(B)->>'kind' = 'platform' AND public.fn_megapay_begin(plb, '254712000004', 500)->>'payment_scope' = 'platform:' || P1);
  out := out || jsonb_build_object('t','stopping is audited', 'ok', EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'payment_scope_off' AND site_id = B));

  -- no mixing: a live owner whose account vanished closes deposits instead of using the System's
  DELETE FROM integrations WHERE id = accP;                          -- (bypassing the SCOPE_LIVE guard)
  out := out || jsonb_build_object('t','no fallback: a live platform without its account closes deposits', 'ok',
    NOT public._payment_gateway_ready(D) AND pg_temp.err(format($$SELECT public.fn_megapay_begin(%L, '254712000005', 500)$$, pld)) = 'GATEWAY_NOT_CONFIGURED');
  PERFORM pg_temp.act(pld);
  out := out || jsonb_build_object('t','…and the player''s wallet says deposits are off', 'ok', (public.fn_public_payment_config(NULL)->>'deposits')::boolean IS FALSE);
  PERFORM pg_temp.act(pla);
  out := out || jsonb_build_object('t','…while the System''s brands are unaffected', 'ok', (public.fn_public_payment_config(NULL)->>'deposits')::boolean IS TRUE);

  -- ═════════ System view + grants ═════════
  PERFORM pg_temp.act(own);
  r := public.admin_payment_overview('global', NULL);
  out := out || jsonb_build_object('t','the owner sees which scopes are live', 'ok', jsonb_array_length(r->'live_scopes') = 1 AND r->'live_scopes'->0->>'kind' = 'platform', 'got', r->'live_scopes');
  PERFORM pg_temp.act(pa1);
  e := pg_temp.err($$SELECT public.admin_payment_overview('global', NULL)$$);
  out := out || jsonb_build_object('t','a platform admin cannot see the System view', 'ok', e = 'FORBIDDEN', 'got', e);
  out := out || jsonb_build_object('t','staff scope for the edge functions', 'ok',
    public.svc_staff_can_site(pa1, B) AND NOT public.svc_staff_can_site(pa1, C) AND public.svc_staff_can_site(ab, B) AND NOT public.svc_staff_can_site(ab, A)
    AND public.svc_staff_can_site(own, C) AND NOT public.svc_staff_can_site(plb, B) AND NOT public.svc_staff_can_site(pa1, NULL));
  out := out || jsonb_build_object('t','browsers cannot call the money internals', 'ok',
    NOT has_function_privilege('authenticated', 'public.svc_integration_by_id(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_integration_at(text, text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_megapay_begin(uuid, text, numeric)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_payment_owner(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_staff_can_site(uuid, uuid)', 'EXECUTE')
    AND NOT has_table_privilege('authenticated', 'public.payment_scopes', 'SELECT')
    AND has_function_privilege('authenticated', 'public.admin_payment_overview(text, uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.svc_integration_by_id(uuid)', 'EXECUTE'));

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
