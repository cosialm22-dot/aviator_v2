#!/usr/bin/env python3
"""E2E for automatic M-Pesa payouts (migration 20260930097000) — the real schema, one
transaction, everything rolled back. APPLY_MIGRATION=1 applies the migration file inside the same
transaction first (to test it before it ships).

Brand B (platform P1) is paid from the System's tested B2C account; brand C has its own live
payment account but no B2C account, so it is paid by hand (no mixing). Checks the hold, auto
approval and the daily budget, the claim (no double send), every Safaricom callback outcome
(success, duplicate, forged token, mismatched ids, org-side failure, recipient failure, timeout,
status query, amount mismatch, no answer → staff), staff actions and their guards (retry, refund,
mark paid, pay now, reject), player cancel, the kill switches, brand scope, the ledger, grants.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… [APPLY_MIGRATION=1] python3 supabase/tests/payouts_e2e.py
"""
import json, os, re, sys, urllib.request

TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
MIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "migrations", "20260930097000_mpesa_payouts.sql")

def run(sql: str):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
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
CREATE OR REPLACE FUNCTION pg_temp.real(u uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT real_balance FROM wallets WHERE user_id = u $$;
CREATE OR REPLACE FUNCTION pg_temp.claim_one() RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM public.svc_payout_claim(10) x LIMIT 1 $$;
DO $t$
DECLARE
  out jsonb := '[]'::jsonb;
  B uuid; C uuid; P1 uuid;
  own uuid := public._root_super_admin();
  pa1 uuid := gen_random_uuid(); fin uuid := gen_random_uuid(); admc uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pb2 uuid := gen_random_uuid(); pc uuid := gen_random_uuid();
  r jsonb; cl jsonb; e text; w1 uuid; w2 uuid; w3 uuid; w4 uuid; w5 uuid; a uuid; tok text; bal bigint; b2c uuid; n int; q0 bigint;
BEGIN
  -- ── fixtures ──
  DELETE FROM integrations WHERE provider IN ('mpesa_b2c');
  UPDATE platform_global_config SET payouts_enabled = true, withdrawals_enabled = true WHERE id;
  INSERT INTO platforms(slug, name) VALUES ('e2e-po-p1', 'Payout One') RETURNING id INTO P1;
  INSERT INTO sites(slug, name, status, platform_id) VALUES ('e2e-po-b', 'Payout Brand B', 'active', P1) RETURNING id INTO B;
  INSERT INTO sites(slug, name, status) VALUES ('e2e-po-c', 'Payout Brand C', 'active') RETURNING id INTO C;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po-' || k || '@example.invalid',
         jsonb_build_object('username', 'po' || k, 'phone', '2547360000' || lpad(v.n::text, 2, '0'), 'site_slug', s), now(), now()
    FROM (VALUES (pa1,'pa1',1,NULL),(fin,'fin',2,'e2e-po-b'),(admc,'admc',3,'e2e-po-c'),(pb,'pb',4,'e2e-po-b'),(pb2,'pb2',5,'e2e-po-b'),(pc,'pc',6,'e2e-po-c')) v(u,k,n,s);
  UPDATE profiles SET role = 'platform_admin', platform_id = P1 WHERE id = pa1;
  UPDATE profiles SET role = 'finance_admin' WHERE id = fin;
  UPDATE profiles SET role = 'admin' WHERE id = admc;
  UPDATE profiles SET created_at = now() - interval '90 days', total_deposited = 100000 WHERE id IN (pb, pb2, pc);
  UPDATE wallets SET real_balance = 5000000 WHERE user_id IN (pb, pb2, pc);   -- KES 50,000 each
  UPDATE sites SET config = config || '{"limits.auto_approve":1000,"limits.min_withdrawal":100}'::jsonb WHERE id IN (B, C);
  -- the System's B2C account (tested)
  PERFORM pg_temp.act(own);
  r := public.admin_integration_save('mpesa_b2c','global',NULL,'{"shortcode":"600000","initiator_name":"apiop","command_id":"BusinessPayment"}'::jsonb,
         '{"consumer_key":"ck-e2e-000000000","consumer_secret":"cs-e2e-000000000","security_credential":"sc-e2e-000000000000"}'::jsonb);
  b2c := (r->>'id')::uuid;
  out := out || jsonb_build_object('t','a B2C account is saved like any gateway account (secrets hidden)', 'ok', position('cs-e2e' IN r::text) = 0 AND r->'secrets' ? 'security_credential', 'got', r);
  -- brand C: its own live payment account (Mega Pay) but no B2C account
  PERFORM public.admin_integration_save('megapay','site',C,'{"email":"c@pay.example"}'::jsonb,'{"api_key":"mp-e2e-000000000"}'::jsonb);
  UPDATE integrations SET test_ok = true WHERE provider = 'megapay' AND scope_kind = 'site' AND scope_id = C;
  INSERT INTO payment_scopes(scope_kind, scope_id, active) VALUES ('site', C, true) ON CONFLICT (scope_kind, scope_id) DO UPDATE SET active = true;

  -- ═════════ rails ═════════
  r := public.fn_payout_rail(B);
  out := out || jsonb_build_object('t','an untested B2C account is not used', 'ok', r->>'rail' = 'manual', 'got', r);
  UPDATE integrations SET test_ok = true WHERE id = b2c;
  r := public.fn_payout_rail(B);
  out := out || jsonb_build_object('t','a tested System B2C account pays the System''s brands automatically', 'ok', r->>'rail' = 'mpesa_b2c' AND (r->>'auto')::boolean AND (r->>'integration_id')::uuid = b2c, 'got', r);
  r := public.fn_payout_rail(C);
  out := out || jsonb_build_object('t','no mixing: a brand with its own account and no B2C is paid by hand, never from the System''s B2C', 'ok', r->>'rail' = 'manual' AND r->>'reason' LIKE '%Payout Brand C%', 'got', r);

  -- ═════════ hold + auto approval ═════════
  PERFORM pg_temp.act(pb);
  q0 := (SELECT count(*) FROM net.http_request_queue);
  r := public.request_withdrawal(500, '0712000001');
  w1 := (r->>'withdrawal_request_id')::uuid;
  out := out || jsonb_build_object('t','a small low-risk request is approved at once for automatic payout', 'ok',
    r->>'status' = 'approved' AND (r->>'automatic_payout')::boolean AND (SELECT rail FROM withdrawal_requests WHERE id = w1) = 'mpesa_b2c', 'got', r);
  out := out || jsonb_build_object('t','the amount is held at once (wallet and ledger)', 'ok',
    pg_temp.real(pb) = 5000000 - 50000 AND EXISTS (SELECT 1 FROM ledger_entries WHERE user_id = pb AND type = 'withdrawal_hold' AND amount = -50000 AND ref_id = w1::text),
    'got', pg_temp.real(pb));
  out := out || jsonb_build_object('t','the payout worker is woken (after commit)', 'ok', (SELECT count(*) FROM net.http_request_queue) > q0
    AND EXISTS (SELECT 1 FROM net.http_request_queue WHERE url LIKE '%/functions/v1/payouts-worker'));
  e := pg_temp.err($$SELECT public.request_withdrawal(200, '0712000001')$$);
  out := out || jsonb_build_object('t','one open withdrawal at a time', 'ok', e = 'WITHDRAWAL_PENDING', 'got', e);
  r := public.my_withdrawals(10);
  out := out || jsonb_build_object('t','the player sees their withdrawal and can still cancel it before it is sent', 'ok', r->0->>'status' = 'approved' AND (r->0->>'can_cancel')::boolean, 'got', r);

  -- ═════════ claim + success ═════════
  cl := pg_temp.claim_one();
  a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  out := out || jsonb_build_object('t','claim: one attempt is written before sending; the withdrawal is processing', 'ok',
    (cl->>'withdrawal_id')::uuid = w1 AND (SELECT status FROM withdrawal_requests WHERE id = w1) = 'processing'
    AND (SELECT status FROM payout_attempts WHERE id = a) = 'sending' AND length(tok) = 64, 'got', cl);
  out := out || jsonb_build_object('t','a second claim never picks the same withdrawal (no double send)', 'ok', pg_temp.claim_one() IS NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err(format($$SELECT public.cancel_my_withdrawal(%L)$$, w1));
  out := out || jsonb_build_object('t','a withdrawal being sent cannot be cancelled', 'ok', e LIKE 'CANNOT_CANCEL%', 'got', e);
  PERFORM public.svc_payout_sent(a, true, 'AG_e2e_conv_1', '0', 'Accept the service request successfully.');
  r := public.svc_payout_callback(a, repeat('0', 64), 'result', jsonb_build_object('result_code','0','amount',500,'transaction_id','TST1AB2CD3'));
  out := out || jsonb_build_object('t','a forged callback (wrong token) changes nothing', 'ok', r->>'result' = 'forbidden' AND (SELECT status FROM withdrawal_requests WHERE id = w1) = 'processing', 'got', r);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',500,'transaction_id','TST1AB2CD3','originator_id', gen_random_uuid()));
  out := out || jsonb_build_object('t','a callback naming another attempt is refused', 'ok', r->>'result' = 'mismatch', 'got', r);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',500,'transaction_id','TST1AB2CD3','conversation_id','OTHER'));
  out := out || jsonb_build_object('t','…or another conversation', 'ok', r->>'result' = 'mismatch', 'got', r);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','result_desc','The service request is processed successfully.',
         'amount',500,'transaction_id','tst1ab2cd3','conversation_id','AG_e2e_conv_1','originator_id',a,'recipient_name','254712000001 - E2E PLAYER'));
  out := out || jsonb_build_object('t','Safaricom success: paid, receipt and recipient stored', 'ok',
    r->>'result' = 'paid' AND (SELECT status = 'completed' AND mpesa_receipt = 'TST1AB2CD3' AND recipient_name LIKE '%E2E PLAYER' FROM withdrawal_requests WHERE id = w1), 'got', r);
  out := out || jsonb_build_object('t','…history row, lifetime total and a notification for the player; no second wallet move', 'ok',
    EXISTS (SELECT 1 FROM transactions WHERE user_id = pb AND type = 'withdrawal' AND amount = 500 AND reference = 'TST1AB2CD3')
    AND (SELECT total_withdrawn FROM profiles WHERE id = pb) = 500
    AND EXISTS (SELECT 1 FROM user_notifications WHERE user_id = pb AND title = 'Withdrawal paid')
    AND pg_temp.real(pb) = 5000000 - 50000);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',500,'transaction_id','TST1AB2CD3'));
  out := out || jsonb_build_object('t','a repeated callback is a no-op', 'ok', r->>'result' = 'already_succeeded'
    AND (SELECT count(*) FROM transactions WHERE user_id = pb AND type = 'withdrawal') = 1, 'got', r);
  r := public.svc_payout_callback(a, public.svc_payout_token(gen_random_uuid()::text), 'result', '{}'::jsonb);
  out := out || jsonb_build_object('t','a token is valid for its own attempt only', 'ok', r->>'result' = 'forbidden');

  -- ═════════ review, org-side failure, retry, recipient failure ═════════
  PERFORM pg_temp.act(pb);
  r := public.request_withdrawal(3000, '0712000001');
  w2 := (r->>'withdrawal_request_id')::uuid;
  out := out || jsonb_build_object('t','above the automatic limit it waits for review (still held)', 'ok', r->>'status' = 'pending' AND pg_temp.real(pb) = 5000000 - 50000 - 300000, 'got', r);
  out := out || jsonb_build_object('t','a pending withdrawal is never claimed', 'ok', pg_temp.claim_one() IS NULL);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err(format($$SELECT public.admin_approve_withdrawal(%L)$$, w2));
  out := out || jsonb_build_object('t','a player cannot approve', 'ok', e = 'FORBIDDEN', 'got', e);
  PERFORM pg_temp.act(admc);
  e := pg_temp.err(format($$SELECT public.admin_approve_withdrawal(%L)$$, w2));
  out := out || jsonb_build_object('t','another brand''s staff cannot approve', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  PERFORM pg_temp.act(fin);
  r := public.admin_approve_withdrawal(w2, 'ok');
  out := out || jsonb_build_object('t','finance approves: queued for automatic payout, audited', 'ok',
    r->>'status' = 'approved' AND r->>'rail' = 'mpesa_b2c' AND EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'withdrawal_approved' AND target_id = w2::text AND site_id = B), 'got', r);
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_sent(a, true, 'AG_e2e_conv_2', '0', 'Accepted');
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','1','result_desc','The balance is insufficient for the transaction.'));
  out := out || jsonb_build_object('t','an org-side failure (low float) goes to staff with the money still held', 'ok',
    r->>'result' = 'attention' AND (SELECT status = 'needs_attention' AND attention_reason LIKE '%insufficient%' FROM withdrawal_requests WHERE id = w2)
    AND pg_temp.real(pb) = 5000000 - 50000 - 300000, 'got', r);
  PERFORM pg_temp.act(pb);
  e := pg_temp.err($$SELECT public.request_withdrawal(100, '0712000001')$$);
  out := out || jsonb_build_object('t','the player cannot stack another request meanwhile', 'ok', e = 'WITHDRAWAL_PENDING', 'got', e);
  PERFORM pg_temp.act(fin);
  r := public.admin_withdrawal_retry(w2);
  out := out || jsonb_build_object('t','after a definite failure staff can retry without extra confirmation', 'ok', r->>'status' = 'approved', 'got', r);
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  out := out || jsonb_build_object('t','the retry is a new attempt', 'ok', (SELECT attempts FROM withdrawal_requests WHERE id = w2) = 2 AND (SELECT count(*) FROM payout_attempts WHERE withdrawal_id = w2) = 2);
  PERFORM public.svc_payout_sent(a, true, 'AG_e2e_conv_3', '0', 'Accepted');
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','2040','result_desc','Credit Party customer type (Unregistered or Registered Customer) can''t be supported by the service.'));
  out := out || jsonb_build_object('t','a recipient that cannot receive: failed and the money is back in the wallet', 'ok',
    r->>'result' = 'refunded' AND (SELECT status = 'failed' AND refunded_at IS NOT NULL FROM withdrawal_requests WHERE id = w2)
    AND pg_temp.real(pb) = 5000000 - 50000
    AND EXISTS (SELECT 1 FROM ledger_entries WHERE ref_id = w2::text AND type = 'withdrawal_refund' AND amount = 300000)
    AND EXISTS (SELECT 1 FROM user_notifications WHERE user_id = pb AND title = 'Withdrawal not paid'), 'got', r);

  -- ═════════ unknown outcome → status queries → staff ═════════
  PERFORM pg_temp.act(pb);
  w3 := (public.request_withdrawal(700, '0712000001')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_unknown(a, 'network timeout');
  out := out || jsonb_build_object('t','an unknown outcome stays processing and is never resent', 'ok',
    (SELECT status FROM withdrawal_requests WHERE id = w3) = 'processing' AND pg_temp.claim_one() IS NULL);
  PERFORM pg_temp.act(fin);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_retry(%L)$$, w3));
  out := out || jsonb_build_object('t','staff cannot retry while Safaricom may still be paying', 'ok', e LIKE 'NOT_IN_ATTENTION%', 'got', e);
  UPDATE payout_attempts SET created_at = now() - interval '4 minutes' WHERE id = a;
  n := (SELECT count(*) FROM public.svc_payouts_unresolved(50) x WHERE (x->>'attempt_id')::uuid = a);
  out := out || jsonb_build_object('t','after 3 minutes Safaricom is asked for the status', 'ok', n = 1 AND (SELECT status_queries FROM payout_attempts WHERE id = a) = 1, 'got', n);
  n := (SELECT count(*) FROM public.svc_payouts_unresolved(50) x WHERE (x->>'attempt_id')::uuid = a);
  out := out || jsonb_build_object('t','…at most every 5 minutes', 'ok', n = 0, 'got', n);
  r := public.svc_payout_callback(a, tok, 'status', jsonb_build_object('result_code','0','transaction_status','Pending'));
  out := out || jsonb_build_object('t','an inconclusive status answer leaves it for the next check', 'ok', r->>'result' = 'unresolved', 'got', r);
  UPDATE payout_attempts SET created_at = now() - interval '61 minutes' WHERE id = a;
  PERFORM public.svc_payouts_unresolved(50);
  out := out || jsonb_build_object('t','no answer after 60 minutes: handed to staff, money still held', 'ok',
    (SELECT status = 'needs_attention' AND attention_reason LIKE 'No answer from Safaricom%' FROM withdrawal_requests WHERE id = w3)
    AND (SELECT escalated_at IS NOT NULL FROM payout_attempts WHERE id = a) AND pg_temp.real(pb) = 5000000 - 50000 - 70000);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_refund(%L, 'x')$$, w3));
  out := out || jsonb_build_object('t','refunding an unconfirmed payout needs explicit confirmation', 'ok', e LIKE 'OUTCOME_UNKNOWN%', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_retry(%L)$$, w3));
  out := out || jsonb_build_object('t','…so does retrying it', 'ok', e LIKE 'OUTCOME_UNKNOWN%', 'got', e);
  r := public.admin_withdrawal_refund(w3, 'Checked the M-Pesa statement: not paid', true);
  out := out || jsonb_build_object('t','confirmed not paid: refunded and audited', 'ok', r->>'status' = 'failed' AND pg_temp.real(pb) = 5000000 - 50000
    AND EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'withdrawal_refunded' AND target_id = w3::text AND (details->>'confirmed_unpaid')::boolean), 'got', r);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',700,'transaction_id','LATE1PAID9'));
  out := out || jsonb_build_object('t','a success arriving after a refund is flagged for recovery, never hidden', 'ok',
    r->>'result' = 'paid_after_close' AND EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'withdrawal_paid_after_close' AND target_id = w3::text), 'got', r);

  -- a late answer after escalation settles it; a late success after a confirmed retry raises the alarm
  PERFORM pg_temp.act(pb);
  w3 := (public.request_withdrawal(650, '0712000001')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_unknown(a, 'network timeout');
  UPDATE payout_attempts SET created_at = now() - interval '61 minutes' WHERE id = a;
  PERFORM public.svc_payouts_unresolved(50);
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',650,'transaction_id','LATE2OK001'));
  out := out || jsonb_build_object('t','a late success after the hand-over to staff still completes it', 'ok', r->>'result' = 'paid'
    AND (SELECT status FROM withdrawal_requests WHERE id = w3) = 'completed', 'got', r);
  PERFORM pg_temp.act(pb);
  w3 := (public.request_withdrawal(660, '0712000001')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_unknown(a, 'network timeout');
  UPDATE payout_attempts SET created_at = now() - interval '61 minutes' WHERE id = a;
  PERFORM public.svc_payouts_unresolved(50);
  PERFORM pg_temp.act(fin);
  PERFORM public.admin_withdrawal_retry(w3, true);
  cl := pg_temp.claim_one();
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',660,'transaction_id','LATE3DUP01'));
  out := out || jsonb_build_object('t','a success on an attempt staff closed while a retry is in flight: alarm, never silent', 'ok',
    r->>'result' = 'paid_after_close' AND (SELECT attention_reason LIKE 'ALERT:%' FROM withdrawal_requests WHERE id = w3)
    AND (SELECT status FROM payout_attempts WHERE id = a) = 'succeeded', 'got', r);
  PERFORM public.svc_payout_sent((cl->>'attempt_id')::uuid, true, 'AG_e2e_conv_x', '0', 'Accepted');
  PERFORM public.svc_payout_callback((cl->>'attempt_id')::uuid, cl->>'token', 'result', jsonb_build_object('result_code','2040','result_desc','unregistered'));
  out := out || jsonb_build_object('t','the alarm stays on the withdrawal after it closes, and is counted', 'ok',
    (SELECT attention_reason LIKE 'ALERT:%' FROM withdrawal_requests WHERE id = w3) AND (public.admin_payout_status(B)->'counts'->>'alerts')::int >= 1);

  -- ═════════ status query success, timeout, amount mismatch ═════════
  PERFORM pg_temp.act(pb);
  w4 := (public.request_withdrawal(800, '0712000001')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_sent(a, true, 'AG_e2e_conv_4', '0', 'Accepted');
  r := public.svc_payout_callback(a, tok, 'timeout', jsonb_build_object('result_code','1','result_desc','timeout'));
  out := out || jsonb_build_object('t','a queue timeout is not a failure: still processing', 'ok', r->>'result' = 'timeout' AND (SELECT status FROM withdrawal_requests WHERE id = w4) = 'processing'
    AND (SELECT status FROM payout_attempts WHERE id = a) = 'timeout');
  r := public.svc_payout_callback(a, tok, 'status', jsonb_build_object('result_code','0','transaction_status','Completed','transaction_id','STAT9OK123','amount',800));
  out := out || jsonb_build_object('t','the status query confirms payment: paid with its receipt', 'ok', r->>'result' = 'paid'
    AND (SELECT status = 'completed' AND mpesa_receipt = 'STAT9OK123' FROM withdrawal_requests WHERE id = w4), 'got', r);
  PERFORM pg_temp.act(pb);
  w5 := (public.request_withdrawal(900, '0712000001')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid; tok := cl->>'token';
  PERFORM public.svc_payout_sent(a, true, 'AG_e2e_conv_5', '0', 'Accepted');
  r := public.svc_payout_callback(a, tok, 'result', jsonb_build_object('result_code','0','amount',90,'transaction_id','MISMATCH01'));
  out := out || jsonb_build_object('t','Safaricom paying a different amount goes to staff', 'ok', r->>'result' = 'amount_mismatch'
    AND (SELECT status = 'needs_attention' AND attention_reason LIKE '%KES 90%' FROM withdrawal_requests WHERE id = w5), 'got', r);
  PERFORM pg_temp.act(fin);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_mark_paid(%L, 'bad!')$$, w5));
  out := out || jsonb_build_object('t','mark paid needs a real receipt code', 'ok', e LIKE 'INVALID_RECEIPT%', 'got', e);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_mark_paid(%L, 'stat9ok123')$$, w5));
  out := out || jsonb_build_object('t','a receipt can only be used once', 'ok', e LIKE 'RECEIPT_USED%', 'got', e);
  r := public.admin_withdrawal_mark_paid(w5, 'HAND5PAID1', 'topped up the difference');
  out := out || jsonb_build_object('t','staff mark it paid with the receipt', 'ok', r->>'status' = 'completed' AND (SELECT paid_manually FROM withdrawal_requests WHERE id = w5), 'got', r);

  -- ═════════ Safaricom refuses the request outright ═════════
  PERFORM pg_temp.act(pb2);
  w1 := (public.request_withdrawal(400, '0712000002')->>'withdrawal_request_id')::uuid;
  cl := pg_temp.claim_one(); a := (cl->>'attempt_id')::uuid;
  r := public.svc_payout_sent(a, false, NULL, '400.002.02', 'Bad Request - Invalid Initiator');
  out := out || jsonb_build_object('t','a request Safaricom refuses at once goes to staff (nothing paid, still held)', 'ok',
    r->>'result' = 'rejected' AND (SELECT status = 'needs_attention' AND attention_reason LIKE '%Invalid Initiator%' FROM withdrawal_requests WHERE id = w1)
    AND NOT public._withdrawal_outcome_unknown(w1), 'got', r);
  PERFORM pg_temp.act(fin);
  r := public.admin_withdrawal_refund(w1, 'Initiator is being fixed; please request again later');
  out := out || jsonb_build_object('t','a definitely unpaid withdrawal is refunded without extra confirmation', 'ok', r->>'status' = 'failed' AND pg_temp.real(pb2) = 5000000, 'got', r);

  -- ═════════ switches and budget ═════════
  UPDATE sites SET config = config || '{"payments.auto_payout":false}'::jsonb WHERE id = B;
  PERFORM pg_temp.act(pb2);
  r := public.request_withdrawal(300, '0712000002'); w1 := (r->>'withdrawal_request_id')::uuid;
  out := out || jsonb_build_object('t','brand pays out on staff''s word: approved but not sent', 'ok', r->>'status' = 'approved' AND NOT (r->>'automatic_payout')::boolean AND pg_temp.claim_one() IS NULL, 'got', r);
  PERFORM pg_temp.act(fin);
  PERFORM public.admin_withdrawal_pay_now(w1);
  cl := pg_temp.claim_one();
  out := out || jsonb_build_object('t','Pay now releases it to the worker', 'ok', (cl->>'withdrawal_id')::uuid = w1, 'got', cl);
  PERFORM public.svc_payout_sent((cl->>'attempt_id')::uuid, true, 'AG_e2e_conv_6', '0', 'Accepted');
  PERFORM public.svc_payout_callback((cl->>'attempt_id')::uuid, cl->>'token', 'result', jsonb_build_object('result_code','0','amount',300,'transaction_id','PAYNOW0001'));
  UPDATE sites SET config = config - 'payments.auto_payout' WHERE id = B;
  UPDATE platform_global_config SET payouts_enabled = false WHERE id;
  PERFORM pg_temp.act(pb2);
  r := public.request_withdrawal(300, '0712000002'); w1 := (r->>'withdrawal_request_id')::uuid;
  out := out || jsonb_build_object('t','System kill switch: nothing is sent', 'ok', NOT (r->>'automatic_payout')::boolean AND pg_temp.claim_one() IS NULL, 'got', r);
  PERFORM pg_temp.act(fin);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_pay_now(%L)$$, w1));
  out := out || jsonb_build_object('t','…not even with Pay now', 'ok', e = 'PAYOUTS_PAUSED', 'got', e);
  r := public.admin_reject_withdrawal(w1, 'Payouts paused for maintenance');
  out := out || jsonb_build_object('t','an approved, unsent withdrawal can be rejected (refunded)', 'ok', r->>'status' = 'rejected' AND pg_temp.real(pb2) = 5000000 - 30000, 'got', r);
  UPDATE platform_global_config SET payouts_enabled = true WHERE id;
  UPDATE sites SET config = config || '{"limits.auto_payout_daily":700}'::jsonb WHERE id = B;
  PERFORM pg_temp.act(pb2);
  r := public.request_withdrawal(500, '0712000002');                       -- 300 (paid) + 500 > 700
  out := out || jsonb_build_object('t','the brand''s daily automatic budget sends the rest to review', 'ok',
    r->>'status' = 'pending' AND (SELECT risk_flags ? 'auto_budget_reached' FROM withdrawal_requests WHERE id = (r->>'withdrawal_request_id')::uuid), 'got', r);
  w1 := (r->>'withdrawal_request_id')::uuid;
  r := public.cancel_my_withdrawal(w1);
  out := out || jsonb_build_object('t','the player cancels a pending request and gets the money back', 'ok', r->>'status' = 'cancelled' AND pg_temp.real(pb2) = 5000000 - 30000, 'got', r);

  -- ═════════ manual rail (brand C) ═════════
  PERFORM pg_temp.act(pc);
  r := public.request_withdrawal(600, '0712000003'); w1 := (r->>'withdrawal_request_id')::uuid;
  out := out || jsonb_build_object('t','brand C auto-approves but pays by hand (no B2C for its owner)', 'ok',
    r->>'status' = 'approved' AND NOT (r->>'automatic_payout')::boolean AND (SELECT rail FROM withdrawal_requests WHERE id = w1) = 'manual' AND pg_temp.claim_one() IS NULL, 'got', r);
  PERFORM pg_temp.act(fin);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_mark_paid(%L, 'CCC1PAID00')$$, w1));
  out := out || jsonb_build_object('t','brand B''s finance cannot touch brand C', 'ok', e = 'FORBIDDEN_SITE', 'got', e);
  PERFORM pg_temp.act(admc);
  e := pg_temp.err(format($$SELECT public.admin_withdrawal_pay_now(%L)$$, w1));
  out := out || jsonb_build_object('t','Pay now is refused without a B2C account', 'ok', e LIKE 'NO_PAYOUT_ACCOUNT%', 'got', e);
  r := public.admin_withdrawal_mark_paid(w1, 'CCC1PAID00');
  out := out || jsonb_build_object('t','brand C staff record the hand payment', 'ok', r->>'status' = 'completed', 'got', r);
  r := public.admin_payout_status(C);
  out := out || jsonb_build_object('t','payout status explains the brand''s rail', 'ok', r->>'rail' = 'manual' AND (r->'counts'->>'paid_today')::int = 1, 'got', r);

  -- ═════════ scope of the queue ═════════
  PERFORM pg_temp.act(fin);
  n := (SELECT count(*) FROM public.admin_list_withdrawals(NULL, 200, 0) x WHERE x.site_id <> B);
  out := out || jsonb_build_object('t','brand staff list only their brand''s withdrawals', 'ok', n = 0 AND (SELECT count(*) FROM public.admin_list_withdrawals(NULL, 200, 0)) >= 8, 'got', n);
  PERFORM pg_temp.act(pa1);
  PERFORM public.admin_set_acting_site(B);
  out := out || jsonb_build_object('t','a platform admin lists its acting brand', 'ok', (SELECT count(*) FROM public.admin_list_withdrawals(NULL, 200, 0) x WHERE x.site_id = B) >= 8
    AND (SELECT count(*) FROM public.admin_list_withdrawals(NULL, 200, 0) x WHERE x.site_id = C) = 0);
  r := public.admin_withdrawal_detail(w4);
  out := out || jsonb_build_object('t','detail shows every attempt and the audit trail', 'ok', jsonb_array_length(r->'attempts_list') = 1 AND r ? 'rail_now' AND NOT (r ? 'held_cents'), 'got', r->'attempts_list');

  -- ═════════ ledger + test callback + grants ═════════
  out := out || jsonb_build_object('t','ledger: hold + refunds explain the wallet exactly', 'ok',
    5000000 + (SELECT coalesce(sum(amount), 0) FROM ledger_entries WHERE user_id = pb AND balance_kind = 'real') = pg_temp.real(pb)
    AND 5000000 + (SELECT coalesce(sum(amount), 0) FROM ledger_entries WHERE user_id = pb2 AND balance_kind = 'real') = pg_temp.real(pb2),
    'got', jsonb_build_object('pb', pg_temp.real(pb), 'ledger', (SELECT sum(amount) FROM ledger_entries WHERE user_id = pb)));
  r := public.svc_b2c_balance_result(b2c, 'nope', true, 'x');
  out := out || jsonb_build_object('t','a forged balance result is refused', 'ok', r->>'result' = 'forbidden');
  r := public.svc_b2c_balance_result(b2c, public.svc_payout_token('balance:' || b2c), true, 'Connected. Utility account balance KES 12,345.00');
  out := out || jsonb_build_object('t','the balance result records the connection test', 'ok', r->>'result' = 'recorded' AND (SELECT test_message LIKE 'Connected%' FROM integrations WHERE id = b2c));
  out := out || jsonb_build_object('t','browsers cannot reach the payout internals', 'ok',
    NOT has_function_privilege('authenticated', 'public.svc_payout_claim(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_payout_callback(uuid, text, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.svc_payout_token(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_payout_rail(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.request_withdrawal(numeric, text)', 'EXECUTE')
    AND NOT has_table_privilege('authenticated', 'public.payout_attempts', 'SELECT')
    AND has_function_privilege('authenticated', 'public.cancel_my_withdrawal(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.svc_payout_claim(integer)', 'EXECUTE'));
  PERFORM pg_temp.act(pb);
  r := public.fn_public_payment_config(NULL);
  out := out || jsonb_build_object('t','players see whether payouts are automatic', 'ok', (r->>'payouts_automatic')::boolean, 'got', r->'payouts_automatic');

  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

pre = open(MIG).read() + "\n" if os.environ.get("APPLY_MIGRATION") == "1" else ""
status, body = run("BEGIN;\nSET LOCAL lock_timeout = '15s';\n" + pre + TESTS)
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
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'), ensure_ascii=False)[:700]}"))
print(f"\n{len(results) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
