#!/usr/bin/env python3
"""Proves the RLS rewrite in 20260928110000 grants exactly the same rows as before.

One rolled-back transaction: builds two brands with players and staff, records what every caller
(player, other player, brand admin, support, other brand's admin, platform owner, anon) can SELECT
from every rewritten table UNDER THE OLD POLICIES, applies the migration's transactional part,
records again, and compares. Also prints the policy definitions afterwards.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/rls_tuning_e2e.py
"""
import json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = open(os.path.join(HERE, "..", "migrations", "20260928110000_rls_and_index_tuning.sql"), encoding="utf-8").read()
TX = MIG[MIG.index("BEGIN;") + len("BEGIN;"):MIG.index("COMMIT;")]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]

def run(sql):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": sql}).encode(),
                                 method="POST", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

TABLES = ["admin_audit_log", "player_risk_scores", "crash_queue", "system_settings", "withdrawal_requests",
          "mpesa_stk_requests", "wallets", "transactions", "bonuses", "free_bets", "user_notifications",
          "affiliate_clicks", "marketer_expenses", "rain_claims", "mpesa_b2c_requests", "support_conversations"]

SNAP = """
CREATE OR REPLACE FUNCTION pg_temp.snap(label text, who uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE t text; res jsonb := '{}'; ids jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN who IS NULL THEN '{"role":"anon"}' ELSE json_build_object('sub', who, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  EXECUTE CASE WHEN who IS NULL THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
  FOREACH t IN ARRAY %s LOOP
    BEGIN
      IF t IN ('crash_queue', 'system_settings') THEN   -- all-or-nothing tables: compare the row count
        EXECUTE format('SELECT to_jsonb(count(*)) FROM public.%%I', t) INTO ids;
      ELSE
        EXECUTE format('SELECT coalesce(jsonb_agg(x ORDER BY x), ''[]'') FROM (SELECT md5(t::text) x FROM public.%%I t) s', t) INTO ids;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN ids := '"DENIED"';
    END;
    res := res || jsonb_build_object(t, ids);
  END LOOP;
  RESET ROLE;
  RETURN res;
END $f$;
""" % ("ARRAY[" + ",".join(f"'{t}'" for t in TABLES) + "]")

