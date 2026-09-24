#!/usr/bin/env python3
"""Live e2e for the deployed Mega Pay edge functions — no money moves, nothing is left behind.

Creates two throwaway accounts (a player and a brand admin) through the Auth Admin API, signs them
in, and drives every function over HTTPS. The only calls that reach Mega Pay are READ-ONLY status
queries (unknown ids / the credential check). No STK prompt is ever sent. Both accounts and all
their rows are deleted at the end, even on failure.

  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
  SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_REF=<ref> MEGAPAY_CRON_SECRET=… python3 supabase/tests/megapay_functions_live_e2e.py
"""
import json, os, secrets, sys, urllib.request

URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF, CRON = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"], os.environ["MEGAPAY_CRON_SECRET"]
FN = f"{URL}/functions/v1"
PASS, FAIL = [], []

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:220]}"))

def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw}

def sql(q):
    return http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})[1]

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(4)
users = {}
other_site = None

def make_user(kind):
    email, pw = f"mp-live-{kind}-{tag}@example.invalid", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"mplive{kind}{tag}", "phone": "2547" + str(secrets.randbelow(10**8)).zfill(8)}}, admin_h)
    if st >= 300: raise SystemExit(f"could not create {kind}: {st} {u}")
    users[kind] = u["id"]
    return email, pw

def sign_in(email, pw):
    st, t = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    if st >= 300: raise SystemExit(f"sign-in failed: {st} {t}")
    return t["access_token"]

