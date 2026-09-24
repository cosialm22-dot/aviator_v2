#!/usr/bin/env python3
"""E2E for migration 20260925100000_megapay_gateway.sql — run against the REAL schema, then rolled back.

The whole run is ONE transaction sent through the Supabase Management API: it applies the migration,
creates throwaway users through the real signup trigger, drives every money rule, and ends by
raising an exception that carries the results — so nothing (users, deposits, credits, settings,
the migration itself) is ever kept. Safe to run against production.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/megapay_gateway_e2e.py

Concurrency (two settles of one deposit at the same moment) is covered separately in
megapay_concurrency_e2e.py against a local Postgres, because it needs two sessions.
"""
import json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "migrations", "20260925100000_megapay_gateway.sql")
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
DO $t$
DECLARE
  out jsonb := '[]'::jsonb;
  p uuid := gen_random_uuid(); q uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  d1 jsonb; d2 jsonb; d3 jsonb; d4 jsonb; r jsonb; bal0 bigint; bal1 bigint; n int; e text; tot0 numeric;
  PROCEDURE_OK boolean;
BEGIN
  -- throwaway users through the real signup trigger (profile + wallet)
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (p,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mp-e2e-p@example.invalid',  '{"username":"mpe2ep","phone":"254711000001"}', now(), now()),
         (q,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mp-e2e-q@example.invalid',  '{"username":"mpe2eq","phone":"254711000002"}', now(), now()),
         (op, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mp-e2e-op@example.invalid', '{"username":"mpe2eop","phone":"254711000003"}', now(), now());
  UPDATE profiles SET role = 'admin' WHERE id = op;

  r := public.fn_public_payment_config();
  out := out || jsonb_build_object('t','public config: megapay, KES 100–150,000', 'ok', r->>'deposit_provider' = 'megapay' AND (r->>'min_deposit')::numeric = 100 AND (r->>'max_deposit')::numeric = 150000);

  BEGIN PERFORM public.fn_megapay_begin(p, '254711000001', 50); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','below the minimum is refused', 'ok', e LIKE 'BELOW_MIN%', 'got', e);
  BEGIN PERFORM public.fn_megapay_begin(p, '254711000001', 150.5); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','fractional amounts are refused', 'ok', e = 'INVALID_AMOUNT', 'got', e);
  BEGIN PERFORM public.fn_megapay_begin(p, '254711000001', 150001); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','above the maximum is refused', 'ok', e LIKE 'ABOVE_MAX%', 'got', e);
  BEGIN PERFORM public.fn_megapay_begin(p, '0711000001', 500); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a phone not in 2547/2541 form is refused', 'ok', e = 'INVALID_PHONE', 'got', e);
  BEGIN PERFORM public.fn_megapay_begin(op, '254711000003', 500); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','operators cannot deposit', 'ok', e = 'OPERATOR_CANNOT_DEPOSIT', 'got', e);
  UPDATE profiles SET is_banned = true WHERE id = q;
  BEGIN PERFORM public.fn_megapay_begin(q, '254711000002', 500); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','banned accounts cannot deposit', 'ok', e = 'ACCOUNT_BANNED', 'got', e);
  UPDATE profiles SET is_banned = false WHERE id = q;
  UPDATE platform_global_config SET deposits_enabled = false;
  BEGIN PERFORM public.fn_megapay_begin(q, '254711000002', 500); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','the platform deposit switch blocks deposits', 'ok', e = 'DEPOSITS_DISABLED', 'got', e);
  UPDATE platform_global_config SET deposits_enabled = true;
  UPDATE system_settings SET value = '"daraja"' WHERE key = 'payments.deposit_provider';
  BEGIN PERFORM public.fn_megapay_begin(q, '254711000002', 500); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','Mega Pay is refused when another gateway is selected', 'ok', e = 'MEGAPAY_DISABLED', 'got', e);
  UPDATE system_settings SET value = '"megapay"' WHERE key = 'payments.deposit_provider';
  SELECT count(*) INTO n FROM mpesa_stk_requests WHERE user_id IN (p, q, op);
  out := out || jsonb_build_object('t','no row is written for a refused deposit', 'ok', n = 0, 'got', n);

  d1 := public.fn_megapay_begin(p, '254711000001', 500);
  out := out || jsonb_build_object('t','a valid deposit is recorded BEFORE Mega Pay is called', 'ok',
    (SELECT status = 'initiated' AND checkout_request_id LIKE 'mp-pending:%' AND provider = 'megapay' AND amount = 500 AND reference = d1->>'reference'
       FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid));
  out := out || jsonb_build_object('t','the payer sees the brand name as the account', 'ok', (d1->>'reference') ~ '^[A-Z0-9]+$', 'got', d1->>'reference');
  d2 := public.fn_megapay_begin(p, '254711000001', 1000);
  d3 := public.fn_megapay_begin(p, '254711000001', 300);
  BEGIN PERFORM public.fn_megapay_begin(p, '254711000001', 300); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','a 4th prompt within 2 minutes is refused', 'ok', e = 'RATE_LIMITED', 'got', e);

  PERFORM public.fn_megapay_attach((d1->>'id')::uuid, 'TRID-A', 'MR-A');
  out := out || jsonb_build_object('t','attaching Mega Pay''s id moves it to pending', 'ok',
    (SELECT status = 'pending' AND checkout_request_id = 'TRID-A' FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid));
  BEGIN PERFORM public.fn_megapay_attach((d1->>'id')::uuid, 'TRID-A2', 'x'); e := 'ok'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  out := out || jsonb_build_object('t','an id cannot be attached twice', 'ok', e = 'DEPOSIT_NOT_FOUND', 'got', e);
  PERFORM public.fn_megapay_initiation_failed((d3->>'id')::uuid, 'Mega Pay rejected');
  out := out || jsonb_build_object('t','a rejected prompt is closed as failed', 'ok', (SELECT status = 'failed' FROM mpesa_stk_requests WHERE id = (d3->>'id')::uuid));

  r := public.fn_megapay_settle('NOPE', 'paid', 'R0', 'Completed');
  out := out || jsonb_build_object('t','an unknown id credits nothing', 'ok', r->>'result' = 'not_found');

  SELECT real_balance INTO bal0 FROM wallets WHERE user_id = p;
  SELECT coalesce(total_deposited, 0) INTO tot0 FROM profiles WHERE id = p;
  r := public.fn_megapay_settle('TRID-A', 'pending', NULL, 'Pending');
  SELECT real_balance INTO bal1 FROM wallets WHERE user_id = p;
  out := out || jsonb_build_object('t','a pending status credits nothing and counts the check', 'ok', r->>'result' = 'pending' AND bal1 = bal0
    AND (SELECT check_count = 1 AND last_checked_at IS NOT NULL FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid));

  r := public.fn_megapay_settle('TRID-A', 'paid', 'SAB1C2D3E4', 'Completed');
  SELECT real_balance INTO bal1 FROM wallets WHERE user_id = p;
  out := out || jsonb_build_object('t','a paid status credits exactly the recorded amount (KES 500)', 'ok', r->>'result' = 'credited' AND bal1 - bal0 = 50000, 'got', bal1 - bal0);
  out := out || jsonb_build_object('t','the deposit transaction carries the M-Pesa receipt', 'ok',
    (SELECT count(*) = 1 FROM transactions WHERE user_id = p AND type = 'deposit' AND reference = 'SAB1C2D3E4' AND amount = 500 AND payment_method = 'mpesa'));
  out := out || jsonb_build_object('t','the request is completed and linked to its transaction', 'ok',
    (SELECT status = 'completed' AND credited_tx_id IS NOT NULL AND mpesa_receipt_number = 'SAB1C2D3E4' FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid));
  out := out || jsonb_build_object('t','total deposited goes up by 500', 'ok', (SELECT total_deposited - tot0 = 500 FROM profiles WHERE id = p));
  out := out || jsonb_build_object('t','the ledger records the credit', 'ok',
    (SELECT count(*) >= 1 FROM ledger_entries WHERE ref_id = (SELECT credited_tx_id::text FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid)));

  r := public.fn_megapay_settle('TRID-A', 'paid', 'SAB1C2D3E4', 'Completed');
  SELECT real_balance INTO n FROM wallets WHERE user_id = p;
  out := out || jsonb_build_object('t','settling again credits nothing (already_completed)', 'ok', r->>'result' = 'already_completed' AND n = bal1);
  r := public.fn_megapay_settle('TRID-A', 'failed', NULL, 'Failed');
  out := out || jsonb_build_object('t','a later "failed" cannot undo a completed deposit', 'ok', r->>'result' = 'already_completed'
    AND (SELECT status = 'completed' FROM mpesa_stk_requests WHERE id = (d1->>'id')::uuid));

  PERFORM public.fn_megapay_attach((d2->>'id')::uuid, 'TRID-B', 'MR-B');
  r := public.fn_megapay_settle('TRID-B', 'failed', NULL, 'Cancelled');
  out := out || jsonb_build_object('t','a cancelled payment is closed as failed', 'ok', r->>'result' = 'failed');
  r := public.fn_megapay_settle('TRID-B', 'paid', 'SXYZ', 'Completed');
  out := out || jsonb_build_object('t','a failed deposit can never be credited later', 'ok', r->>'result' = 'already_failed'
    AND (SELECT count(*) = 0 FROM transactions WHERE reference = 'SXYZ'));

  -- receipt collision: a second deposit settled with an already-used receipt must not credit
  d4 := public.fn_megapay_begin(q, '254711000002', 400);
  PERFORM public.fn_megapay_attach((d4->>'id')::uuid, 'TRID-C', 'MR-C');
  BEGIN r := public.fn_megapay_settle('TRID-C', 'paid', 'SAB1C2D3E4', 'Completed'); e := 'ok'; EXCEPTION WHEN unique_violation THEN e := 'unique_violation'; END;
  out := out || jsonb_build_object('t','a reused M-Pesa receipt cannot credit twice (unique backstop)', 'ok', e = 'unique_violation'
    AND (SELECT real_balance FROM wallets WHERE user_id = q) = 0, 'got', e);

  -- stale + late payment
  UPDATE mpesa_stk_requests SET created_at = now() - interval '20 minutes' WHERE id = (d4->>'id')::uuid;
  n := public.fn_megapay_mark_stale();
  out := out || jsonb_build_object('t','pending for 15+ minutes shows as timeout', 'ok', (SELECT status = 'timeout' FROM mpesa_stk_requests WHERE id = (d4->>'id')::uuid));
  out := out || jsonb_build_object('t','timed-out deposits are still re-checked', 'ok', EXISTS (SELECT 1 FROM public.fn_megapay_due(50) x WHERE x.id = (d4->>'id')::uuid));
  r := public.fn_megapay_settle('TRID-C', 'paid', 'SLATE123', 'Completed');
  out := out || jsonb_build_object('t','a late payment after timeout still credits', 'ok', r->>'result' = 'credited'
    AND (SELECT real_balance FROM wallets WHERE user_id = q) = 40000);

  -- orphaned initiation
  UPDATE profiles SET is_banned = false WHERE id = q;
  DELETE FROM mpesa_stk_requests WHERE user_id = q AND status <> 'completed';
  d3 := public.fn_megapay_begin(q, '254711000002', 250);
  UPDATE mpesa_stk_requests SET created_at = now() - interval '11 minutes' WHERE id = (d3->>'id')::uuid;
  n := public.fn_megapay_close_orphans();
  out := out || jsonb_build_object('t','a prompt that never got a Mega Pay id is closed after 10 minutes', 'ok', (SELECT status = 'failed' FROM mpesa_stk_requests WHERE id = (d3->>'id')::uuid));

  out := out || jsonb_build_object('t','recently checked deposits are skipped by the job', 'ok', NOT EXISTS (
    SELECT 1 FROM public.fn_megapay_due(50) x JOIN mpesa_stk_requests m ON m.id = x.id WHERE m.last_checked_at > now() - interval '20 seconds'));

  SELECT count(*) INTO n FROM pg_proc WHERE proname LIKE 'fn_megapay_%'
     AND (has_function_privilege('anon', oid, 'execute') OR has_function_privilege('authenticated', oid, 'execute'));
  out := out || jsonb_build_object('t','no fn_megapay_* function is callable by anon/authenticated', 'ok', n = 0, 'got', n);
  out := out || jsonb_build_object('t','the public payment config is readable by anyone', 'ok',
    has_function_privilege('anon', 'public.fn_public_payment_config()', 'execute'));

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
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {r.get('got')}"))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
