#!/usr/bin/env python3
"""Per-brand payment accounts, LIVE (multi-brand step 6): a real platform admin gives a throwaway
brand its own Mega Pay account in the console, tests it, takes it live and back, while the brand
owner only watches. No money moves and no M-Pesa prompt is ever sent: the only calls that reach
Mega Pay are read-only credential checks with a deliberately wrong key.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=…
  [HOST_MAP=… PROXY_BYPASS=…] [SHOTS=dir] python3 e2e/payments_scope_live_e2e.py
"""
import json, os, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge  # noqa: E402

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
SHOTS = os.environ.get("SHOTS")
PASS, FAIL = [], []
FAKE_KEY = "mp-e2e-wrong-key-" + secrets.token_hex(6)

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:400]}"))

def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, {"raw": t}

def sql(q):
    st, r = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})
    if st >= 300: raise RuntimeError(f"sql {st}: {str(r)[:300]}")
    return r

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(3)
users, sessions = {}, {}

def make_user(k, slug=None):
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    meta = {"username": f"ps{k}{tag}", "phone": phone, **({"site_slug": slug} if slug else {})}
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": meta}, admin_h)
    if st >= 300: raise SystemExit(f"create {k}: {st} {u}")
    users[k] = u["id"]
    sessions[k] = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})[1]

def as_user(k): return {"apikey": PUB, "Authorization": f"Bearer {sessions[k]['access_token']}"}
def fn(k, name, body): return http("POST", f"{URL}/functions/v1/{name}", body, as_user(k))
def rpc(k, name, body): return http("POST", f"{URL}/rest/v1/rpc/{name}", body, as_user(k))

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

