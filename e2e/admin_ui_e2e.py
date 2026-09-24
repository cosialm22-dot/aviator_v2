#!/usr/bin/env python3
"""Browser e2e for the admin dashboard (phase 1): shell, brand scope, Overview, Players, Audit,
role-by-role access. Brand tiers run LIVE on a throwaway brand with throwaway staff and players;
the platform-owner tier runs against mocked API answers (there is exactly one real platform
owner account, and this test never signs in as it). Everything created is deleted at the end.

  npm run build && npx vite preview --port 4173
  APP_URL=http://aviator.test/ HOST_MAP="MAP aviator.test 127.0.0.1:4173" PROXY_BYPASS="*.test" \
  SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… \
  python3 e2e/admin_ui_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
STORAGE_KEY = f"sb-{REF}-auth-token"
SHOTS = os.environ.get("SHOTS")
PASS, FAIL = [], []

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:300]}"))

def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); page.screenshot(path=os.path.join(SHOTS, name + ".png"))

def dump(name, lines):
    """Diagnostics for a failed check: written next to the screenshots when SHOTS is set."""
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); open(os.path.join(SHOTS, name + ".log"), "w").write("\n".join(lines))
    return len(lines)

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
    st, r = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})
    if st >= 300: raise RuntimeError(f"sql {st}: {str(r)[:300]}")
    return r

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(3)
users, sessions = {}, {}
site_b = None

def make_user(kind):
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"adm{kind}{tag}", "phone": phone}}, admin_h)
    if st >= 300: raise SystemExit(f"could not create {kind}: {st} {u}")
    users[kind] = u["id"]
    st, t = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    if st >= 300: raise SystemExit(f"sign-in failed: {st} {t}")
    sessions[kind] = t
    return phone

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

def new_page(browser, session, w=1440, h=950):
    # Block the PWA service worker: its fetches would bypass the mocked routes.
    ctx = browser.new_context(viewport={"width": w, "height": h}, service_workers="block")
    ctx.add_init_script(f"try {{ localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(json.dumps(session))}); if (!sessionStorage.getItem('e2e-init')) {{ localStorage.removeItem('admin:scope'); localStorage.removeItem('admin:sidebar-collapsed'); sessionStorage.setItem('e2e-init', '1'); }} }} catch (e) {{}}")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page, errors

def until(fn, ms=15000):
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.2)
    return False

def nav_labels(page):
    return [t.strip() for t in page.locator("aside nav a").all_inner_texts()]

try:
    site_b = sql(f"insert into sites(slug,name,status) values ('adm-e2e-{tag}','Brand {tag.upper()}','disabled') returning id")[0]["id"]
    for k in ["admin", "support", "finance", "p1", "p2"]: make_user(k)
    make_user("pa")  # a player on the default brand — must never show up for brand B
    ids_b = ",".join(f"'{users[k]}'" for k in ["admin", "support", "finance", "p1", "p2"])
    sql(f"""update profiles set site_id='{site_b}' where id in ({ids_b}); update wallets set site_id='{site_b}' where user_id in ({ids_b});
            update profiles set role='admin' where id='{users['admin']}'; update profiles set role='support' where id='{users['support']}';
            update profiles set role='finance_admin' where id='{users['finance']}';""")
    sql(f"""insert into transactions(user_id,type,amount,payment_method,reference,description,status,site_id)
            values ('{users['p1']}','deposit',500,'mpesa','ADME2E{tag.upper()}','e2e','completed','{site_b}')""")
    st, r = http("POST", f"{URL}/rest/v1/rpc/admin_set_ban", {"p_user_id": users["p2"], "p_ban": True, "p_reason": "e2e ban"},
                 {"apikey": PUB, "Authorization": f"Bearer {sessions['admin']['access_token']}"})
    check("setup: brand admin bans a player through the API (audited)", st < 300, (st, r))
    brand_name = f"Brand {tag.upper()}"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch)

        # ───────────── brand admin (live) ─────────────
        ctx, page, errors = new_page(browser, sessions["admin"])
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        check("admin: Overview opens", until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 20000))
        check("admin: the workspace names the brand", until(lambda: brand_name in page.get_by_test_id("workspace-scope").inner_text(), 10000),
              page.get_by_test_id("workspace-scope").inner_text())
        check("admin: header shows the brand, no switcher", page.get_by_test_id("scope-label").is_visible() and page.get_by_test_id("scope-switcher").count() == 0)
        check("admin: today's deposits come from this brand only (KSh 500)", until(lambda: "KSh 500" in page.get_by_test_id("kpi-deposits").inner_text(), 15000),
              page.get_by_test_id("kpi-deposits").inner_text())
        check("admin: charts render", page.get_by_test_id("money-chart").locator("svg").count() == 1)
        page.get_by_test_id("money-chart").locator("svg g").last.hover()
        check("admin: hovering a day shows its figures", until(lambda: page.get_by_test_id("money-chart-tip").is_visible(), 3000))
        labels = nav_labels(page)
        check("admin: grouped navigation without platform or settings items",
              "Brands & controls" not in labels and "Settings" not in labels and "Audit log" in labels and "Players" in labels, labels)
        groups = page.locator("aside nav").inner_text()
        check("admin: nav groups are labelled", all(g in groups.upper() for g in ["MONEY", "PLAYERS", "GROWTH", "ADMINISTRATION"]), groups[:200])
        shot(page, "admin-overview")

        page.get_by_role("link", name="Players").first.click()
        check("admin: Players lists exactly this brand's 2 players", until(lambda: "1–2 of 2 accounts" in page.get_by_text(re.compile("of 2 accounts")).inner_text(), 15000))
        page.get_by_label("Search players").fill(f"admpa{tag}")
        check("admin: another brand's player cannot be found", until(lambda: page.get_by_text("No accounts match").is_visible(), 10000))
        page.get_by_label("Search players").fill("")
        page.get_by_role("tab", name="Banned").click()
        check("admin: Banned filter shows the banned player", until(lambda: page.get_by_test_id("player-row").count() == 1 and "Banned" in page.get_by_test_id("player-row").first.inner_text(), 10000))
        check("admin: filters live in the URL (shareable)", "status=banned" in page.url, page.url)
        page.get_by_test_id("player-row").first.click()
        check("admin: a row opens the player", until(lambda: f"admp2{tag}" in page.locator("main").inner_text() and "/admin/users/" in page.url, 15000))
        shot(page, "admin-player")

        page.goto(APP + "/admin/audit", wait_until="domcontentloaded")
        check("admin: Audit log shows the ban with who and why", until(lambda: page.get_by_test_id("audit-row").count() >= 1
              and f"@adm" in page.get_by_test_id("audit-table").inner_text(), 15000), page.locator("main").inner_text()[:300])
        shot(page, "admin-audit")

        page.keyboard.press("Control+k")
        check("admin: Ctrl+K opens the jump menu", until(lambda: page.get_by_role("dialog", name="Command palette").is_visible(), 3000))
        page.get_by_label("Search admin sections").fill("deposits")
        page.keyboard.press("Enter")
        check("admin: jump menu navigates", until(lambda: page.get_by_role("heading", name="Deposits").is_visible(), 10000))
        w0 = page.locator("aside").bounding_box()["width"]
        page.get_by_role("button", name="Collapse sidebar").click()
        page.wait_for_timeout(400)
        w1 = page.locator("aside").bounding_box()["width"]
        check("admin: the sidebar collapses to an icon rail", w1 < 90 < w0, (w0, w1))
        page.get_by_role("button", name="Expand sidebar").click()
        # Leaving a page that holds a realtime channel must not stall the next page's requests.
        page.get_by_role("link", name="Withdrawals").first.click()
        until(lambda: page.get_by_role("heading", name=re.compile("Withdrawals")).first.is_visible(), 15000)
        page.wait_for_timeout(1500)
        page.get_by_role("link", name="Players").first.click()
        check("admin: pages still load after leaving a live-updating page", until(lambda: page.get_by_test_id("players-table").is_visible(), 15000))
        check("admin: no page errors", not errors, errors[:3])
        ctx.close()

        # phone
        ctx, page, errors = new_page(browser, sessions["admin"], 390, 844)
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 20000)
        page.wait_for_timeout(1200)
        check("admin (phone): no sideways scroll on Overview", page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 1)
        page.get_by_role("button", name="Open navigation menu").click()
        check("admin (phone): the menu opens as a drawer", until(lambda: page.locator("aside").bounding_box()["x"] >= -1, 3000))
        shot(page, "admin-phone-drawer")
        page.locator("aside").get_by_role("link", name="Players").click()
        check("admin (phone): picking a page closes the drawer", until(lambda: page.locator("aside").bounding_box()["x"] < -100, 3000))
        until(lambda: page.get_by_test_id("players-table").is_visible(), 10000)
        check("admin (phone): Players table scrolls inside its card, not the page", page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 1)
        ctx.close()

        # ───────────── support (live) ─────────────
        ctx, page, errors = new_page(browser, sessions["support"])
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 20000)
        check("support: sees Overview, Deposits, Players, Risk only", nav_labels(page) == ["Overview", "Deposits", "Players", "Risk & fraud"], nav_labels(page))
        page.goto(APP + f"/admin/users/{users['p1']}", wait_until="domcontentloaded")
        check("support: can open a player (server now allows support to read)", until(lambda: f"admp1{tag}" in page.locator("main").inner_text(), 15000))
        check("support: the player page is view-only", page.get_by_test_id("view-only").is_visible())
        page.goto(APP + "/admin/audit", wait_until="domcontentloaded")
        check("support: the audit log route is refused (Overview shown instead)", until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 10000)
              and page.get_by_role("heading", name="Audit log").count() == 0, page.evaluate("location.pathname"))
        ctx.close()

        # ───────────── finance (live) ─────────────
        ctx, page, errors = new_page(browser, sessions["finance"])
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 20000)
        check("finance: sees Overview and the money pages", nav_labels(page) == ["Overview", "Deposits", "Withdrawals", "Finance"], nav_labels(page))
        ctx.close()

        # ───────────── player ─────────────
        ctx, page, errors = new_page(browser, sessions["p1"])
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        check("player: gets the No access screen", until(lambda: page.get_by_text("No access").is_visible(), 15000))
        ctx.close()

        # ───────────── platform owner (mocked API) ─────────────
        owner_id = "b220d3a4-f552-4fa3-a477-a9a77dec31c4"
        fake_session = sessions["p1"]  # a real player token; every API answer below is mocked as the platform owner
        brands = [{"id": "00000000-0000-0000-0000-000000000001", "name": "Aviator", "slug": "aviator", "status": "active"},
                  {"id": "11111111-1111-1111-1111-111111111111", "name": "Second Brand", "slug": "second", "status": "active"}]
        cfg = {"deposits_enabled": True, "withdrawals_enabled": True, "play_enabled": True, "registrations_enabled": True, "marketers_enabled": True, "version": 7, "updated_at": "2026-09-20T10:00:00Z"}
        seen_scope = []
        def overview(site):
            days = [{"day": f"2026-09-{d:02d}", "deposits_kes": 1000 * d, "deposits_count": d, "withdrawals_kes": 300 * d, "stake_kes": 2000 * d, "house_revenue_kes": 150 * d, "bettors": d, "new_players": d % 3} for d in range(12, 26)]
            return {"scope": "site" if site else "all", "days": 14, "generated_at": "2026-09-25T09:00:00Z",
                    "today": {"deposits_kes": 25000 if not site else 9000, "deposits_count": 25, "depositors": 20, "withdrawals_kes": 7500, "stake_kes": 50000, "payouts_kes": 46000,
                              "bets_count": 400, "bettors": 60, "new_players": 5, "bonus_kes": 1000, "house_revenue_kes": 4000},
                    "series": days, "attention": {"withdrawals_pending": 3, "withdrawals_pending_kes": 4500, "deposits_attention": 1},
                    "totals": {"players": 1200, "active_7d": 300, "player_balances_kes": 88000, "bonus_balances_kes": 4000}}
        seen_urls = []
        def handle(route, request):
            u = request.url
            seen_urls.append(request.method + " " + u.split("/v1/")[-1][:60])
            body = json.loads(request.post_data or "{}") if request.method == "POST" else {}
            h = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}
            if "/rest/v1/profiles" in u:
                return route.fulfill(status=200, headers=h, body=json.dumps({"role": "platform_superadmin", "is_banned": False, "username": "owner", "site_id": brands[0]["id"]}))
            if u.endswith("/rpc/admin_my_sites"): return route.fulfill(status=200, headers=h, body=json.dumps(brands))
            if u.endswith("/rpc/admin_overview"):
                seen_scope.append(body.get("p_site")); return route.fulfill(status=200, headers=h, body=json.dumps(overview(body.get("p_site"))))
            if u.endswith("/rpc/fn_platform_get_global_config"): return route.fulfill(status=200, headers=h, body=json.dumps(cfg))
            if u.endswith("/rpc/fn_platform_set_global_config"):
                cfg.update(body.get("p_patch", {})); cfg["version"] += 1; return route.fulfill(status=200, headers=h, body=json.dumps(cfg))
            if u.endswith("/rpc/platform_sites_overview"):
                return route.fulfill(status=200, headers=h, body=json.dumps([{"site_id": b["id"], "name": b["name"], "slug": b["slug"], "status": "active", "withdrawals_enabled": True,
                    "default_marketer_id": None, "default_marketer_username": None, "created_at": "2026-01-01T00:00:00Z", "player_count": 600, "marketer_count": 2,
                    "deposit_total": 100000, "ggr": 5000, "withdrawal_pending_count": 1, "withdrawal_pending_total": 1500, "withdrawal_paid_total": 20000, "net_cashflow": 80000} for b in brands]))
            if "/rest/v1/withdrawal_requests" in u: return route.fulfill(status=200, headers={**h, "Content-Range": "0-0/3"}, body="[]")
            if "/rest/v1/" in u: return route.fulfill(status=200, headers=h, body="[]")
            if "/realtime/" in u: return route.abort()
            return route.continue_()
        ctx, page, errors = new_page(browser, fake_session)
        console = []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"[:200]))
        page.on("requestfailed", lambda r: console.append(f"FAILED {r.method} {r.url[:90]} {r.failure}"))
        page.route(re.compile(re.escape(URL) + r"/(rest|realtime)/.*"), handle)
        page.goto(APP + "/admin", wait_until="domcontentloaded")
        check("owner: Overview opens across all brands", until(lambda: page.get_by_role("heading", name="Overview").is_visible(), 20000)
              and until(lambda: "Platform console · all brands" in page.get_by_test_id("workspace-scope").inner_text(), 5000))
        check("owner: KPIs show the all-brands figures", until(lambda: "KSh 25,000" in page.get_by_test_id("kpi-deposits").inner_text(), 10000))
        check("owner: needs-attention lists queue links", "Withdrawals waiting for review" in page.get_by_test_id("attention").inner_text())
        labels = nav_labels(page)
        check("owner: sees platform and settings items", "Brands & controls" in labels and "Settings" in labels, labels)
        page.get_by_test_id("scope-switcher").select_option(brands[1]["id"])
        page.wait_for_timeout(3000)
        try:
            console.append("LOCKS " + json.dumps(page.evaluate("navigator.locks ? navigator.locks.query().then(q => ({held: q.held.map(l => l.name), pending: q.pending.map(l => l.name)})) : 'no locks api'")))
        except Exception as e:
            console.append(f"LOCKS error {e}")
        check("owner: picking a brand shows the 'viewing one brand' banner", until(lambda: "Second Brand" in page.get_by_test_id("scope-banner").inner_text(), 5000))
        check("owner: the page reloads for that brand", until(lambda: brands[1]["id"] in seen_scope and "KSh 9,000" in page.get_by_test_id("kpi-deposits").inner_text(), 20000), (seen_scope, dump("owner-scope", seen_urls + ["--- console ---"] + console)))
        page.goto(APP + "/admin/withdrawals", wait_until="domcontentloaded")
        check("owner: the brand choice survives a reload, and unfiltered pages say so",
              until(lambda: page.get_by_test_id("scope-unscoped").is_visible(), 15000) and page.get_by_test_id("scope-banner").is_visible())
        page.get_by_role("button", name="Show all brands").click()
        check("owner: 'Show all brands' clears the scope", until(lambda: page.get_by_test_id("scope-banner").count() == 0, 5000))
        page.goto(APP + "/admin/platform", wait_until="domcontentloaded")
        check("owner: Brands & controls shows five platform switches", until(lambda: page.get_by_role("switch").count() == 5, 15000))
        page.get_by_test_id("switch-deposits_enabled").click()
        dlg = page.get_by_role("dialog", name=re.compile("Turn off deposits"))
        check("owner: turning a switch off asks for confirmation first", until(lambda: dlg.is_visible(), 3000) and cfg["deposits_enabled"] is True)
        shot(page, "owner-switch-confirm")
        page.get_by_test_id("confirm-switch").click()
        page.wait_for_timeout(3000)
        console.append("AFTER-CONFIRM dialog=%s btn=%s" % (dlg.count(), page.get_by_test_id("confirm-switch").count()))
        console.append("LOCKS2 " + json.dumps(page.evaluate("navigator.locks ? navigator.locks.query().then(q => ({held: q.held.map(l => l.name), pending: q.pending.map(l => l.name)})) : 'none'")))
        check("owner: confirmed — switch is off and a warning shows", until(lambda: cfg["deposits_enabled"] is False and "turned off for every brand" in page.get_by_test_id("global-controls").inner_text(), 15000),
              (cfg["deposits_enabled"], dump("owner-switch", seen_urls + console)))
        page.get_by_test_id("open-brand").nth(1).click()
        check("owner: 'Open' on a brand scopes the back office to it", until(lambda: page.get_by_role("heading", name="Overview").is_visible()
              and "Second Brand" in page.get_by_test_id("scope-banner").inner_text(), 10000))
        shot(page, "owner-brand-scoped")
        check("owner: no page errors", not errors, errors[:3])
        ctx.close()
        browser.close()
finally:
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"""delete from admin_audit_log where admin_id in ({ids}) or target_id in (select id::text from profiles where id in ({ids}));
                delete from ledger_entries where user_id in ({ids}); delete from bonuses where user_id in ({ids});
                delete from transactions where user_id in ({ids}); delete from player_risk_scores where user_id in ({ids});""")
        for uid in users.values():
            http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if site_b:
        sql(f"delete from admin_audit_log where site_id='{site_b}'; delete from wallets where site_id='{site_b}'; delete from profiles where site_id='{site_b}'; delete from sites where id='{site_b}'")
    if ids:
        left = sql(f"select (select count(*) from auth.users where id in ({ids})) u, (select count(*) from sites where slug='adm-e2e-{tag}') s")
        print(f"  cleanup: {left}")

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
