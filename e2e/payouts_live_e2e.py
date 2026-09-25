#!/usr/bin/env python3
"""Automatic M-Pesa payouts, LIVE, end to end — no money moves.

Deploys e2e/mocks/daraja-mock.js as a throwaway Cloudflare Worker that behaves like Safaricom's
Daraja (OAuth, B2C v3, Transaction Status, Account Balance, asynchronous callbacks), points a
throwaway brand's own B2C account at it (the System-owner-only "API address"), and drives the real
production path: request → hold → auto approval → pg_net wake-up → payouts-worker → Daraja →
payout-result callback → settled; the Transaction Status backstop; the console (test connection,
queue, return money, mark paid, attempts); the player's view (status, cancel).
Everything it creates is removed at the end, including the mock Worker.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=…
  CF_ACCOUNT_ID=… CF_API_TOKEN=… CF_SUBDOMAIN=… [HOST_MAP=… PROXY_BYPASS=…] [SHOTS=dir] python3 e2e/payouts_live_e2e.py
"""
import json, os, secrets, sys, time, urllib.request, uuid
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge  # noqa: E402

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
CF_ACC, CF_TOK, CF_SUB = os.environ["CF_ACCOUNT_ID"], os.environ["CF_API_TOKEN"], os.environ["CF_SUBDOMAIN"]
SHOTS = os.environ.get("SHOTS")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
PASS, FAIL = [], []

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:500]}"))

def http(method, url, body=None, headers=None, raw=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    if "workers.dev" in url: h["User-Agent"] = UA
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, {"raw": t}
    except Exception as e:
        return 0, {"error": str(e)[:200]}

def sql(q):
    st, r = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})
    if st >= 300: raise RuntimeError(f"sql {st}: {str(r)[:300]}")
    return r

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(3)
MOCK = f"daraja-mock-{tag}"
MOCK_URL = f"https://{MOCK}.{CF_SUB}.workers.dev"
users, sessions, phones = {}, {}, {}

def make_user(k, slug=None, phone=None):
    phone = phone or ("2547" + str(secrets.randbelow(10**8)).zfill(8))
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    meta = {"username": f"py{k}{tag}", "phone": phone, **({"site_slug": slug} if slug else {})}
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": meta}, admin_h)
    if st >= 300: raise SystemExit(f"create {k}: {st} {u}")
    users[k] = u["id"]; phones[k] = phone
    sessions[k] = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})[1]

def as_user(k): return {"apikey": PUB, "Authorization": f"Bearer {sessions[k]['access_token']}"}
def rpc(k, name, body): return http("POST", f"{URL}/rest/v1/rpc/{name}", body, as_user(k))

def deploy_mock():
    boundary = "----mock" + secrets.token_hex(8)
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mocks", "daraja-mock.js")).read()
    meta = json.dumps({"main_module": "worker.js", "compatibility_date": "2026-06-17"})
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{meta}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n{src}\r\n"
            f"--{boundary}--\r\n").encode()
    st, r = http("PUT", f"https://api.cloudflare.com/client/v4/accounts/{CF_ACC}/workers/scripts/{MOCK}", None,
                 {"Authorization": f"Bearer {CF_TOK}", "Content-Type": f"multipart/form-data; boundary={boundary}"}, raw=body)
    if st >= 300: raise SystemExit(f"mock deploy {st}: {r}")
    http("POST", f"https://api.cloudflare.com/client/v4/accounts/{CF_ACC}/workers/scripts/{MOCK}/subdomain", {"enabled": True, "previews_enabled": False}, {"Authorization": f"Bearer {CF_TOK}"})
    for _ in range(40):
        st, r = http("GET", f"{MOCK_URL}/oauth/v1/generate?grant_type=client_credentials", None, {"Authorization": "Basic bW9jay1jazptb2NrLWNz"})
        if st == 200 and r.get("access_token"): return True
        time.sleep(3)
    return False

def until_sql(q, pred, secs):
    end = time.time() + secs
    r = None
    while time.time() < end:
        r = sql(q)
        if pred(r): return True, r
        time.sleep(3)
    return False, r

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