plat = site = None
try:
    plat = sql(f"insert into platforms(slug, name) values ('ps-{tag}', 'PS {tag}') returning id")[0]["id"]
    site = sql(f"insert into sites(slug, name, status, platform_id) values ('ps-{tag}', 'Pay Brand {tag}', 'active', '{plat}') returning id")[0]["id"]
    for k in ("pa", "own", "fin"): make_user(k)
    make_user("pl", f"ps-{tag}")
    sql(f"update profiles set role='platform_admin', platform_id='{plat}' where id='{users['pa']}'")
    sql(f"update profiles set site_id='{site}' where id in ('{users['own']}','{users['fin']}'); update wallets set site_id='{site}' where user_id in ('{users['own']}','{users['fin']}')")
    sql(f"update profiles set role='super_admin' where id='{users['own']}'; update profiles set role='finance_admin' where id='{users['fin']}'")

    print("API")
    st, r = rpc("pa", "admin_integration_save", {"p_provider": "megapay", "p_scope_kind": "site", "p_scope_id": site, "p_config": {"email": "brand@pay.example", "env": "sandbox"}, "p_secrets": {"api_key": FAKE_KEY}})
    check("a platform admin cannot pick the sandbox (owner-only field)", st >= 400 and "OWNER_ONLY_FIELD" in str(r), (st, r))
    st, r = fn("fin", "megapay-admin", {"action": "status", "site_id": site})
    check("finance staff see the brand uses the System's account", st == 200 and r.get("scope") == "global" and r.get("owner") == "System", (st, r))
    st, r = fn("own", "megapay-admin", {"action": "test", "scope_kind": "site", "scope_id": site})
    check("the brand owner cannot test/manage the brand's account", st == 403, (st, r))
    st, r = rpc("pl", "fn_public_payment_config", {})
    check("the brand's players can deposit (System account)", st == 200 and r.get("deposits") is True, r)

    print("console")
    with sync_playwright() as p:
        b = p.chromium.launch(**launch)
        def open_as(k, path):
            ctx = b.new_context(viewport={"width": 1280, "height": 1100}, service_workers="block")
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
                pg.wait_for_timeout(100)
            return False
        def shot(pg, n):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, f"{n}.png"), full_page=True)

        ctx, pg, errs = open_as("pa", f"/admin/brands/{site}?tab=payments")
        card = pg.get_by_test_id("int-megapay-site")
        check("Payments tab: who receives the money", until(pg, lambda: "System account" in pg.get_by_test_id("payment-owner").inner_text(), 25000))
        check("…the environment is locked to production for a platform admin", until(pg, lambda: pg.get_by_test_id("int-megapay-site-cfg-env").is_disabled())
              and pg.get_by_test_id("int-megapay-site-cfg-env").input_value() == "production")
        pg.get_by_test_id("int-megapay-site-cfg-email").fill(f"brand{tag}@pay.example")
        pg.get_by_test_id("int-megapay-site-secret-api_key").fill(FAKE_KEY)
        pg.get_by_test_id("int-megapay-site-save").click()
        check("save: the key is stored and only a hint comes back", until(pg, lambda: f"Saved ••••{FAKE_KEY[-4:]}" in pg.get_by_test_id("int-megapay-site").inner_text(), 15000))
        row = sql(f"select secrets->'api_key'->>'vault_id' v, config from integrations where provider='megapay' and scope_kind='site' and scope_id='{site}'")
        check("…in Vault, not in the table", bool(row) and FAKE_KEY not in json.dumps(row) and
              sql(f"select decrypted_secret s from vault.decrypted_secrets where id='{row[0]['v']}'")[0]["s"] == FAKE_KEY)
        check("go live is blocked until the connection test passes", pg.get_by_test_id("go-live-on").is_disabled())
        until(pg, lambda: pg.get_by_test_id("int-megapay-site-test").is_enabled(), 5000)
        pg.get_by_test_id("int-megapay-site-test").click()
        check("Test connection asks Mega Pay (read-only) and shows the refusal", until(pg, lambda: "Failing" in pg.get_by_test_id("int-megapay-site").inner_text(), 30000),
              pg.get_by_test_id("int-megapay-site").inner_text()[:400])
        shot(pg, "payments-failing")
        # stand in for a passing test with a real key (never used here): mark the account tested
        sql(f"update integrations set test_ok = true, test_message = 'e2e', tested_at = now() where provider='megapay' and scope_kind='site' and scope_id='{site}'")
        pg.reload(wait_until="domcontentloaded")
        check("with a passed test, go live is offered", until(pg, lambda: pg.get_by_test_id("go-live-on").is_enabled(), 20000))
        pg.get_by_test_id("go-live-on").click(); pg.get_by_test_id("go-live-on-confirm").click()
        check("go live: the brand now uses its own account", until(pg, lambda: "Live" in pg.get_by_test_id("go-live").inner_text(), 10000)
              and sql(f"select public.fn_payment_owner('{site}')->>'kind' k")[0]["k"] == "site")
        shot(pg, "payments-live")
        st, r = fn("fin", "megapay-admin", {"action": "status", "site_id": site})
        check("Deposits page source: the brand's own saved account (masked)", st == 200 and r.get("scope") == "site" and r.get("source") == "saved" and r.get("email") == "b•••@pay.example", (st, r))
        st, r = rpc("pl", "fn_public_payment_config", {})
        check("players can still deposit (into the brand's account)", r.get("deposits") is True, r)
        st, r = rpc("pa", "admin_integration_save", {"p_provider": "megapay", "p_scope_kind": "site", "p_scope_id": site, "p_config": {"email": f"brand{tag}@pay.example"}, "p_secrets": {}, "p_enabled": False})
        check("a live account cannot be switched off", st >= 400 and "SCOPE_LIVE" in str(r), (st, r))

        ctx2, pg2, errs2 = open_as("own", f"/admin/brands/{site}?tab=payments")
        check("the brand owner sees its own account is live, read-only", until(pg2, lambda: "own" in pg2.get_by_test_id("payment-owner").inner_text(), 20000)
              and pg2.get_by_test_id("int-megapay-site").count() == 0 and pg2.get_by_test_id("go-live-on").count() == 0 and pg2.get_by_test_id("go-live-off").count() == 0)
        check("no page errors (brand owner)", not errs2, errs2[:3]); ctx2.close()

        pg.get_by_test_id("go-live-off").click(); pg.get_by_test_id("go-live-off-confirm").click()
        check("stop: the brand is back on the System's account", until(pg, lambda: "Draft" in pg.get_by_test_id("go-live").inner_text(), 10000)
              and sql(f"select public.fn_payment_owner('{site}')->>'kind' k")[0]["k"] == "global")
        pg.goto(APP + "/admin/payment-accounts", wait_until="domcontentloaded")
        check("Payment accounts: the platform's page lists its brand and where its money goes",
              until(pg, lambda: f"Pay Brand {tag}" in pg.get_by_test_id("platform-brands").inner_text() and "System account" in pg.get_by_test_id("platform-brands").inner_text(), 20000))
        shot(pg, "payment-accounts")
        check("no page errors (platform admin)", not errs, errs[:3])
        ctx.close(); b.close()
    check("going live and stopping are audited", sql(f"select count(*) n from admin_audit_log where site_id='{site}' and action in ('payment_scope_live','payment_scope_off')")[0]["n"] == 2)
finally:
    if site or plat:
        vids = sql(f"select secrets->'api_key'->>'vault_id' v from integrations where (scope_kind='site' and scope_id='{site}') or (scope_kind='platform' and scope_id='{plat}')")
        for v in vids:
            if v.get("v"): sql(f"delete from vault.secrets where id='{v['v']}'")
        sql(f"delete from integrations where (scope_kind='site' and scope_id='{site}') or (scope_kind='platform' and scope_id='{plat}'); delete from payment_scopes where scope_id in ('{site}','{plat}')")
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"""delete from admin_audit_log where admin_id in ({ids}) or target_id in (select id::text from profiles where id in ({ids}));
                delete from ledger_entries where user_id in ({ids}); delete from bonuses where user_id in ({ids});
                delete from transactions where user_id in ({ids}); delete from referrals where player_id in ({ids});""")
        for uid in users.values(): http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if site:
        sql(f"delete from ledger_entries where site_id='{site}'; delete from admin_audit_log where site_id='{site}'; delete from wallets where site_id='{site}'; delete from profiles where site_id='{site}'; delete from site_config_versions where site_id='{site}'; delete from sites where id='{site}'")
    if plat: sql(f"delete from platforms where id='{plat}'")
    print("  cleanup:", sql(f"select (select count(*) from auth.users where id in ({ids or 'null'})) u, (select count(*) from sites where slug='ps-{tag}') s, (select count(*) from integrations where scope_id in ('{site}','{plat}')) i, (select count(*) from vault.secrets where name like 'integration:%') vault_total"))

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