TEST = r"""
DO $t$
DECLARE
  A uuid := '00000000-0000-0000-0000-000000000001'; B uuid;
  own uuid := public._root_super_admin();
  pa uuid := gen_random_uuid(); pa2 uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); admb uuid := gen_random_uuid();
  who uuid[]; lbl text[] := ARRAY['player A','other player A','player B','admin A','support A','admin B','platform owner','anon'];
  before jsonb := '{}'; after jsonb := '{}'; i int; out jsonb := '[]';
BEGIN
  INSERT INTO sites(slug, name, status) VALUES ('rls-e2e', 'RLS E2E', 'disabled') RETURNING id INTO B;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-' || k || '@example.invalid',
         jsonb_build_object('username', 'rls' || k, 'phone', '2547330000' || lpad(v.n::text, 2, '0')), now(), now()
    FROM (VALUES (pa,'pa',1),(pa2,'pa2',2),(pb,'pb',3),(adm,'adm',4),(sup,'sup',5),(admb,'admb',6)) v(u,k,n);
  UPDATE profiles SET role='admin' WHERE id = adm; UPDATE profiles SET role='support' WHERE id = sup;
  UPDATE profiles SET site_id = B WHERE id IN (pb, admb); UPDATE wallets SET site_id = B WHERE user_id IN (pb, admb);
  UPDATE profiles SET role='admin' WHERE id = admb;
  -- rows on both brands in every table that has data paths
  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, site_id) VALUES (pa, 100, '254700000001', 'pending', A), (pb, 200, '254700000002', 'pending', B);
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id)
    VALUES (pa, '254700000001', 100, 'rls-a-' || gen_random_uuid(), 'pending', 'megapay', A), (pb, '254700000002', 100, 'rls-b-' || gen_random_uuid(), 'pending', 'megapay', B);
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id) VALUES (adm, 'rls_a', 'x', 'x', '{}', A), (admb, 'rls_b', 'x', 'x', '{}', B);
  INSERT INTO player_risk_scores(user_id, risk_level, score, site_id) VALUES (pa, 'low', 1, A), (pb, 'low', 1, B);
  INSERT INTO transactions(user_id, type, amount, description, status, site_id) VALUES (pa, 'adjustment', 1, 'rls', 'completed', A), (pb, 'adjustment', 1, 'rls', 'completed', B);
  who := ARRAY[pa, pa2, pb, adm, sup, admb, own, NULL];
  FOR i IN 1..8 LOOP before := before || jsonb_build_object(lbl[i], pg_temp.snap(lbl[i], who[i])); END LOOP;
  %MIGRATION%
  FOR i IN 1..8 LOOP after := after || jsonb_build_object(lbl[i], pg_temp.snap(lbl[i], who[i])); END LOOP;
  -- "no access" is the same whether it shows as an error (DENIED), zero rows or an empty list
  FOR i IN 1..8 LOOP
    before := jsonb_set(before, ARRAY[lbl[i]], (SELECT jsonb_object_agg(k, CASE WHEN v IN ('"DENIED"', '0', '[]') THEN '"none"'::jsonb ELSE v END) FROM jsonb_each(before->lbl[i]) e(k, v)));
    after  := jsonb_set(after,  ARRAY[lbl[i]], (SELECT jsonb_object_agg(k, CASE WHEN v IN ('"DENIED"', '0', '[]') THEN '"none"'::jsonb ELSE v END) FROM jsonb_each(after->lbl[i]) e(k, v)));
  END LOOP;
  FOR i IN 1..8 LOOP
    out := out || jsonb_build_object('t', lbl[i], 'ok', before->lbl[i] = after->lbl[i],
      'diff', (SELECT jsonb_object_agg(k, jsonb_build_object('before', before->lbl[i]->k, 'after', after->lbl[i]->k))
                 FROM jsonb_object_keys(before->lbl[i]) k WHERE before->lbl[i]->k IS DISTINCT FROM after->lbl[i]->k),
      'rows', (SELECT sum(CASE jsonb_typeof(v) WHEN 'array' THEN jsonb_array_length(v) WHEN 'number' THEN (v #>> '{}')::int ELSE 0 END) FROM jsonb_each(after->lbl[i]) e(k, v)));
  END LOOP;
  -- sanity: the scoping actually bites
  out := out || jsonb_build_object('t', 'admin B sees only brand B withdrawals', 'ok', jsonb_array_length(after->'admin B'->'withdrawal_requests') >= 1
            AND NOT (after->'admin B'->'withdrawal_requests') @> (after->'player A'->'withdrawal_requests'));
  out := out || jsonb_build_object('t', 'a player sees only their own withdrawal', 'ok', jsonb_array_length(after->'player A'->'withdrawal_requests') = 1
            AND after->'other player A'->'withdrawal_requests' = '"none"');
  out := out || jsonb_build_object('t', 'anon sees no staff or money rows', 'ok', NOT EXISTS (
            SELECT 1 FROM jsonb_each(after->'anon') e(k, v) WHERE v <> '"none"'));
  out := out || jsonb_build_object('t', 'no policy still calls auth.uid() or _is_admin() per row', 'ok', NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ '(auth\.uid\(\)|_is_admin\(\))'
               AND (coalesce(qual,'')||coalesce(with_check,'')) !~* '\(\s*select\s+(auth\.uid|public\._is_admin)'));
  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

sql = "BEGIN;\nSET LOCAL lock_timeout='15s';\n" + SNAP + TEST.replace("%MIGRATION%", "EXECUTE $mig$" + TX + "$mig$;")
st, body = run(sql)
try: msg = json.loads(body).get("message", body)
except Exception: msg = body
m = re.search(r"E2E_RESULT (\[.*\])", msg, re.S)
if not m:
    print("did not reach the result block:", st, msg[:2000]); sys.exit(2)
res = json.JSONDecoder().raw_decode(m.group(1))[0]
bad = 0
for r in res:
    ok = r.get("ok") is True; bad += 0 if ok else 1
    extra = f" ({r['rows']} visible rows, identical before and after)" if "rows" in r and ok else ""
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}{extra}" + ("" if ok else f"  -- {json.dumps(r.get('diff'))[:600]}"))
print(f"\n{len(res) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