plat = site = None
try:
    print("mock Daraja")
    check("the Daraja stand-in is up", deploy_mock(), MOCK_URL)
    plat = sql(f"insert into platforms(slug, name) values ('py-{tag}', 'PY {tag}') returning id")[0]["id"]
    site = sql(f"insert into sites(slug, name, status, platform_id) values ('py-{tag}', 'Payout Brand {tag}', 'active', '{plat}') returning id")[0]["id"]
    make_user("pa"); make_user("fin")
    for d in "1234567":
        make_user(f"p{d}", f"py-{tag}", "2547" + str(secrets.randbelow(10**7)).zfill(7) + d)
    sql(f"update profiles set role='platform_admin', platform_id='{plat}' where id='{users['pa']}'")
    sql(f"update profiles set site_id='{site}', role='finance_admin' where id='{users['fin']}'; update wallets set site_id='{site}' where user_id='{users['fin']}'")
    ids_players = ",".join(f"'{users[f'p{d}']}'" for d in "1234567")
    sql(f"update wallets set real_balance = 100000, balance = (100000 + bonus_balance) / 100.0 where user_id in ({ids_players})")   # KES 1,000 each (+ the cached total)

    print("brand's own payment accounts")
    st, r = rpc("pa", "admin_integration_save", {"p_provider": "megapay", "p_scope_kind": "site", "p_scope_id": site, "p_config": {"email": f"py{tag}@pay.example"}, "p_secrets": {"api_key": "mp-e2e-" + tag + "-000000"}})
    sql(f"update integrations set test_ok = true where provider='megapay' and scope_kind='site' and scope_id='{site}'")
    st, r = rpc("pa", "admin_payment_scope_set", {"p_kind": "site", "p_id": site, "p_active": True})
    check("the brand's own payment scope goes live", st == 200 and r.get("active") is True, (st, r))
    st, r = rpc("pa", "admin_integration_save", {"p_provider": "mpesa_b2c", "p_scope_kind": "site", "p_scope_id": site,
        "p_config": {"shortcode": "600000", "initiator_name": "mockop", "command_id": "BusinessPayment"},
        "p_secrets": {"consumer_key": "mock-ck", "consumer_secret": "mock-cs", "security_credential": "MOCK-SECURITY-CREDENTIAL"}})
    check("a platform admin saves the brand's B2C account", st == 200 and "MOCK-SECURITY" not in json.dumps(r), (st, r))
    st, r = rpc("pa", "admin_integration_save", {"p_provider": "mpesa_b2c", "p_scope_kind": "site", "p_scope_id": site,
        "p_config": {"shortcode": "600000", "initiator_name": "mockop", "command_id": "BusinessPayment", "api_base": MOCK_URL}, "p_secrets": {}})
    check("…but cannot point it at another server (owner-only API address)", st >= 400 and "OWNER_ONLY_FIELD" in json.dumps(r), (st, r))
    # the System owner's step, done here in SQL: route this test account to the stand-in
    sql(f"update integrations set config = config || jsonb_build_object('api_base', '{MOCK_URL}') where provider='mpesa_b2c' and scope_kind='site' and scope_id='{site}'")
    st, r = rpc("fin", "admin_payout_status", {"p_site": site})
    check("an untested B2C account is not used: paid by hand for now", r.get("rail") == "manual", r)

    with sync_playwright() as p:
        b = p.chromium.launch(**launch)
        def open_as(k, path, w=1280):
            ctx = b.new_context(viewport={"width": w, "height": 1100}, service_workers="block")
            ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sessions[k]))}); }} catch (e) {{}}")
            ws_bridge.install(ctx)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(APP + path, wait_until="domcontentloaded")
            return ctx, pg, errs
        def until(pg, f, ms=15000):
            end = time.time() + ms / 1000
            while time.time() < end:
                ws_bridge.pump()
                try:
                    if f(): return True
                except Exception: pass
                pg.wait_for_timeout(150)
            return False
        def shot(pg, n):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, f"{n}.png"), full_page=True)

        print("test connection (console)")
        ctx, pg, errs = open_as("pa", f"/admin/brands/{site}?tab=payments")
        card = pg.get_by_test_id("int-b2c-site")
        until(pg, lambda: card.is_visible() and pg.get_by_test_id("int-b2c-site-test").is_enabled(), 25000)
        pg.get_by_test_id("int-b2c-site-test").click()
        ok = until(pg, lambda: "Connected" in pg.get_by_test_id("int-b2c-site").inner_text() and "Utility KES 99,000.00" in pg.get_by_test_id("int-b2c-site").inner_text(), 45000)
        check("Test connection: signed in, Safaricom's balance answer arrived on the callback", ok, pg.get_by_test_id("int-b2c-site").inner_text()[:400] if card.count() else "no card")
        check("the brand now pays out automatically", until(pg, lambda: "paid automatically by M-Pesa" in pg.get_by_test_id("payout-mode").inner_text(), 20000) or
              (pg.reload() or until(pg, lambda: "paid automatically by M-Pesa" in pg.get_by_test_id("payout-mode").inner_text(), 20000)))
        shot(pg, "b2c-connected")
        check("no page errors (platform admin)", not errs, errs[:3]); ctx.close()

        print("players withdraw")
        wid = {}
        for d in "123456":
            st, r = rpc(f"p{d}", "request_withdrawal", {"p_amount": 200, "p_phone": phones[f"p{d}"]})
            wid[d] = r.get("withdrawal_request_id")
            if d == "1": check("a small request is approved and goes out automatically; the amount is held", st == 200 and r.get("automatic_payout") is True
                               and sql(f"select real_balance b from wallets where user_id='{users['p1']}'")[0]["b"] == 80000, (st, r))
        q = lambda: {x["id"]: x for x in sql(f"select id, status, mpesa_receipt, attention_reason, recipient_name, (select real_balance from wallets where user_id = w.user_id) bal from withdrawal_requests w where site_id='{site}'")}
        ok, rows = until_sql(f"select count(*) filter (where status in ('completed','failed','needs_attention')) n from withdrawal_requests where site_id='{site}'", lambda r: r[0]["n"] >= 4, 120)
        rows = q()
        r1, r2, r3, r5 = rows.get(wid["1"], {}), rows.get(wid["2"], {}), rows.get(wid["3"], {}), rows.get(wid["5"], {})
        check("success: paid with Safaricom's receipt and the recipient name", r1.get("status") == "completed" and str(r1.get("mpesa_receipt", "")).startswith("MK") and "MOCK PLAYER" in str(r1.get("recipient_name")), r1)
        check("recipient cannot receive (2040): not paid, money back in the wallet", r2.get("status") == "failed" and r2.get("bal") == 100000, r2)
        check("low float (1): handed to staff with the money still held", r3.get("status") == "needs_attention" and "insufficient" in str(r3.get("attention_reason")) and r3.get("bal") == 80000, r3)
        check("refused at once (400): handed to staff, still held", r5.get("status") == "needs_attention" and "Invalid PartyB" in str(r5.get("attention_reason")), r5)
        r4, r6 = rows.get(wid["4"], {}), rows.get(wid["6"], {})
        check("accepted but never answered, and a 503: both wait (never resent)", r4.get("status") == "processing" and r6.get("status") == "processing"
              and sql(f"select count(*) n from payout_attempts where withdrawal_id in ('{wid['4']}','{wid['6']}')")[0]["n"] == 2, (r4, r6))
        att6 = sql(f"select status from payout_attempts where withdrawal_id='{wid['6']}'")[0]["status"]
        check("the 503 is recorded as an unknown outcome", att6 == "unknown", att6)
        # fast-forward the 3-minute wait instead of sleeping, then let the minute tick (or a wake-up) run the status queries
        sql(f"update payout_attempts set created_at = now() - interval '4 minutes' where withdrawal_id in ('{wid['4']}','{wid['6']}'); select public._payout_kick();")
        ok, _ = until_sql(f"select count(*) n from withdrawal_requests where id in ('{wid['4']}','{wid['6']}') and status = 'completed'", lambda r: r[0]["n"] == 2, 150)
        check("Transaction Status backstop: Safaricom confirms both were paid", ok, q().get(wid["4"]))

        print("finance console")
        ctx, pg, errs = open_as("fin", "/admin/withdrawals")
        check("the queue says payouts are automatic", until(pg, lambda: "Automatic M-Pesa payouts" in pg.get_by_test_id("payout-rail").inner_text(), 25000))
        pg.get_by_role("tab", name="Needs attention").click()
        check("Needs attention lists the two stuck payouts with their reasons", until(pg, lambda: pg.get_by_test_id(f"wd-{wid['3']}").is_visible() and pg.get_by_test_id(f"wd-{wid['5']}").is_visible()
              and "insufficient" in pg.get_by_test_id(f"reason-{wid['3']}").inner_text(), 15000))
        shot(pg, "needs-attention")
        pg.get_by_test_id(f"refund-{wid['3']}").click()
        pg.get_by_test_id("wd-dialog-input").fill("Float was low; please request again tomorrow")
        check("a definite failure needs no 'not paid' confirmation", pg.get_by_test_id("wd-confirm-unpaid").count() == 0)
        pg.get_by_test_id("wd-dialog-go").click()
        check("Return money: back in the player's wallet", until(pg, lambda: sql(f"select status, (select real_balance from wallets where user_id=w.user_id) b from withdrawal_requests w where id='{wid['3']}'")[0] == {"status": "failed", "b": 100000}, 15000))
        pg.get_by_test_id(f"markpaid-{wid['5']}").click()
        pg.get_by_test_id("wd-dialog-input").fill(f"HAND{tag}".upper()[:10])
        pg.get_by_test_id("wd-dialog-go").click()
        check("Mark paid with a receipt", until(pg, lambda: sql(f"select status, paid_manually from withdrawal_requests where id='{wid['5']}'")[0] == {"status": "completed", "paid_manually": True}, 15000))
        pg.get_by_role("tab", name="Paid").click()
        until(pg, lambda: pg.get_by_test_id(f"wd-{wid['1']}").is_visible(), 15000)
        pg.get_by_test_id(f"wd-{wid['1']}").click()
        check("the detail shows the M-Pesa attempt with its receipt", until(pg, lambda: "succeeded" in pg.get_by_test_id("wd-attempts").inner_text(), 10000))
        shot(pg, "detail")
        check("no page errors (finance)", not errs, errs[:3]); ctx.close()

        print("player")
        sql(f"update sites set config = config || '{{\"limits.auto_approve\":100}}'::jsonb where id='{site}'")
        st, r = rpc("p7", "request_withdrawal", {"p_amount": 900, "p_phone": phones["p7"]})
        check("above the brand's limit: waits for review", r.get("status") == "pending", r)
        ctx, pg, errs = open_as("p7", "/profile", 390)
        until(pg, lambda: pg.get_by_text("Payments", exact=True).count() > 0, 20000)
        pg.get_by_text("Payments", exact=True).first.click()
        btn = pg.get_by_test_id(f"cancel-withdrawal-{r.get('withdrawal_request_id')}")
        check("the player sees it and can cancel it", until(pg, lambda: btn.is_visible(), 15000))
        shot(pg, "player-withdrawals")
        btn.click()
        check("cancelled: the money is back", until(pg, lambda: sql(f"select real_balance b from wallets where user_id='{users['p7']}'")[0]["b"] == 100000, 15000)
              and until(pg, lambda: pg.get_by_test_id(f"withdrawal-status-{r.get('withdrawal_request_id')}").is_visible(), 10000))
        check("no page errors (player)", not errs, errs[:3]); ctx.close()
        b.close()

    led = sql(f"select bool_and(100000 + coalesce((select sum(amount) from ledger_entries l where l.user_id = w.user_id and balance_kind='real'), 0) = w.real_balance) ok from wallets w where user_id in ({ids_players})")[0]["ok"]
    check("every player's wallet equals the start plus the ledger", led is True, led)