try:
    pe, pp = make_user("player"); ae, ap = make_user("admin"); oe, op = make_user("otherbrand")
    sql(f"update profiles set role='admin' where id='{users['admin']}'")
    # A second, disabled brand with its own admin: must not see or sweep the first brand's deposits.
    other_site = sql(f"insert into sites(slug,name,status) values ('mp-e2e-{tag}','MP E2E {tag}','disabled') returning id")[0]["id"]
    sql(f"update profiles set role='admin', site_id='{other_site}' where id='{users['otherbrand']}'; update wallets set site_id='{other_site}' where user_id='{users['otherbrand']}'")
    P = {"apikey": PUB, "Authorization": f"Bearer {sign_in(pe, pp)}"}
    A = {"apikey": PUB, "Authorization": f"Bearer {sign_in(ae, ap)}"}
    O = {"apikey": PUB, "Authorization": f"Bearer {sign_in(oe, op)}"}

    st, r = http("POST", f"{FN}/megapay-admin", {"action": "status"}, A)
    check("admin: Mega Pay is configured for production on /backend/v1", st == 200 and r.get("configured") and r.get("env") == "production" and r.get("base_url", "").endswith("/backend/v1") and r.get("cron"), r)
    check("admin: the email is masked, the key is never returned", "•••" in str(r.get("email")) and "api_key" not in json.dumps(r).lower(), r)
    st, r = http("POST", f"{FN}/megapay-admin", {"action": "test"}, A)
    check("admin: live credential check — Mega Pay accepts the key and email", st == 200 and r.get("test", {}).get("ok") is True, r)
    st, r = http("POST", f"{FN}/megapay-admin", {"action": "status"}, P)
    check("a player cannot open the Mega Pay admin function", st == 403, (st, r))

    st, r = http("POST", f"{FN}/megapay-stk-push", {"amount": 50, "phone": "0712345678"}, P)
    check("deposit below the minimum is refused before Mega Pay (400 BELOW_MIN)", st == 400 and r.get("error") == "BELOW_MIN" and "100" in r.get("message", ""), (st, r))
    st, r = http("POST", f"{FN}/megapay-stk-push", {"amount": 500, "phone": "12345"}, P)
    check("an invalid phone is refused (400 INVALID_PHONE)", st == 400 and r.get("error") == "INVALID_PHONE", (st, r))
    st, r = http("POST", f"{FN}/megapay-stk-push", {"amount": 500.5, "phone": "0712345678"}, P)
    check("a fractional amount is refused (400 INVALID_AMOUNT)", st == 400 and r.get("error") == "INVALID_AMOUNT", (st, r))
    st, r = http("POST", f"{FN}/megapay-stk-push", {"amount": 500, "phone": "0712345678"}, A)
    check("an operator cannot deposit (400 OPERATOR_CANNOT_DEPOSIT)", st == 400 and r.get("error") == "OPERATOR_CANNOT_DEPOSIT", (st, r))
    rows = sql(f"select count(*) n from mpesa_stk_requests where user_id in ('{users['player']}','{users['admin']}')")
    check("refused deposits leave no rows", rows and rows[0]["n"] == 0, rows)

    # A pending deposit (inserted directly — no prompt is sent) exercises status + reconcile against the
    # live Mega Pay status API: the fake id is unknown to Mega Pay, so it must stay pending, never credit.
    ins = sql(f"select (fn_megapay_begin('{users['player']}','254711111111',100))->>'id' id")
    dep = ins[0]["id"]
    sql(f"select fn_megapay_attach('{dep}','e2e-{tag}','MR')")
    st, r = http("POST", f"{FN}/megapay-status", {"id": dep}, P)
    check("player status: an unpaid deposit stays pending (live Mega Pay query)", st == 200 and r.get("status") == "pending", (st, r))
    st, r = http("POST", f"{FN}/megapay-status", {"id": dep}, A)
    check("brand admin can check a player's deposit on their brand", st == 200 and r.get("status") == "pending", (st, r))
    bal = sql(f"select real_balance from wallets where user_id='{users['player']}'")[0]["real_balance"]
    check("nothing was credited", int(bal) == 0, bal)
    st, r = http("POST", f"{FN}/megapay-status", {"id": dep}, O)
    check("another brand's admin cannot see this brand's deposit (404)", st == 404, (st, r))
    st, r = http("POST", f"{FN}/megapay-status", {"id": "00000000-0000-0000-0000-000000000000"}, P)
    check("status of someone else's / unknown deposit is 404", st == 404, (st, r))
    sql(f"update mpesa_stk_requests set last_checked_at = now() - interval '1 minute' where id='{dep}'")
    before = sql(f"select check_count from mpesa_stk_requests where id='{dep}'")[0]["check_count"]
    st, r = http("POST", f"{FN}/megapay-reconcile", {}, O)
    after = sql(f"select check_count from mpesa_stk_requests where id='{dep}'")[0]["check_count"]
    check("another brand's admin sweep skips this brand's deposit and hides platform totals",
          st == 200 and after == before and r.get("orphans_closed") == 0 and r.get("marked_timeout") == 0, (st, r, before, after))
    st, r = http("POST", f"{FN}/megapay-reconcile", {}, {"x-cron-secret": CRON})
    check("reconcile (cron secret) checks the pending deposit and credits nothing", st == 200 and r.get("checked", 0) >= 1 and r.get("credited") == 0, (st, r))
    st, r = http("POST", f"{FN}/megapay-reconcile", {}, A)
    check("reconcile can be run by an admin", st == 200 and "checked" in r, (st, r))
    st, r = http("POST", f"{FN}/megapay-reconcile", {}, P)
    check("reconcile cannot be run by a player", st == 403, (st, r))
    st, r = http("POST", f"{FN}/megapay-callback", {"transaction_request_id": f"e2e-{tag}", "TransactionStatus": "Completed", "Amount": "99999"}, {})
    bal = sql(f"select real_balance from wallets where user_id='{users['player']}'")[0]["real_balance"]
    check("a forged 'Completed' callback credits nothing (Mega Pay is re-queried)", st == 200 and r.get("result") == "pending" and int(bal) == 0, (st, r, bal))
    pub = http("POST", f"{URL}/rest/v1/rpc/fn_megapay_settle", {"p_trid": f"e2e-{tag}", "p_outcome": "paid", "p_receipt": "X", "p_provider_status": "Completed"}, P)
    check("a player cannot call fn_megapay_settle directly", pub[0] in (401, 403, 404), pub)
    cfg = http("POST", f"{URL}/rest/v1/rpc/fn_public_payment_config", {}, {"apikey": PUB})
    check("anyone can read the public payment config (Mega Pay, KES 100–150,000)", cfg[0] == 200 and cfg[1].get("deposit_provider") == "megapay", cfg)
finally:
    for kind, uid in users.items():
        sql(f"delete from transactions where user_id='{uid}'; delete from mpesa_stk_requests where user_id='{uid}'")
        http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if other_site:
        sql(f"delete from wallets where site_id='{other_site}'; delete from profiles where site_id='{other_site}'; delete from sites where id='{other_site}'")
    left = sql(f"select (select count(*) from auth.users where email like 'mp-live-%-{tag}@example.invalid') u, (select count(*) from profiles where username like 'mplive%{tag}') p, (select count(*) from sites where slug='mp-e2e-{tag}') s")
    print(f"  cleanup: {left}")

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
