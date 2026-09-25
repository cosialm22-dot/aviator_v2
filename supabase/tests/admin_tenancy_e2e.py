#!/usr/bin/env python3
"""E2E for migration 20260926090000_admin_tenancy.sql — real schema, one transaction, rolled back.

Builds a second brand (B) next to the default brand (A) with its own owner, admin, support and
players, then checks every rule of the migration as each caller (auth.uid() via request.jwt.claims).

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/admin_tenancy_e2e.py
"""
import json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "migrations", "20260926090000_admin_tenancy.sql")
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

migration = open(MIG, encoding="utf-8").read()
migration = re.sub(r"^\s*BEGIN;\s*$", "", migration, flags=re.M)
migration = re.sub(r"^\s*COMMIT;\s*$", "", migration, flags=re.M)
# The migration is live; re-applying it inside the test would roll later migrations' versions of the same
# functions back to this one's. REAPPLY_MIGRATION=1 restores the original apply-then-test mode (only valid
# on a database where this is the newest migration).
REAPPLY = os.environ.get('REAPPLY_MIGRATION') == '1'

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
  A uuid := '00000000-0000-0000-0000-000000000001'; B uuid;
  own uuid := public._root_super_admin();
  sa uuid := (SELECT id FROM profiles WHERE role = 'super_admin' AND site_id = '00000000-0000-0000-0000-000000000001' LIMIT 1);
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pb2 uuid := gen_random_uuid();
  aa uuid := gen_random_uuid(); ab uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); supb uuid := gen_random_uuid();
  txa uuid; promo_a uuid; promo_b uuid; rnd uuid; r jsonb; e text; n int;