finally:
    try: http("DELETE", f"https://api.cloudflare.com/client/v4/accounts/{CF_ACC}/workers/scripts/{MOCK}?force=true", None, {"Authorization": f"Bearer {CF_TOK}"})
    except Exception as e: print("mock cleanup:", e)
    if site:
        for v in sql(f"select s.value->>'vault_id' v from integrations i, jsonb_each(i.secrets) s where i.scope_kind='site' and i.scope_id='{site}'"):
            sql(f"delete from vault.secrets where id='{v['v']}'")
        sql(f"delete from payout_attempts where site_id='{site}'; delete from integrations where scope_kind='site' and scope_id='{site}'; delete from payment_scopes where scope_id='{site}'")
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"""delete from admin_audit_log where admin_id in ({ids}) or target_id in (select id::text from withdrawal_requests where user_id in ({ids}));
                delete from user_notifications where user_id in ({ids}); delete from withdrawal_requests where user_id in ({ids});
                delete from ledger_entries where user_id in ({ids}); delete from bonuses where user_id in ({ids}); delete from transactions where user_id in ({ids});
                delete from player_risk_scores where user_id in ({ids});""")
        for uid in users.values(): http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if site:
        sql(f"delete from ledger_entries where site_id='{site}'; delete from admin_audit_log where site_id='{site}'; delete from wallets where site_id='{site}'; delete from profiles where site_id='{site}'; delete from site_config_versions where site_id='{site}'; delete from sites where id='{site}'")
    if plat: sql(f"delete from platforms where id='{plat}'")
    st, _ = http("GET", f"https://api.cloudflare.com/client/v4/accounts/{CF_ACC}/workers/scripts/{MOCK}/settings", None, {"Authorization": f"Bearer {CF_TOK}"})
    print("  cleanup:", sql(f"select (select count(*) from auth.users where id in ({ids or 'null'})) u, (select count(*) from sites where slug='py-{tag}') s, (select count(*) from integrations where scope_id='{site}') i"), "mock worker:", "gone" if st == 404 else st)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
