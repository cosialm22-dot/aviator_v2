#!/usr/bin/env python3
"""E2E for migration 20260925120000_megapay_admin.sql — run against the REAL schema, then rolled back.

One transaction through the Management API: applies the migration, builds two brands with their own
staff and players, drives the operator RPCs as each caller (auth.uid() via request.jwt.claims), and
ends by raising the results — nothing is kept. Safe on production.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/megapay_admin_e2e.py
"""
import json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "migrations", "20260925120000_megapay_admin.sql")
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]

def run(sql: str):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

migration = open(MIG, encoding="utf-8").read()
migration = re.sub(r"^\s*BEGIN;\s*$", "", migration, flags=re.M)
migration = re.sub(r"^\s*COMMIT;\s*$", "", migration, flags=re.M)

TESTS = r"""
CREATE OR REPLACE FUNCTION pg_temp.act(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', u::text, true);
$$;
DO $t$
DECLARE
  out jsonb := '[]'::jsonb;
  A uuid := '00000000-0000-0000-0000-000000000001'; B uuid;
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); fin uuid := gen_random_uuid();
  admb uuid := gen_random_uuid(); own uuid := public._root_super_admin();  -- the one real platform owner (nothing persists)
  r_pend uuid; r_tmo uuid; r_tmo2 uuid; r_orph uuid; r_mpfail uuid; r_mis uuid; r_b uuid;
  r jsonb; e text; bal0 bigint; bal1 bigint; n int; tot0 numeric;
BEGIN
  INSERT INTO sites(slug, name, status) VALUES ('mp-admin-e2e', 'MP Admin E2E', 'disabled') RETURNING id INTO B;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mpadm-' || k || '@example.invalid',
         jsonb_build_object('username', 'mpadm' || k, 'phone', '2547110000' || lpad(i::text, 2, '0')), now(), now()
    FROM (VALUES (pa,'pa',1),(pb,'pb',2),(adm,'adm',3),(sup,'sup',4),(fin,'fin',5),(admb,'admb',6)) v(u,k,i);
  UPDATE profiles SET role = 'admin' WHERE id = adm;
  UPDATE profiles SET role = 'support' WHERE id = sup;
  UPDATE profiles SET role = 'finance_admin' WHERE id = fin;
  UPDATE profiles SET role = 'admin', site_id = B WHERE id = admb;
  UPDATE profiles SET site_id = B WHERE id = pb;
  UPDATE wallets SET site_id = B WHERE user_id IN (pb, admb);

  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at, result_description, provider_status)
  VALUES (pa, '254711000001', 300, 'e2e-pend', 'pending', 'megapay', A, now(), NULL, NULL) RETURNING id INTO r_pend;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at)
  VALUES (pa, '254711000001', 700, 'e2e-tmo', 'timeout', 'megapay', A, now() - interval '2 hours') RETURNING id INTO r_tmo;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at)
  VALUES (pa, '254711000001', 900, 'e2e-tmo2', 'timeout', 'megapay', A, now() - interval '20 minutes') RETURNING id INTO r_tmo2;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at, result_description)
  VALUES (pa, '254711000001', 250, 'mp-pending:e2e-orph', 'failed', 'megapay', A, now() - interval '30 minutes', 'No Mega Pay response') RETURNING id INTO r_orph;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at, result_description)
  VALUES (pa, '254711000001', 400, 'e2e-mpfail', 'failed', 'megapay', A, now(), 'Mega Pay: Cancelled') RETURNING id INTO r_mpfail;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at, provider_status)
  VALUES (pa, '254711000001', 150000, 'e2e-mis', 'timeout', 'megapay', A, now() - interval '30 minutes', 'AMOUNT_MISMATCH 10') RETURNING id INTO r_mis;
  INSERT INTO mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at)
  VALUES (pb, '254711000002', 5000, 'e2e-b', 'timeout', 'megapay', B, now() - interval '3 hours') RETURNING id INTO r_b;

  -- ── overview ──
  PERFORM pg_temp.act(pa);
  BEGIN r := public.fn_admin_megapay_overview(NULL); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a player cannot open the deposits overview', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  PERFORM pg_temp.act(admb);
  r := public.fn_admin_megapay_overview(NULL);
  out := out || jsonb_build_object('t','brand B admin sees only brand B (1 timeout, KES 5,000)', 'ok',
     r->>'scope' = 'site' AND (r->>'site_id')::uuid = B AND (r#>>'{kpis,timeout_count}')::int = 1 AND (r#>>'{kpis,timeout_kes}')::numeric = 5000
     AND (r#>>'{kpis,pending_count}')::int = 0, 'got', r->'kpis');
  BEGIN r := public.fn_admin_megapay_overview(A); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','brand B admin cannot ask for brand A', 'ok', e = 'NOT_AUTHORIZED', 'got', e);

  PERFORM pg_temp.act(sup);
  r := public.fn_admin_megapay_overview(NULL);
  out := out || jsonb_build_object('t','support can view its brand but not credit or edit the gateway', 'ok',
     r->>'scope' = 'site' AND (r#>>'{health,can_manual_credit}')::boolean = false AND (r#>>'{health,can_edit_gateway}')::boolean = false, 'got', r->'health');

  PERFORM pg_temp.act(adm);
  r := public.fn_admin_megapay_overview(NULL);
  out := out || jsonb_build_object('t','brand A admin: pending, timeouts and attention counted for brand A only', 'ok',
     (r#>>'{kpis,pending_count}')::int >= 1 AND (r#>>'{kpis,timeout_kes}')::numeric >= 700 + 900 + 150000
     AND (r#>>'{kpis,attention_count}')::int >= 3 AND (r#>>'{health,can_manual_credit}')::boolean
     AND NOT (r#>>'{health,can_edit_gateway}')::boolean, 'got', r);
  out := out || jsonb_build_object('t','health reports the schedule and vault readiness as booleans only', 'ok',
     (r->'health') ? 'auto_check_scheduled' AND jsonb_typeof(r#>'{health,auto_check_ready}') = 'boolean'
     AND position('secret' in lower((r->'health')::text)) = 0, 'got', r->'health');

  PERFORM pg_temp.act(own);
  r := public.fn_admin_megapay_overview(NULL);
  out := out || jsonb_build_object('t','the platform owner sees every brand (timeouts include brand B)', 'ok',
     r->>'scope' = 'all' AND (r#>>'{kpis,timeout_kes}')::numeric >= 700 + 900 + 150000 + 5000 AND (r#>>'{health,can_edit_gateway}')::boolean, 'got', r->'kpis');
  r := public.fn_admin_megapay_overview(B);
  out := out || jsonb_build_object('t','the platform owner can focus on one brand', 'ok', (r#>>'{kpis,timeout_count}')::int = 1, 'got', r->'kpis');

  -- ── manual credit ──
  SELECT real_balance INTO bal0 FROM wallets WHERE user_id = pa;
  SELECT coalesce(total_deposited, 0) INTO tot0 FROM profiles WHERE id = pa;
  PERFORM pg_temp.act(sup);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','support cannot credit', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(pa);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a player cannot credit', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(admb);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','another brand''s admin cannot credit this brand''s deposit', 'ok', e = 'DEPOSIT_NOT_FOUND', 'got', e);

  PERFORM pg_temp.act(fin);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'bad!', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a malformed receipt is refused', 'ok', e = 'INVALID_RECEIPT', 'got', e);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'SAB1234567', 'ok'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a reason is required', 'ok', e = 'NOTE_REQUIRED', 'got', e);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_pend, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a deposit still pending cannot be credited by hand', 'ok', e = 'NOT_ELIGIBLE', 'got', e);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_mpfail, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a deposit Mega Pay reported as failed cannot be credited by hand', 'ok', e = 'NOT_ELIGIBLE', 'got', e);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_mis, 'SAB1234567', 'Seen in Mega Pay portal'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','an amount-mismatch deposit cannot be credited by hand', 'ok', e = 'AMOUNT_MISMATCH', 'got', e);

  r := public.fn_admin_megapay_manual_credit(r_tmo, ' sab1234567 ', 'Seen in Mega Pay portal');
  SELECT real_balance INTO bal1 FROM wallets WHERE user_id = pa;
  out := out || jsonb_build_object('t','finance credits a confirmed timeout: +KES 700 once, receipt normalised', 'ok',
     r->>'result' = 'credited' AND bal1 - bal0 = 70000
     AND (SELECT status = 'completed' AND mpesa_receipt_number = 'SAB1234567' AND credited_tx_id = (r->>'tx')::uuid FROM mpesa_stk_requests WHERE id = r_tmo),
     'got', jsonb_build_object('r', r, 'delta', bal1 - bal0));
  out := out || jsonb_build_object('t','total deposited is updated', 'ok',
     (SELECT total_deposited FROM profiles WHERE id = pa) = tot0 + 700);
  out := out || jsonb_build_object('t','the credit is audited with who, what, receipt and reason on the right brand', 'ok', EXISTS (
     SELECT 1 FROM admin_audit_log WHERE action = 'megapay_manual_credit' AND admin_id = fin AND target_id = r_tmo::text
        AND site_id = A AND details->>'receipt' = 'SAB1234567' AND details->>'note' = 'Seen in Mega Pay portal'));
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo, 'SAB7654321', 'Second attempt here'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','the same deposit cannot be credited twice', 'ok', e = 'ALREADY_CREDITED', 'got', e);
  BEGIN PERFORM public.fn_admin_megapay_manual_credit(r_tmo2, 'SAB1234567', 'Same receipt reused'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','the same M-Pesa receipt cannot be used for a second deposit', 'ok', e = 'RECEIPT_ALREADY_USED', 'got', e);
  r := public.fn_megapay_settle('e2e-tmo', 'paid', 'SAB1234567', 'Completed');
  SELECT real_balance INTO bal0 FROM wallets WHERE user_id = pa;
  out := out || jsonb_build_object('t','Mega Pay confirming it later does not credit again', 'ok', r->>'result' = 'already_completed' AND bal0 = bal1, 'got', r);

  r := public.fn_admin_megapay_manual_credit(r_orph, 'SAC0000001', 'Player sent M-Pesa SMS; matched in Mega Pay');
  SELECT real_balance INTO bal0 FROM wallets WHERE user_id = pa;
  out := out || jsonb_build_object('t','a prompt that never got a Mega Pay answer can be credited once confirmed', 'ok', r->>'result' = 'credited' AND bal0 - bal1 = 25000, 'got', r);

  -- ── gateway settings ──
  PERFORM pg_temp.act(adm);
  BEGIN PERFORM public.fn_admin_set_payment_settings('megapay', 100, 150000); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a brand admin cannot change the gateway for every brand', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  -- (one super_admin exists platform-wide today — act as that account; nothing persists)
  PERFORM pg_temp.act(coalesce((SELECT id FROM profiles WHERE role = 'super_admin' LIMIT 1), adm));
  BEGIN PERFORM public.fn_admin_set_payment_settings('megapay', 100, 150000); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a brand super admin cannot either', 'ok', e = 'NOT_AUTHORIZED', 'got', e);
  PERFORM pg_temp.act(own);
  BEGIN PERFORM public.fn_admin_set_payment_settings('stripe', 100, 150000); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','an unknown gateway is refused', 'ok', e = 'INVALID_PROVIDER', 'got', e);
  BEGIN PERFORM public.fn_admin_set_payment_settings('megapay', 500, 100); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','min above max is refused', 'ok', e LIKE 'INVALID_RANGE%', 'got', e);
  BEGIN PERFORM public.fn_admin_set_payment_settings('megapay', 100, 300000); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a max above the M-Pesa limit is refused', 'ok', e LIKE 'INVALID_RANGE%', 'got', e);
  BEGIN PERFORM public.fn_admin_set_payment_settings('megapay', 100.5, 1000); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','fractional limits are refused', 'ok', e = 'INVALID_AMOUNT', 'got', e);
  r := public.fn_admin_set_payment_settings('megapay', 200, 70000);
  out := out || jsonb_build_object('t','the platform owner sets limits; players see them at once', 'ok',
     (r->>'min_deposit')::numeric = 200 AND (r->>'max_deposit')::numeric = 70000
     AND (public.fn_public_payment_config()->>'min_deposit')::numeric = 200, 'got', r);
  BEGIN PERFORM public.fn_megapay_begin(pa, '254711000001', 150); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','the new minimum is enforced on the next deposit', 'ok', e = 'BELOW_MIN:200', 'got', e);
  out := out || jsonb_build_object('t','the change is audited with old and new values', 'ok', EXISTS (
     SELECT 1 FROM admin_audit_log WHERE action = 'payment_settings_updated' AND admin_id = own AND (details#>>'{new,min}')::numeric = 200));

  -- ── grants and RLS ──
  out := out || jsonb_build_object('t','clients can no longer insert, update or delete deposit rows', 'ok',
     NOT has_table_privilege('authenticated', 'public.mpesa_stk_requests', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.mpesa_stk_requests', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.mpesa_stk_requests', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.mpesa_stk_requests', 'INSERT'));
  out := out || jsonb_build_object('t','staff keep read-only access to their own brand''s deposits', 'ok',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mpesa_stk_requests' AND policyname = 'admin_full_access')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mpesa_stk_requests' AND policyname = 'admin_read_site' AND cmd = 'SELECT'));
  out := out || jsonb_build_object('t','anon cannot call the operator functions', 'ok',
     NOT has_function_privilege('anon', 'public.fn_admin_megapay_overview(uuid)', 'execute')
     AND NOT has_function_privilege('anon', 'public.fn_admin_megapay_manual_credit(uuid,text,text)', 'execute')
     AND NOT has_function_privilege('anon', 'public.fn_admin_set_payment_settings(text,numeric,numeric)', 'execute'));

  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

status, body = run("BEGIN;\n" + migration + "\n" + TESTS)
try:
    msg = json.loads(body).get("message", body)
except Exception:
    msg = body
m = re.search(r"E2E_RESULT (\[.*\])", msg, re.S)
if not m:
    print("did not reach the result block:", status, msg[:1500]); sys.exit(2)
results = json.JSONDecoder().raw_decode(m.group(1))[0]
bad = 0
for r in results:
    ok = r.get("ok") is True
    bad += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'))[:400]}"))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