BEGIN
  INSERT INTO sites(slug, name, status) VALUES ('tenancy-e2e', 'Tenancy E2E', 'disabled') RETURNING id INTO B;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ten-' || k || '@example.invalid',
         jsonb_build_object('username', 'ten' || k, 'phone', '2547220000' || lpad(i::text, 2, '0')), now(), now()
    FROM (VALUES (pa,'pa',1),(pb,'pb',2),(pb2,'pb2',3),(aa,'aa',4),(ab,'ab',5),(sb,'sb',6),(sup,'sup',7),(supb,'supb',8)) v(u,k,i);
  UPDATE profiles SET role = 'admin' WHERE id = aa;
  UPDATE profiles SET role = 'support' WHERE id = sup;
  UPDATE profiles SET site_id = B WHERE id IN (pb, pb2, ab, sb, supb);
  UPDATE wallets SET site_id = B WHERE user_id IN (pb, pb2, ab, sb, supb);
  UPDATE profiles SET role = 'admin' WHERE id = ab;
  UPDATE profiles SET role = 'support' WHERE id = supb;
  e := pg_temp.err(format('UPDATE profiles SET role = %L WHERE id = %L', 'super_admin', sb));
  out := out || jsonb_build_object('t','a second brand can have its own owner (one super_admin per brand)', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('UPDATE profiles SET role = %L WHERE id = %L', 'super_admin', ab));
  out := out || jsonb_build_object('t','but still only one owner per brand', 'ok', e LIKE '%uniq_one_super_admin_per_site%', 'got', e);
  UPDATE profiles SET is_banned = true, ban_reason = 'e2e' WHERE id = pb2;

  -- data on both brands
  INSERT INTO transactions(user_id, type, amount, payment_method, reference, description, status, site_id)
  VALUES (pa, 'deposit', 300, 'mpesa', 'TENA' || substr(md5(random()::text), 1, 6), 'e2e', 'completed', A) RETURNING id INTO txa;
  INSERT INTO transactions(user_id, type, amount, payment_method, reference, description, status, site_id)
  VALUES (pb, 'deposit', 500, 'mpesa', 'TENB' || substr(md5(random()::text), 1, 6), 'e2e', 'completed', B);
  SELECT id INTO rnd FROM game_rounds WHERE status = 'crashed' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO bets(round_id, user_id, username, amount, status, winnings, is_bot, site_id, created_at, slot)
  VALUES (rnd, pb, 'tenpb', 100, 'won', 250, false, B, now(), 1), (rnd, pb, 'tenpb', 50, 'lost', NULL, false, B, now(), 2),
         (rnd, pb2, 'botx', 999, 'lost', NULL, true, B, now(), 1);
  INSERT INTO promotions(title, is_active, site_id) VALUES ('A promo e2e', false, A) RETURNING id INTO promo_a;

  -- ── support ──
  PERFORM pg_temp.act(sup);
  out := out || jsonb_build_object('t','support counts as staff', 'ok', public._is_staff());
  e := pg_temp.err(format('SELECT public.admin_get_user(%L)', pa));
  out := out || jsonb_build_object('t','support can open a player on their brand', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_get_user(%L)', pb));
  out := out || jsonb_build_object('t','support cannot open another brand''s player', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  e := pg_temp.err('SELECT public.admin_list_fraud_alerts(''low'', 10)');
  out := out || jsonb_build_object('t','support can read risk alerts', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err('SELECT public.admin_current_round()');
  -- The live round carries the crash point of a round every brand plays: owner-only since the multi-brand tiers.
  out := out || jsonb_build_object('t','brand support cannot see the live round (shared engine is owner-only)', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_ban(%L, true, %L)', pa, 'x'));
  out := out || jsonb_build_object('t','support still cannot ban', 'ok', e = 'FORBIDDEN', 'got', e);
  e := pg_temp.err('SELECT public.admin_list_audit(NULL, NULL, NULL, NULL, NULL, 10, 0)');
  out := out || jsonb_build_object('t','support cannot read the audit trail', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  -- ── brand checks ──
  PERFORM pg_temp.act(ab);
  e := pg_temp.err(format('SELECT public.admin_get_mpesa_detail(%L)', txa));
  out := out || jsonb_build_object('t','brand B admin cannot open brand A''s M-Pesa detail', 'ok', e = 'NOT_FOUND', 'got', e);
  r := public.admin_upsert_promotion(NULL, '{"title":"B promo e2e"}'::jsonb);
  promo_b := (r->>'id')::uuid;
  out := out || jsonb_build_object('t','a promotion made by brand B belongs to brand B', 'ok', (SELECT site_id FROM promotions WHERE id = promo_b) = B);
  e := pg_temp.err(format('SELECT public.admin_set_promotion_active(%L, true)', promo_a));
  out := out || jsonb_build_object('t','brand B cannot switch brand A''s promotion', 'ok', e = 'NOT_FOUND', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_delete_promotion(%L)', promo_a));
  out := out || jsonb_build_object('t','brand B cannot delete brand A''s promotion', 'ok', e = 'NOT_FOUND', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_upsert_promotion(%L, %L::jsonb)', promo_a, '{"title":"hijack"}'));
  out := out || jsonb_build_object('t','brand B cannot edit brand A''s promotion', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  PERFORM pg_temp.act(aa);
  e := pg_temp.err(format('SELECT public.admin_set_promotion_active(%L, true)', promo_a));
  out := out || jsonb_build_object('t','brand A''s admin can still manage its own promotion', 'ok', e = 'ok', 'got', e);

  PERFORM pg_temp.act(sb);
  e := pg_temp.err(format('SELECT public.admin_set_site_theme(%L, NULL, NULL)', B));
  out := out || jsonb_build_object('t','brand B''s owner may call the theme writer on brand B (a no-op save)', 'ok', e NOT LIKE 'NOT_AUTHORIZED%', 'got', e);
  e := pg_temp.err(format('SELECT public.admin_set_site_theme(%L, NULL, NULL)', A));
  out := out || jsonb_build_object('t','brand B''s owner cannot theme brand A', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  -- ── global controls ──
  PERFORM pg_temp.act(coalesce(sa, sb));
  e := pg_temp.err('SELECT public.admin_set_setting(''game.min_bet'', ''60''::jsonb)');
  out := out || jsonb_build_object('t','a brand owner cannot change settings shared by every brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  e := pg_temp.err('SELECT public.admin_queue_add(2.5)');
  out := out || jsonb_build_object('t','a brand owner cannot queue crash points for the shared game', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  e := pg_temp.err('SELECT public.admin_get_mpesa_config()');
  out := out || jsonb_build_object('t','a brand owner cannot read the paybill config', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(own);
  e := pg_temp.err('SELECT public.admin_set_setting(''game.min_bet'', ''60''::jsonb)');
  out := out || jsonb_build_object('t','the platform owner can (rolled back)', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err('SELECT public.admin_queue_add(2.5)');
  out := out || jsonb_build_object('t','the platform owner can queue (rolled back)', 'ok', e = 'ok', 'got', e);
  e := pg_temp.err('SELECT public.admin_save_mpesa_config(''{"environment":"sandbox","shortcode":"12","callback_base_url":"https://x.example"}''::jsonb)');
  out := out || jsonb_build_object('t','paybill config rejects a bad shortcode', 'ok', e = 'INVALID_SHORTCODE', 'got', e);
  r := public.admin_save_mpesa_config('{"environment":"sandbox","shortcode":"174379","callback_base_url":"https://x.example","consumer_key":"ck"}'::jsonb, '{"passkey":"pk-secret-e2e"}'::jsonb);
  out := out || jsonb_build_object('t','paybill config: secrets are reported as set, never returned', 'ok',
     (r->>'passkey_set')::boolean AND position('pk-secret-e2e' in r::text) = 0 AND NOT (r ? 'passkey'), 'got', r);
  out := out || jsonb_build_object('t','paybill change is audited with the rotated secret names only', 'ok', EXISTS (
     SELECT 1 FROM admin_audit_log WHERE action = 'mpesa_config_updated' AND admin_id = own AND details->'secrets_rotated' ? 'passkey'
        AND position('pk-secret-e2e' in details::text) = 0));

  -- ── grants ──
  out := out || jsonb_build_object('t','staff tables are read-only through the API', 'ok',
     NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'DELETE')
     AND NOT has_table_privilege('authenticated', 'public.withdrawal_requests', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.player_risk_scores', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.crash_queue', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.system_settings', 'UPDATE'));
  out := out || jsonb_build_object('t','the paybill table is not readable through the API at all', 'ok',
     NOT has_table_privilege('authenticated', 'public.mpesa_config', 'SELECT') AND NOT has_table_privilege('anon', 'public.mpesa_config', 'SELECT'));
  SELECT count(*) INTO n FROM pg_policies WHERE policyname = 'admin_full_access'
     AND tablename IN ('admin_audit_log','withdrawal_requests','player_risk_scores','crash_queue','system_settings','mpesa_config');
  out := out || jsonb_build_object('t','no catch-all staff write policy is left on those tables', 'ok', n = 0, 'got', n);

  -- ── audit attribution ──
  PERFORM pg_temp.act(ab);
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details) VALUES (ab, 'e2e_b_action', 'user', pb::text, '{}');
  PERFORM pg_temp.act(own);
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details) VALUES (own, 'e2e_own_on_b', 'user', pb::text, '{}');
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details) VALUES (ab, 'e2e_b_misc', 'setting', 'x', '{}');
  out := out || jsonb_build_object('t','audit rows land on the right brand (target player, else actor)', 'ok',
     (SELECT site_id FROM admin_audit_log WHERE action = 'e2e_b_action') = B
     AND (SELECT site_id FROM admin_audit_log WHERE action = 'e2e_own_on_b') = B
     AND (SELECT site_id FROM admin_audit_log WHERE action = 'e2e_b_misc') = B);

  -- ── overview ──
  PERFORM pg_temp.act(ab);
  r := public.admin_overview(NULL, 7);
  out := out || jsonb_build_object('t','brand B overview: KES 500 deposited, stake 150, payouts 250, revenue −100, bots ignored', 'ok',
     r->>'scope' = 'site' AND (r#>>'{today,deposits_kes}')::numeric = 500 AND (r#>>'{today,stake_kes}')::numeric = 150
     AND (r#>>'{today,payouts_kes}')::numeric = 250 AND (r#>>'{today,house_revenue_kes}')::numeric = -100
     AND (r#>>'{today,bettors}')::int = 1 AND jsonb_array_length(r->'series') = 7, 'got', r->'today');
  out := out || jsonb_build_object('t','the last day of the series is today with the same deposits', 'ok',
     ((r->'series')->-1->>'deposits_kes')::numeric = 500, 'got', (r->'series')->-1);
  e := pg_temp.err(format('SELECT public.admin_overview(%L, 7)', A));
  out := out || jsonb_build_object('t','brand B cannot ask for brand A''s overview', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(own);
  r := public.admin_overview(NULL, 7);
  out := out || jsonb_build_object('t','platform owner overview covers every brand', 'ok',
     r->>'scope' = 'all' AND (r#>>'{today,deposits_kes}')::numeric >= 800, 'got', r->'today');
  r := public.admin_overview(B, 7);
  out := out || jsonb_build_object('t','platform owner can focus on brand B', 'ok', (r#>>'{today,deposits_kes}')::numeric = 500, 'got', r->'today');
  PERFORM pg_temp.act(pb);
  e := pg_temp.err('SELECT public.admin_overview(NULL, 7)');
  out := out || jsonb_build_object('t','players cannot read the overview', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  -- ── players list ──
  PERFORM pg_temp.act(supb);
  r := public.admin_list_players(NULL, NULL, 'all', 'player', 'newest', 50, 0);
  out := out || jsonb_build_object('t','brand B support lists exactly brand B''s two players', 'ok', (r->>'total')::int = 2, 'got', r->'total');
  r := public.admin_list_players(NULL, '0722000003', 'all', 'player', 'newest', 50, 0);
  out := out || jsonb_build_object('t','search by local phone number', 'ok', (r->>'total')::int = 1 AND r->'rows'->0->>'username' = 'tenpb2', 'got', r);
  r := public.admin_list_players(NULL, NULL, 'banned', 'player', 'newest', 50, 0);
  out := out || jsonb_build_object('t','banned filter', 'ok', (r->>'total')::int = 1, 'got', r->'total');
  r := public.admin_list_players(NULL, NULL, 'all', 'player', 'deposited', 1, 0);
  out := out || jsonb_build_object('t','pagination keeps the full total; sort by deposited', 'ok',
     (r->>'total')::int = 2 AND jsonb_array_length(r->'rows') = 1, 'got', r);
  r := public.admin_list_players(NULL, NULL, 'all', 'staff', 'newest', 50, 0);
  out := out || jsonb_build_object('t','staff filter lists brand B''s staff only', 'ok', (r->>'total')::int = 3, 'got', r->'total');
  e := pg_temp.err('SELECT public.admin_list_players(NULL, NULL, ''all'', ''player'', ''drop table'', 50, 0)');
  out := out || jsonb_build_object('t','unknown sort is refused', 'ok', e = 'INVALID_SORT', 'got', e);
  PERFORM pg_temp.act(own);
  r := public.admin_list_players(B, NULL, 'all', 'player', 'newest', 50, 0);
  out := out || jsonb_build_object('t','platform owner lists brand B with brand names', 'ok',
     (r->>'total')::int = 2 AND r->'rows'->0->>'site_name' = 'Tenancy E2E', 'got', r->'total');

  -- ── audit list ──
  PERFORM pg_temp.act(ab);
  r := public.admin_list_audit(NULL, NULL, NULL, NULL, NULL, 50, 0);
  out := out || jsonb_build_object('t','brand B admin sees only brand B''s audit rows', 'ok',
     (r->>'total')::int >= 3 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>'site_id')::uuid <> B), 'got', r->'total');
  r := public.admin_list_audit(NULL, 'e2e_b_action', NULL, NULL, NULL, 50, 0);
  out := out || jsonb_build_object('t','audit filter by action', 'ok', (r->>'total')::int = 1 AND r->'rows'->0->>'actor' = 'tenab', 'got', r);
  PERFORM pg_temp.act(own);
  r := public.admin_list_audit(B, NULL, 'tenab', NULL, NULL, 50, 0);
  -- tenab: e2e_b_action, e2e_b_misc and the promotion it created
  out := out || jsonb_build_object('t','platform owner filters audit by brand and actor', 'ok', (r->>'total')::int = 3, 'got', r->'total');

  -- ── scope switcher ──
  r := public.admin_my_sites();
  out := out || jsonb_build_object('t','platform owner can pick any brand', 'ok', jsonb_array_length(r) >= 2);
  PERFORM pg_temp.act(ab);
  r := public.admin_my_sites();
  out := out || jsonb_build_object('t','brand staff see only their brand', 'ok', jsonb_array_length(r) = 1 AND (r->0->>'id')::uuid = B, 'got', r);

  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

# Take every lock the migration needs in ONE statement first (fixed order → no deadlock with the
# game driver's short transactions); give up after 15 s rather than queue the site behind us.
LOCKS = ("SET LOCAL lock_timeout = '15s';\n"
         "LOCK TABLE public.system_settings, public.crash_queue, public.admin_audit_log, public.withdrawal_requests, "
         "public.player_risk_scores, public.mpesa_config, public.profiles IN ACCESS EXCLUSIVE MODE;\n")
status, body = run("BEGIN;\n" + LOCKS + (migration if REAPPLY else "") + "\n" + TESTS)
try:
    msg = json.loads(body).get("message", body)
except Exception:
    msg = body
m = re.search(r"E2E_RESULT (\[.*\])", msg, re.S)
if not m:
    print("did not reach the result block:", status, msg[:2000]); sys.exit(2)
results = json.JSONDecoder().raw_decode(m.group(1))[0]
bad = 0
for r in results:
    ok = r.get("ok") is True
    bad += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'))[:500]}"))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
