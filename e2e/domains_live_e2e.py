#!/usr/bin/env python3
"""Brand domains, LIVE, end to end (multi-brand step 5): a real platform admin connects a real
subdomain of a zone in the Cloudflare account to a throwaway brand, and we watch it go live.

  * the brand-domains function refuses anonymous callers, brand owners and non-owners for owner actions
  * add → Cloudflare zone found → Worker custom domain attached (checked in Cloudflare itself)
  * "Check now" until https://<host>/__brand answers with THIS brand, then the page wears its name
  * the console shows the domain live with its steps; options and plain-word errors in the browser
  * a secondary domain can send visitors to the primary (a real 301 from the edge)
  * the cron sweep is refused without its Vault secret and runs with it
  * remove → detached from Cloudflare and gone from the brand
Everything created is removed at the end (users, brand, platform, the Cloudflare attachment).

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=…
  CF_ACCOUNT_ID=… CF_API_TOKEN=… [ZONE=printpesa.com] [HOST_MAP=… PROXY_BYPASS=…] [SHOTS=dir] python3 e2e/domains_live_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge  # noqa: E402

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
CF_ACC, CF_TOK = os.environ["CF_ACCOUNT_ID"], os.environ["CF_API_TOKEN"]
ZONE = os.environ.get("ZONE", "printpesa.com")
SHOTS = os.environ.get("SHOTS")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
PASS, FAIL = [], []

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:400]}"))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
plain = urllib.request.build_opener(NoRedirect)

def http(method, url, body=None, headers=None, follow=True):
    h = {"Content-Type": "application/json", **(headers or {})}
    if not url.startswith(("https://api.supabase.com", URL, "https://api.cloudflare.com")): h["User-Agent"] = UA
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method, headers=h)
    try:
        with (urllib.request.urlopen(req, timeout=60) if follow else plain.open(req, timeout=60)) as r:
            t = r.read().decode(errors="replace")
            try: return r.status, (json.loads(t) if t else {}), dict(r.headers)
            except Exception: return r.status, {"raw": t}, dict(r.headers)
    except urllib.error.HTTPError as e:
        t = e.read().decode(errors="replace")
        try: return e.code, json.loads(t), dict(e.headers)
        except Exception: return e.code, {"raw": t}, dict(e.headers)
    except Exception as e:
        return 0, {"error": str(e)[:200]}, {}

def sql(q):
    st, r, _ = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})
    if st >= 300: raise RuntimeError(f"sql {st}: {str(r)[:300]}")
    return r

def cf(method, path):
    return http(method, f"https://api.cloudflare.com/client/v4{path}", None, {"Authorization": f"Bearer {CF_TOK}"})[1]

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(3)
HOST = f"e2e-{tag}.{ZONE}"
users, sessions = {}, {}

def make_user(k):
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u, _ = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": {"username": f"dm{k}{tag}", "phone": phone}}, admin_h)
    if st >= 300: raise SystemExit(f"create {k}: {st} {u}")
    users[k] = u["id"]
    sessions[k] = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})[1]

def fn(k, body, extra=None):
    h = {"apikey": PUB, **({"Authorization": f"Bearer {sessions[k]['access_token']}"} if k else {}), **(extra or {})}
    st, r, _ = http("POST", f"{URL}/functions/v1/brand-domains", body, h)
    return st, r

def attached(host):
    r = cf("GET", f"/accounts/{CF_ACC}/workers/domains?hostname={host}")
    return [w for w in (r.get("result") or []) if w.get("hostname") == host]

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

plat = site_b = None
try:
    for k in ("pa", "own"): make_user(k)
    plat = sql(f"insert into platforms(slug, name) values ('dm-{tag}', 'DM {tag}') returning id")[0]["id"]
    site_b = sql(f"insert into sites(slug, name, status, platform_id) values ('dm-{tag}', 'Domain Brand {tag}', 'active', '{plat}') returning id")[0]["id"]
    sql(f"update profiles set role='platform_admin', platform_id='{plat}' where id='{users['pa']}'")
    sql(f"update profiles set site_id='{site_b}' where id='{users['own']}'; update wallets set site_id='{site_b}' where user_id='{users['own']}'; update profiles set role='super_admin' where id='{users['own']}'")

    print("gatekeeping")
    st, r = fn(None, {"action": "add", "site_id": site_b, "hostname": HOST})
    check("anonymous callers are refused", st == 401, (st, r))
    st, r = fn("own", {"action": "add", "site_id": site_b, "hostname": HOST})
    check("a brand owner cannot connect domains", st == 400 and r.get("error") == "FORBIDDEN", (st, r))
    for a in ("test", "unassigned", "adopt"):
        st, r = fn("pa", {"action": a, "site_id": site_b, "hostname": ZONE})
        check(f"owner-only action '{a}' is refused to a platform admin", st == 403, (st, r))
    st, r = fn("pa", {"action": "add", "site_id": site_b, "hostname": "not a domain"})
    check("garbage comes back in plain words", st == 400 and r.get("error") == "INVALID_DOMAIN" and "mybrand.com" in r.get("message", ""), r)
    st, r = fn("pa", {"action": "sweep"})
    check("the sweep is refused without the cron secret", st == 403, (st, r))

    print("connect", HOST)
    st, r = fn("pa", {"action": "add", "site_id": site_b, "hostname": f"https://{HOST.upper()}/"})
    d = r.get("domain") or {}
    check("add: saved, zone found, attached to the Worker", st == 200 and d.get("hostname") == HOST and d.get("stage") in ("ssl", "live") and HOST in (d.get("worker_domains") or {}), (st, r))
    w = attached(HOST)
    check("Cloudflare itself shows the custom domain on the app's Worker", len(w) == 1 and w[0].get("service") == "aviatorv2", w)
    live = d.get("stage") == "live"
    deadline = time.time() + 600
    while not live and time.time() < deadline:
        time.sleep(20)
        st, r = fn("pa", {"action": "check", "hostname": HOST})
        d = r.get("domain") or d
        live = d.get("stage") == "live"
        print(f"    … {d.get('stage')} {str(d.get('last_error') or '')[:100]}")
    check("the domain goes live (HTTPS answers for this brand)", live, d)
    st, r, _ = http("GET", f"https://{HOST}/__brand")
    check("https://<host>/__brand names this brand", st == 200 and r.get("site_id") == site_b and r.get("matched") == "domain", (st, r))
    st, r, _ = http("GET", f"https://{HOST}/")
    title = re.search(r"<title>([^<]*)</title>", r.get("raw", ""))
    # the edge caches the host's brand for 60 s; a fresh subdomain has no stale entry
    check("the page on the new domain wears the brand's name", bool(title) and title.group(1) == f"Domain Brand {tag}", title.group(1) if title else r)
    check("the brand's primary domain is the new one", sql(f"select primary_domain from sites where id='{site_b}'")[0]["primary_domain"] == HOST)

    print("sweep")
    cron = sql("select decrypted_secret s from vault.decrypted_secrets where name='domains_cron_secret'")[0]["s"]
    sql(f"update site_domains set next_check_at = now() - interval '1 minute' where hostname='{HOST}'")
    st, r, _ = http("POST", f"{URL}/functions/v1/brand-domains", {"action": "sweep"}, {"x-cron-secret": cron, "apikey": PUB})
    check("the cron sweep re-verifies a due domain", st == 200 and (r.get("swept") or {}).get(HOST) == "live", (st, r))
    del cron

    print("console")
    with sync_playwright() as p:
        b = p.chromium.launch(**launch)
        ctx = b.new_context(viewport={"width": 1280, "height": 1000}, service_workers="block")
        ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sessions['pa']))}); }} catch (e) {{}}")
        ws_bridge.install(ctx)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        def until(f, ms=15000):
            end = time.time() + ms / 1000
            while time.time() < end:
                ws_bridge.pump()
                try:
                    if f(): return True
                except Exception: pass
                time.sleep(0.1)
            return False
        def shot(n):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, f"{n}.png"), full_page=True)
        pg.goto(f"{APP}/admin/brands/{site_b}?tab=domains", wait_until="domcontentloaded")
        card = pg.get_by_test_id(f"domain-{HOST}")
        check("the Domains tab lists the domain as Live", until(lambda: card.is_visible() and "Live" in card.inner_text(), 25000), pg.content()[:300])
        check("…with all five steps done", until(lambda: pg.get_by_test_id(f"steps-{HOST}").locator("[aria-current]").count() == 0))
        check("…and no www option on a subdomain", pg.get_by_test_id(f"opt-www-{HOST}").count() == 0)
        shot("domains-live")
        pg.get_by_test_id("domain-input").fill("bad domain")
        check("the form says when a domain can't be served", until(lambda: "Not a domain we can serve" in pg.get_by_test_id("domains-tab").inner_text(), 5000))
        pg.get_by_test_id("domain-input").fill(f"www.{ZONE}")
        check("the form previews what will be connected", until(lambda: f"Will connect {ZONE} and www.{ZONE}" in pg.get_by_test_id("domains-tab").inner_text(), 5000))
        pg.get_by_test_id("domain-input").fill("")
        # a hand-connected (unmanaged) secondary domain as primary, to test the redirect for real
        other = f"dm-{tag}-primary.com"
        sql(f"insert into site_domains(hostname, site_id, is_primary, stage, managed, include_www) values ('{other}', '{site_b}', false, 'live', false, false)")
        pg.reload(wait_until="domcontentloaded")
        until(lambda: pg.get_by_test_id(f"primary-{other}").is_visible(), 20000)
        pg.get_by_test_id(f"primary-{other}").click()
        check("make another domain primary", until(lambda: "Primary" in pg.get_by_test_id(f"domain-{other}").inner_text(), 10000))
        pg.get_by_test_id(f"opt-primary-redir-{HOST}").click()
        check("switch: send visitors to the primary", until(lambda: sql(f"select redirect_to_primary r from site_domains where hostname='{HOST}'")[0]["r"] is True, 10000))
        redirected = False; end = time.time() + 150      # the edge's 60 s brand cache must expire
        while time.time() < end and not redirected:
            st, _, h = http("GET", f"https://{HOST}/legal/terms?x=1", follow=False)
            redirected = st == 301 and h.get("Location") == f"https://{other}/legal/terms?x=1"
            if not redirected: time.sleep(10)
        check("the edge sends the secondary domain to the primary (301, path kept)", redirected, (st, h.get("Location")))
        st, r, _ = http("GET", f"https://{HOST}/__brand")
        check("…but the health probe is never redirected", st == 200 and r.get("site_id") == site_b, (st, r))

        pg.get_by_test_id(f"remove-{HOST}").click()
        pg.get_by_role("button", name="Remove domain").click()
        check("remove from the console", until(lambda: pg.get_by_test_id(f"domain-{HOST}").count() == 0, 20000))
        check("…disconnects it in Cloudflare", until(lambda: len(attached(HOST)) == 0, 20000), attached(HOST))
        check("…and the row is gone", sql(f"select count(*) n from site_domains where hostname='{HOST}'")[0]["n"] == 0)
        check("no page errors", not errs, errs[:3])
        ctx.close(); b.close()
finally:
    # Cloudflare first: never leave an e2e hostname attached
    for w in attached(HOST):
        cf("DELETE", f"/accounts/{CF_ACC}/workers/domains/{w['id']}")
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"delete from admin_audit_log where admin_id in ({ids})")
        for uid in users.values(): http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if site_b:
        sql(f"delete from site_domains where site_id='{site_b}'; delete from admin_audit_log where site_id='{site_b}'; delete from wallets where site_id='{site_b}'; delete from profiles where site_id='{site_b}'; delete from site_config_versions where site_id='{site_b}'; delete from sites where id='{site_b}'")
    if plat:
        sql(f"delete from admin_audit_log where target_id='{plat}'; delete from platforms where id='{plat}'")
    print("  cleanup:", sql(f"select (select count(*) from auth.users where id in ({ids or 'null'})) u, (select count(*) from sites where slug like '%{tag}%') s, (select count(*) from site_domains where hostname like '%{tag}%') d"), "cf:", len(attached(HOST)))

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
