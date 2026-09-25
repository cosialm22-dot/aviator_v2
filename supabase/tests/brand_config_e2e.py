#!/usr/bin/env python3
"""E2E for the multi-brand foundation (migrations 20260930090000/091000/092000) — the real schema,
one transaction, everything rolled back.

Builds two platforms and three brands (A = default, B under platform P1, C under platform P2) with a
platform admin, brand staff, players and a marketer, then checks — as each caller — the tier/scope
rules, the brand-config registry (validation, bounds, tiers, versions, rollback, diff, broadcast),
the public brand payload, and that the server enforces each brand's switches and limits.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/brand_config_e2e.py
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
  pa1 uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); ab uuid := gen_random_uuid(); supb uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); mb uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); ma uuid := gen_random_uuid();
  newu uuid := gen_random_uuid(); newu2 uuid := gen_random_uuid(); newu3 uuid := gen_random_uuid(); newu4 uuid := gen_random_uuid(); code text;
  r jsonb; e text; n int; v int; g numeric;
BEGIN
  -- ── fixtures ──
  INSERT INTO platforms(slug, name) VALUES ('e2e-p1', 'E2E One') RETURNING id INTO P1;
  INSERT INTO platforms(slug, name) VALUES ('e2e-p2', 'E2E Two') RETURNING id INTO P2;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-brand-b', 'Brand B', 'active', P1) RETURNING id INTO B;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-brand-c', 'Brand C', 'active', P2) RETURNING id INTO C;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brand-' || k || '@example.invalid',
         jsonb_build_object('username', 'brnd' || k, 'phone', '2547330000' || lpad(i::text, 2, '0')), now(), now()
    FROM (VALUES (pa1,'pa1',1),(sb,'sb',2),(ab,'ab',3),(supb,'supb',4),(pb,'pb',5),(mb,'mb',6),(pa,'pa',7),(ma,'ma',8)) v(u,k,i);
  UPDATE profiles SET site_id = B WHERE id IN (sb, ab, supb, pb, mb);
  UPDATE wallets SET site_id = B, real_balance = 100000 WHERE user_id IN (sb, ab, supb, pb, mb);
  UPDATE wallets SET real_balance = 100000 WHERE user_id = pa;
  UPDATE profiles SET role = 'platform_admin', platform_id = P1 WHERE id = pa1;
  UPDATE profiles SET role = 'super_admin' WHERE id = sb;
  UPDATE profiles SET role = 'admin' WHERE id = ab;
  UPDATE profiles SET role = 'support' WHERE id = supb;
  UPDATE profiles SET role = 'marketer' WHERE id IN (mb, ma);

  e := pg_temp.err(format('UPDATE profiles SET role = %L, platform_id = NULL WHERE id = %L', 'platform_admin', pb));
  out := out || jsonb_build_object('t','a platform admin must belong to a platform', 'ok', e LIKE '%profiles_platform_admin_has_platform%', 'got', e);

  -- ── scope ──
  PERFORM pg_temp.act(pa1);
  r := public.admin_my_sites();
  out := out || jsonb_build_object('t','platform admin picks only its platform''s brands', 'ok', jsonb_array_length(r) = 1 AND (r->0->>'id')::uuid = B, 'got', r);
  e := pg_temp.err('SELECT public._admin_scope(NULL)');
  out := out || jsonb_build_object('t','platform admin must name a brand before reading', 'ok', e = 'SITE_REQUIRED', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_acting_site(%L)', C));
  out := out || jsonb_build_object('t','platform admin cannot act on another platform''s brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM public.admin_set_acting_site(B);
  out := out || jsonb_build_object('t','acting brand drives current_site() and _staff_site()', 'ok', public.current_site() = B AND public._staff_site() = B AND public._admin_scope(NULL) = B);
  e := pg_temp.err(format('SELECT public._admin_scope(%L)', A));
  out := out || jsonb_build_object('t','platform admin cannot scope to the System''s brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  out := out || jsonb_build_object('t','_can_admin_site: platform admin in scope / out of scope', 'ok', public._can_admin_site(B) AND NOT public._can_admin_site(C) AND NOT public._can_admin_site(A));
  r := public.admin_whoami();
  out := out || jsonb_build_object('t','whoami reports tier, platform and acting brand', 'ok', r->>'role' = 'platform_admin' AND r->>'platform_name' = 'E2E One' AND (r->>'acting_site_id')::uuid = B, 'got', r);

  -- ── the shared engine is owner-only ──
  FOREACH e IN ARRAY ARRAY['SELECT public.admin_current_round()', 'SELECT public.admin_force_crash(NULL)', 'SELECT public.admin_recover_zombies(1)',
                           'SELECT public.admin_start_rain(100, 10, 60, NULL)', 'SELECT public.admin_queue_add(2.0)'] LOOP
    PERFORM pg_temp.act(pa1);
    out := out || jsonb_build_object('t','platform admin refused: ' || e, 'ok', pg_temp.err(e) IN ('NOT_AUTHORIZED','FORBIDDEN'), 'got', pg_temp.err(e));
    PERFORM pg_temp.act(sb);
    out := out || jsonb_build_object('t','brand owner refused: ' || e, 'ok', pg_temp.err(e) IN ('NOT_AUTHORIZED','FORBIDDEN'), 'got', pg_temp.err(e));
  END LOOP;
  PERFORM pg_temp.act(supb);
  e := pg_temp.err('SELECT count(*) FROM crash_queue');
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM crash_queue;
  EXECUTE 'RESET ROLE';
  out := out || jsonb_build_object('t','brand support cannot read the crash queue (RLS)', 'ok', n = 0, 'got', n);
  PERFORM pg_temp.act(own);
  e := pg_temp.err('SELECT public.admin_current_round()');
  out := out || jsonb_build_object('t','the owner still sees the live round', 'ok', e = 'ok', 'got', e);

  -- ── cross-brand holes closed ──
  PERFORM pg_temp.act(ab);
  e := pg_temp.err(format('SELECT public.admin_adjust_balance_kind(%L, 10, %L, %L)', pa, 'real', 'e2e'));
  out := out || jsonb_build_object('t','brand admin cannot move money of another brand''s player', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  e := pg_temp.err(format('SELECT public.fn_marketer_ledger(%L, 5)', ma));
  out := out || jsonb_build_object('t','brand admin cannot read another brand''s marketer ledger', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err(format('SELECT public.fn_marketer_ledger(%L, 5)', mb));
  out := out || jsonb_build_object('t','brand admin reads its own marketer ledger', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_add_marketer_expense(%L, %L, 100, NULL)', ma, 'ads'));
  out := out || jsonb_build_object('t','brand admin cannot book expenses on another brand''s marketer', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  PERFORM pg_temp.act(sb);
  e := pg_temp.err('SELECT public.admin_upsert_notification_template(''e2e.x'', ''t'', ''b'', ''info'', ''general'', true, NULL, NULL, false, NULL)');
  out := out || jsonb_build_object('t','brand owner cannot edit the global notification templates', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err('SELECT public.admin_set_commission_rate(0.5)');
  out := out || jsonb_build_object('t','brand owner cannot change the global commission rate', 'ok', e = 'FORBIDDEN', 'got', e);

  -- ── roles ──
  PERFORM pg_temp.act(sb);
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', supb, 'finance_admin'));
  out := out || jsonb_build_object('t','brand owner assigns finance_admin', 'ok', e = 'ok' AND (SELECT role FROM profiles WHERE id = supb) = 'finance_admin', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', supb, 'support'));
  out := out || jsonb_build_object('t','brand owner assigns support', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', ab, 'super_admin'));
  out := out || jsonb_build_object('t','brand owner cannot create another brand owner', 'ok', e = 'SUPER_ADMIN_LOCKED', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', pa, 'admin'));
  out := out || jsonb_build_object('t','brand owner cannot touch another brand''s user', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  PERFORM pg_temp.act(pa1);
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', ab, 'support'));
  out := out || jsonb_build_object('t','platform admin sets roles in its brands', 'ok', e = 'ok', 'got', e);
  PERFORM public.admin_set_role(ab, 'admin');
  e := pg_temp.err(format('SELECT public.admin_set_role(%L, %L)', pa, 'support'));
  out := out || jsonb_build_object('t','platform admin cannot set roles on the System''s brand', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  e := pg_temp.err(format('SELECT public.platform_set_platform_admin(%L, %L)', pb, P1));
  out := out || jsonb_build_object('t','only the owner appoints platform admins', 'ok', e = 'FORBIDDEN', 'got', e);

  -- ── registry: schema + tiers ──
  PERFORM pg_temp.act(pa1);
  r := public.admin_brand_schema();
  out := out || jsonb_build_object('t','schema serves every setting with type, tier and bounds', 'ok',
    jsonb_array_length(r->'settings') >= 80 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r->'settings') s WHERE s->>'key' = 'limits.min_bet' AND s->>'tier' = 'platform' AND s->>'floor' = 'game.min_bet'), 'got', jsonb_array_length(r->'settings'));
  r := public.admin_brand_get(B);
  v := (r->>'version')::int;
  out := out || jsonb_build_object('t','platform admin reads its brand (effective values included)', 'ok', r->'effective'->>'limits.min_bet' IS NOT NULL AND (r->'can'->>'platform')::boolean, 'got', r->'can');
  e := pg_temp.err(format('SELECT public.admin_brand_get(%L)', C));
  out := out || jsonb_build_object('t','platform admin cannot read another platform''s brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  r := public.admin_brand_save(B, v, '{"name":"Brand Bee","wordmark_text":"bee.bet"}'::jsonb,
         '{"bg":"#0B0E11","surface":"#151A21","brand":"#F0B90B","accent":"#FCD535","accentFg":"#0B0F14","fontTitle":"Poppins","radius":"8px","headingWeight":"700"}'::jsonb,
         '{"plane.model":"jet","plane.body":"#F0B90B","stream.bird":"flamingo","support.whatsapp":"0712345678","copy.flew_away":"GONE!","limits.min_bet":100,"limits.bet_chips":[100,200,500,1000],"limits.default_bet":100}'::jsonb, 'e2e save');
  out := out || jsonb_build_object('t','platform admin saves identity, theme and settings in one version', 'ok', (r->>'version')::int = v + 1 AND (r->>'changed')::boolean, 'got', r);
  out := out || jsonb_build_object('t','diff lists every changed field', 'ok', r->'diff' ? 'config.plane.model' AND r->'diff' ? 'identity.name' AND r->'diff' ? 'theme_tokens.brand', 'got', r->'diff');
  out := out || jsonb_build_object('t','colours lower-cased, phone normalised to +254', 'ok',
    (SELECT config->>'support.whatsapp' FROM sites WHERE id = B) = '+254712345678' AND (SELECT theme_tokens->>'brand' FROM sites WHERE id = B) = '#f0b90b',
    'got', (SELECT config FROM sites WHERE id = B));
  out := out || jsonb_build_object('t','legacy columns follow (plane_skin = stream bird, color_primary = brand)', 'ok',
    (SELECT plane_skin FROM sites WHERE id = B) = 'flamingo' AND (SELECT color_primary FROM sites WHERE id = B) = '#f0b90b');
  out := out || jsonb_build_object('t','version snapshot + audit written', 'ok',
    EXISTS (SELECT 1 FROM site_config_versions WHERE site_id = B AND version = v + 1 AND note = 'e2e save')
    AND EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'brand_saved' AND site_id = B AND admin_id = pa1));
  out := out || jsonb_build_object('t','save broadcasts {site_id, version} on the config topic', 'ok',
    EXISTS (SELECT 1 FROM realtime.messages WHERE topic = 'config' AND event = 'brand' AND payload->>'site_id' = B::text AND (payload->>'version')::int = v + 1));
  r := public.admin_brand_save(B, v + 1, NULL, NULL, '{"copy.flew_away":"GONE!"}'::jsonb, NULL);
  out := out || jsonb_build_object('t','saving the same value is a no-op (no new version)', 'ok', (r->>'changed')::boolean = false AND (r->>'version')::int = v + 1, 'got', r);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, %s, NULL, NULL, %L, NULL)', B, v, '{"copy.tagline":"x"}'));
  out := out || jsonb_build_object('t','stale version refused (optimistic concurrency)', 'ok', e LIKE 'VERSION_CONFLICT%', 'got', e);

  -- validation
  FOREACH e IN ARRAY ARRAY[
    '{"plane.body":"red"}', '{"plane.model":"ufo"}', '{"seo.og_image":"http://x.com/a.png"}', '{"analytics.ga4":"UA-123"}',
    '{"limits.bet_chips":[100,"x"]}', '{"limits.bet_chips":[]}', '{"legal.min_age":16}', '{"features.chat":"maybe"}',
    '{"support.whatsapp":"12"}', '{"copy.flew_away":"THIS TEXT IS FAR TOO LONG FOR THE CANVAS"}', '{"nope.key":1}', '{"plane.scale":3}'] LOOP
    out := out || jsonb_build_object('t','rejected: ' || e, 'ok', pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, e)) ~ '^(INVALID_SETTING|UNKNOWN_SETTING)',
                                     'got', pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, e)));
  END LOOP;
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, %L, NULL, NULL)', B, '{"fontTitle":"Comic Sans"}'));
  out := out || jsonb_build_object('t','unsupported font rejected', 'ok', e LIKE 'INVALID_THEME%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, %L, NULL, NULL)', B, '{"hack":"#000000"}'));
  out := out || jsonb_build_object('t','unknown theme token rejected', 'ok', e LIKE 'INVALID_THEME%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"limits.min_bet":5000,"limits.max_bet":1000}'));
  out := out || jsonb_build_object('t','cross-field: minimum bet above maximum refused', 'ok', e LIKE 'INVALID_SETTING:limits.min_bet%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"limits.bet_chips":[10,100,200,500]}'));
  out := out || jsonb_build_object('t','cross-field: bet chip below the minimum bet refused', 'ok', e LIKE 'INVALID_SETTING:limits.bet_chips%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"plane.model":"custom"}'));
  out := out || jsonb_build_object('t','custom plane needs an uploaded image', 'ok', e LIKE 'INVALID_SETTING:plane.image_url%', 'got', e);
  g := (SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = 'game.max_bet');
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, jsonb_build_object('limits.max_bet', g + 1)));
  out := out || jsonb_build_object('t','platform admin cannot raise the maximum bet above the platform''s', 'ok', e LIKE '%the platform maximum is%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"limits.min_bet":1}'));
  out := out || jsonb_build_object('t','platform admin cannot lower the minimum bet below the platform''s', 'ok', e LIKE '%the platform minimum is%', 'got', e);
  PERFORM pg_temp.act(own);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, jsonb_build_object('limits.max_bet', g + 1)));
  out := out || jsonb_build_object('t','the owner may go beyond the platform bounds', 'ok', e = 'ok', 'got', e);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"limits.max_bet":null}'::jsonb, NULL);
  out := out || jsonb_build_object('t','null clears an override back to the platform value', 'ok', NOT (SELECT config ? 'limits.max_bet' FROM sites WHERE id = B)
    AND public._brand_num(B, 'limits.max_bet') = g, 'got', public._brand_num(B, 'limits.max_bet'));

  -- tiers inside a brand
  PERFORM pg_temp.act(sb);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"copy.tagline":"Fly high","legal.company":"Bee Ltd"}'));
  out := out || jsonb_build_object('t','brand owner edits brand-tier settings (copy, legal)', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"limits.min_bet":200}'));
  out := out || jsonb_build_object('t','brand owner cannot change limits', 'ok', e = 'NOT_AUTHORIZED:limits.min_bet', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, %L, NULL, NULL)', B, '{"brand":"#ff0000"}'));
  out := out || jsonb_build_object('t','brand owner cannot change the theme', 'ok', e = 'NOT_AUTHORIZED:theme', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, %L, NULL, NULL, NULL)', B, '{"status":"suspended"}'));
  out := out || jsonb_build_object('t','brand owner cannot suspend the brand', 'ok', e = 'NOT_AUTHORIZED:identity.status', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', A, '{"copy.tagline":"x"}'));
  out := out || jsonb_build_object('t','brand owner cannot edit another brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(ab);
  e := pg_temp.err(format('SELECT public.admin_brand_save(%L, NULL, NULL, NULL, %L, NULL)', B, '{"copy.tagline":"x"}'));
  out := out || jsonb_build_object('t','brand admin (not owner) cannot edit the brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  -- history + rollback
  PERFORM pg_temp.act(pa1);
  r := public.admin_brand_versions(B, 10);
  out := out || jsonb_build_object('t','history lists versions newest first with who changed what', 'ok', jsonb_array_length(r) >= 3 AND r->0->>'changed_by' = 'brndsb', 'got', r->0);
  r := public.admin_brand_rollback(B, v);
  out := out || jsonb_build_object('t','rollback restores the earlier version as a new version', 'ok',
    (SELECT name FROM sites WHERE id = B) = 'Brand B' AND NOT (SELECT config ? 'plane.model' FROM sites WHERE id = B)
    AND (SELECT config_version FROM sites WHERE id = B) = (r->>'version')::int, 'got', r);
  PERFORM public.admin_brand_rollback(B, v + 1);

  -- ── public payload ──
  INSERT INTO site_domains(hostname, site_id, is_primary, status) VALUES ('brand-b-e2e.com', B, true, 'active');
  out := out || jsonb_build_object('t','primary domain mirrored to sites.primary_domain', 'ok', (SELECT primary_domain FROM sites WHERE id = B) = 'brand-b-e2e.com');
  r := public.public_site_by_host('brand-b-e2e.com');
  out := out || jsonb_build_object('t','host resolves to its brand', 'ok', (r->>'site_id')::uuid = B AND r->>'matched' = 'domain', 'got', r->>'matched');
  r := public.public_site_by_host('WWW.brand-b-e2e.com:443');
  out := out || jsonb_build_object('t','www. (on an apex) and port are ignored', 'ok', (r->>'site_id')::uuid = B);
  r := public.public_site_by_host('unknown.example', 'e2e-brand-c');
  out := out || jsonb_build_object('t','?brand= previews an active brand on a shared host', 'ok', (r->>'site_id')::uuid = C AND r->>'matched' = 'preview');
  UPDATE sites SET status = 'disabled' WHERE id = C;
  r := public.public_site_by_host('unknown.example', 'e2e-brand-c');
  out := out || jsonb_build_object('t','a disabled brand cannot be previewed', 'ok', (r->>'site_id')::uuid = A);
  r := public.public_site_by_host('brand-b-e2e.com');
  out := out || jsonb_build_object('t','payload carries theme, plane, bird and public settings', 'ok',
    r->'config'->>'plane.model' = 'jet' AND r->'config'->>'stream.bird' = 'flamingo' AND r->'theme_tokens'->>'brand' = '#f0b90b' AND r->'config'->>'copy.flew_away' = 'GONE!', 'got', r->'config'->'plane.model');
  out := out || jsonb_build_object('t','payload never carries private settings', 'ok',
    NOT (r->'config' ? 'limits.auto_approve') AND NOT (r->'config' ? 'payments.stk_reference') AND NOT (r ? 'mpesa_shortcode') AND NOT (r ? 'notes') AND NOT (r ? 'owner_user_id'));
  out := out || jsonb_build_object('t','unset settings inherit the platform value', 'ok',
    (r->'config'->>'limits.max_deposit')::numeric = (SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = 'finance.max_deposit'));

  -- ── enforcement ──
  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"limits.min_bet":200,"limits.bet_chips":[200,300,500,1000],"limits.default_bet":200}'::jsonb, NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 100, NULL, 1::smallint)');
  out := out || jsonb_build_object('t','bet below the brand minimum refused', 'ok', e LIKE 'BET_OUT_OF_RANGE%[200,%', 'got', e);
  PERFORM pg_temp.act(pa);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 100, NULL, 1::smallint)');
  out := out || jsonb_build_object('t','the same stake is fine on the default brand', 'ok', e = 'ROUND_NOT_FOUND', 'got', e);
  r := public.fn_public_payment_config();
  out := out || jsonb_build_object('t','payment config follows the signed-in player''s brand (A)', 'ok', (r->>'site_id')::uuid = A);
  PERFORM pg_temp.act(pb);
  r := public.fn_public_payment_config();
  out := out || jsonb_build_object('t','payment config follows the signed-in player''s brand (B)', 'ok', (r->>'min_bet')::numeric = 200 AND r->'bet_chips' = '[200,300,500,1000]'::jsonb, 'got', r);
  PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  r := public.fn_public_payment_config(B);
  out := out || jsonb_build_object('t','signed-out config follows the page''s brand', 'ok', (r->>'site_id')::uuid = B AND (r->>'min_bet')::numeric = 200, 'got', r->'site_id');

  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.play":false,"features.two_bets":false}'::jsonb, NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 200, NULL, 1::smallint)');
  out := out || jsonb_build_object('t','real play off: player refused', 'ok', e = 'PLAY_DISABLED', 'got', e);
  PERFORM pg_temp.act(mb);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 200, NULL, 1::smallint)');
  out := out || jsonb_build_object('t','real play off: the marketer''s demo stream still plays', 'ok', e = 'ROUND_NOT_FOUND', 'got', e);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 200, NULL, 2::smallint)');
  out := out || jsonb_build_object('t','second bet off: slot 2 refused', 'ok', e = 'INVALID_SLOT', 'got', e);

  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.play":true,"features.maintenance":true}'::jsonb, NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.place_bet(gen_random_uuid(), 200, NULL, 1::smallint)');
  out := out || jsonb_build_object('t','brand maintenance stops bets', 'ok', e = 'MAINTENANCE_MODE', 'got', e);
  e := pg_temp.err('SELECT public.request_withdrawal(100, ''0712345678'')');
  out := out || jsonb_build_object('t','brand maintenance stops withdrawals', 'ok', e = 'MAINTENANCE_MODE', 'got', e);
  e := pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 500)', pb));
  out := out || jsonb_build_object('t','brand maintenance stops deposits', 'ok', e = 'MAINTENANCE_MODE', 'got', e);
  PERFORM pg_temp.act(pa);
  e := pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 500)', pa));
  out := out || jsonb_build_object('t','other brands keep running', 'ok', e = 'ok', 'got', e);

  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL,
    '{"features.maintenance":false,"features.deposits":false,"limits.max_withdrawal":300,"limits.daily_withdrawal":500,"payments.stk_reference":"BEEBET"}'::jsonb, NULL);
  e := pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 500)', pb));
  out := out || jsonb_build_object('t','deposits off refused', 'ok', e = 'DEPOSITS_DISABLED', 'got', e);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.deposits":true,"limits.min_deposit":250,"limits.max_deposit":1000}'::jsonb, NULL);
  out := out || jsonb_build_object('t','brand deposit minimum / maximum', 'ok',
    pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 200)', pb)) = 'BELOW_MIN:250' AND pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 2000)', pb)) = 'ABOVE_MAX:1000',
    'got', pg_temp.err(format('SELECT public.fn_deposit_guard(%L, 200)', pb)));
  r := public.fn_deposit_guard(pb, 500);
  out := out || jsonb_build_object('t','M-Pesa account name from the brand', 'ok', r->>'reference' = 'BEEBET' AND (r->>'site_id')::uuid = B, 'got', r);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.request_withdrawal(400, ''0712345678'')');
  out := out || jsonb_build_object('t','withdrawal above the brand''s per-request cap refused', 'ok', e LIKE 'AMOUNT_TOO_HIGH%', 'got', e);
  e := pg_temp.err('SELECT public.request_withdrawal(300, ''0712345678'')');
  out := out || jsonb_build_object('t','withdrawal within the caps accepted', 'ok', e = 'ok', 'got', e);
  UPDATE withdrawal_requests SET status = 'completed' WHERE user_id = pb;
  e := pg_temp.err('SELECT public.request_withdrawal(300, ''0712345678'')');
  out := out || jsonb_build_object('t','daily cap counts today''s withdrawals', 'ok', e LIKE 'DAILY_LIMIT: 200%', 'got', e);
  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.withdrawals":false}'::jsonb, NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.request_withdrawal(100, ''0712345678'')');
  out := out || jsonb_build_object('t','withdrawals off refused', 'ok', e = 'WITHDRAWALS_DISABLED' AND (SELECT NOT withdrawals_enabled FROM sites WHERE id = B), 'got', e);

  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.promo_codes":false,"features.rain":false,"features.free_bets":false,"features.chat":false}'::jsonb, NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.redeem_promo_code(''ANY'')');
  out := out || jsonb_build_object('t','promo codes off refused', 'ok', e = 'PROMO_DISABLED', 'got', e);
  e := pg_temp.err('SELECT public.claim_rain(gen_random_uuid())');
  out := out || jsonb_build_object('t','rain off refused', 'ok', e = 'RAIN_DISABLED', 'got', e);
  e := pg_temp.err('SELECT public.place_free_bet(gen_random_uuid(), gen_random_uuid(), NULL, 1::smallint)');
  out := out || jsonb_build_object('t','free bets off refused', 'ok', e = 'FREE_BETS_DISABLED', 'got', e);
  EXECUTE 'SET LOCAL ROLE authenticated';
  e := pg_temp.err(format('INSERT INTO chat_messages(user_id, username, avatar_color, text) VALUES (%L, %L, %L, %L)', pb, 'brndpb', '#ffffff', 'hi'));
  EXECUTE 'RESET ROLE';
  out := out || jsonb_build_object('t','chat off: the insert policy refuses', 'ok', e LIKE '%row-level security%', 'got', e);

  -- sign-up and welcome bonus follow the brand
  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"bonus.welcome_enabled":true,"bonus.welcome_amount":77,"bonus.welcome_wager_x":2}'::jsonb, NULL);
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (newu, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brand-new@example.invalid',
          jsonb_build_object('username', 'brndnew', 'phone', '254733000099', 'site_slug', 'e2e-brand-b'), now(), now());
  out := out || jsonb_build_object('t','sign-up on brand B gets brand B''s welcome bonus', 'ok',
    (SELECT amount FROM bonuses WHERE user_id = newu AND type = 'welcome') = 7700 AND (SELECT wagering_x FROM bonuses WHERE user_id = newu) = 2,
    'got', (SELECT jsonb_agg(to_jsonb(bx)) FROM bonuses bx WHERE bx.user_id = newu));
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.registrations":false}'::jsonb, NULL);
  e := pg_temp.err(format($q$INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
          VALUES (%L, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brand-new2@example.invalid',
          '{"username":"brndnew2","phone":"254733000098","site_slug":"e2e-brand-b"}', now(), now())$q$, newu2));
  out := out || jsonb_build_object('t','sign-ups off on brand B refused', 'ok', e LIKE '%REGISTRATIONS_DISABLED%', 'got', e);

  -- bet cap snapshot on the bet
  out := out || jsonb_build_object('t','cash-out and engine settle use the cap stored on the bet', 'ok',
    position('coalesce(v_bet.max_payout, v_maxpay)' in pg_get_functiondef('public.cash_out(uuid,smallint)'::regprocedure)) > 0
    AND position('coalesce(rec.max_payout, v_maxpay)' in pg_get_functiondef('public._settle_flight(uuid,numeric,numeric)'::regprocedure)) > 0);

  -- ── marketer ownership ──
  PERFORM pg_temp.act(pa1);
  PERFORM public.platform_assign_marketer(B, mb);
  out := out || jsonb_build_object('t','platform admin assigns the brand''s marketer', 'ok', (SELECT default_marketer_id FROM sites WHERE id = B) = mb);
  PERFORM pg_temp.act(own);
  e := pg_temp.err(format('SELECT public.platform_assign_marketer(%L, %L)', C, mb));
  out := out || jsonb_build_object('t','a marketer owns one brand only', 'ok', e = 'MARKETER_OWNS_ANOTHER_BRAND', 'got', e);
  INSERT INTO referrals(marketer_id, player_id, status, site_id) VALUES (ma, pa, 'pending', A) ON CONFLICT (player_id) DO UPDATE SET marketer_id = ma;
  e := pg_temp.err(format('SELECT public.platform_assign_marketer(%L, %L)', C, ma));
  out := out || jsonb_build_object('t','a marketer with players cannot be moved to another brand', 'ok', e = 'MARKETER_HAS_PLAYERS', 'got', e);
  PERFORM public.platform_assign_marketer(C, pa);
  out := out || jsonb_build_object('t','a player can be moved in and promoted to the brand''s marketer', 'ok',
    (SELECT role FROM profiles WHERE id = pa) = 'marketer' AND (SELECT site_id FROM profiles WHERE id = pa) = C AND (SELECT site_id FROM wallets WHERE user_id = pa) = C);

  -- ── brand lifecycle ──
  PERFORM pg_temp.act(pa1);
  e := pg_temp.err(format('SELECT public.platform_create_site(%L, %L, %L, %L, %L)', 'e2e-brand-d', 'Brand D', 'KES', 'en-KE', P2));
  out := out || jsonb_build_object('t','platform admin cannot create a brand on another platform', 'ok', e = 'FORBIDDEN', 'got', e);
  r := public.platform_create_site('e2e-brand-d', 'Brand D', 'KES', 'en-KE', NULL, '{"brand":"#22c55e"}'::jsonb, '{"plane.model":"biplane"}'::jsonb);
  out := out || jsonb_build_object('t','platform admin creates a brand on its platform with a look', 'ok',
    (SELECT platform_id FROM sites WHERE id = (r->>'site_id')::uuid) = P1 AND (SELECT config->>'plane.model' FROM sites WHERE id = (r->>'site_id')::uuid) = 'biplane'
    AND (SELECT count(*) FROM site_config_versions WHERE site_id = (r->>'site_id')::uuid) = 2, 'got', r);
  n := (SELECT count(*) FROM public.platform_sites_overview());
  out := out || jsonb_build_object('t','platform overview lists only the platform''s brands', 'ok', n = 2, 'got', n);
  PERFORM pg_temp.act(sb);
  e := pg_temp.err('SELECT count(*) FROM public.platform_sites_overview()');
  out := out || jsonb_build_object('t','brand staff cannot open the platform overview', 'ok', e = 'FORBIDDEN', 'got', e);

  -- ── brand assets (storage) ──
  PERFORM pg_temp.act(pa1);
  EXECUTE 'SET LOCAL ROLE authenticated';
  e := pg_temp.err(format('INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'brand-assets', B || '/plane/e2e.png', pa1));
  out := out || jsonb_build_object('t','platform admin uploads into its brand''s folder', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'brand-assets', C || '/plane/e2e.png', pa1));
  out := out || jsonb_build_object('t','platform admin cannot upload into another platform''s brand', 'ok', e LIKE '%row-level security%', 'got', e);
  e := pg_temp.err(format('INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'brand-assets', 'no-brand/e2e.png', pa1));
  out := out || jsonb_build_object('t','uploads must sit under a brand id', 'ok', e LIKE '%row-level security%', 'got', e);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.act(sb);
  EXECUTE 'SET LOCAL ROLE authenticated';
  e := pg_temp.err(format('INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'brand-assets', B || '/logo/e2e.png', sb));
  out := out || jsonb_build_object('t','brand owner uploads its own logo', 'ok', e = 'ok', 'got', e);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.act(ab);
  EXECUTE 'SET LOCAL ROLE authenticated';
  e := pg_temp.err(format('INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'brand-assets', B || '/logo/e2e2.png', ab));
  out := out || jsonb_build_object('t','brand admin (not owner) cannot upload', 'ok', e LIKE '%row-level security%', 'got', e);
  EXECUTE 'RESET ROLE';
  out := out || jsonb_build_object('t','bucket is public, raster only, 2 MB', 'ok',
    (SELECT public AND file_size_limit = 2097152 AND NOT ('image/svg+xml' = ANY(allowed_mime_types)) FROM storage.buckets WHERE id = 'brand-assets'));

  -- ── referral links switch ──
  PERFORM pg_temp.act(own);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.registrations":true,"features.referrals":false}'::jsonb, NULL);
  PERFORM public._ensure_referral_code(mb);
  code := (SELECT referral_code FROM profiles WHERE id = mb);
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (newu3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brand-new3@example.invalid',
          jsonb_build_object('username', 'brndnew3', 'phone', '254733000097', 'site_slug', 'e2e-brand-b', 'referral_code', code), now(), now());
  out := out || jsonb_build_object('t','referral links off: a ?ref= sign-up is not credited to that marketer', 'ok',
    code IS NOT NULL AND (SELECT referred_by FROM profiles WHERE id = newu3) IS NULL, 'got', code);
  PERFORM public.admin_brand_save(B, NULL, NULL, NULL, '{"features.referrals":true}'::jsonb, NULL);
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (newu4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brand-new4@example.invalid',
          jsonb_build_object('username', 'brndnew4', 'phone', '254733000096', 'site_slug', 'e2e-brand-b', 'referral_code', code), now(), now());
  out := out || jsonb_build_object('t','referral links on: the sign-up is credited', 'ok', (SELECT referred_by FROM profiles WHERE id = newu4) = mb);

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
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'))[:600]}"))
# The web app's typed settings file must match the registry it was generated from.
chk = __import__('subprocess').run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts', 'sync_brand_settings.py'), '--check'], capture_output=True, text=True)
ok = chk.returncode == 0
bad += 0 if ok else 1
results.append({'t': 'settings.generated.ts matches brand_setting_defs', 'ok': ok})
print(f"  [{'PASS' if ok else 'FAIL'}] settings.generated.ts matches brand_setting_defs" + ('' if ok else '  -- ' + chk.stdout.strip()))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
