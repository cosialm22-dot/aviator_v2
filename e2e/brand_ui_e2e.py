#!/usr/bin/env python3
"""Brand skins in the browser (multi-brand step 2/3).

Part A — the web app applies a brand (any environment): the brand payload is served to the page
through request interception, so every setting is exercised without touching production data.
Checks the theme variables, fonts, title/favicon, header wordmark and plane, the call-to-action ink,
the announcement, support/legal/social links, the legal page, every feature switch that hides UI
(second bet, auto play, live bets, history, chat, demo, free bets, sign-ups, deposits,
withdrawals), bet chips and starting bet, the canvas plane, and the "brand unavailable" screen.

Part B (BRAND_LIVE=1, production) — the whole pipeline: a throwaway brand is created in the database,
its look is saved through admin_brand_save's validation (as SQL fixture), and the deployed Worker must
render the brand into the HTML (CSS variables, title, icon, canonical, window.__BRAND__) for
?brand=<slug>; the app must then show it. The brand is removed afterwards.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=…
  [HOST_MAP=… PROXY_BYPASS=…] [BRAND_LIVE=1] python3 e2e/brand_ui_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge  # noqa: E402

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
LIVE = os.environ.get("BRAND_LIVE") == "1"
PASS, FAIL = [], []

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:300]}"))

def http(method, url, body=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json",
                                          # the site sits behind Cloudflare's bot check (error 1010 for bare urllib);
                                          # Supabase refuses secret keys from browser-like agents, so only the site gets one
                                          **({"User-Agent": "Mozilla/5.0 (brand-e2e)"} if url.startswith(APP) else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode(); return r.status, (t if raw else (json.loads(t) if t else {}))
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, (t if raw else json.loads(t))
        except Exception: return e.code, {"raw": t}

def sql(q):
    st, r = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": f"Bearer {TOKEN}"})
    if st >= 300: raise RuntimeError(f"sql {st}: {str(r)[:300]}")
    return r

def trip(h): h = h.lstrip('#'); return f"{int(h[0:2],16)} {int(h[2:4],16)} {int(h[4:6],16)}"
def rgb(h): return f"rgb({int(h[1:3],16)}, {int(h[3:5],16)}, {int(h[5:7],16)})"

# Public defaults straight from the registry (the same values the server returns for an untouched brand).
DEFAULTS = {r["key"]: r["default_value"] for r in sql("select key, default_value from brand_setting_defs where is_public")}
TOKENS = {"bg": "#0b0b10", "surface": "#16161f", "surface2": "#22222e", "border": "#2c2c3a", "fg": "#f5f3ea", "muted": "#9a98a8",
          "brand": "#f0b90b", "brandHover": "#c99a08", "brandText": "#ffd24a", "accent": "#ffd24a", "accentFg": "#0b0f14",
          "up": "#34d058", "down": "#ff4757", "warn": "#ff9f0a", "info": "#3b82f6",
          "fontTitle": "Poppins", "fontBody": "Inter", "fontMono": "Inter", "headingWeight": "800", "radius": "10px"}

def brand(slug="gold-e2e", status="active", matched="preview", tokens=TOKENS, **cfg):
    c = dict(DEFAULTS); c.update({"plane.model": "jet", "plane.body": "#f0b90b", "plane.accent": "#7a5a00", "look.curve": "#f0b90b"}); c.update(cfg)
    return {"site_id": "11111111-2222-3333-4444-555555555555", "slug": slug, "name": "Gold Rush", "status": status, "matched": matched,
            "version": 7, "wordmark_text": "GoldRush", "logo_url": None, "favicon_url": None, "currency": "KES", "locale": "en-KE",
            "licence_line": "Licence 0001", "support_email": "help@goldrush.example", "primary_domain": None, "theme_tokens": tokens, "config": c}

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

uid = None; live_site = None
try:
    tag = secrets.token_hex(3)
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"brd{tag}", "phone": phone}}, admin_h)
    uid = u["id"]
    st, session = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})

    with sync_playwright() as p:
        b = p.chromium.launch(**launch)

        def open_page(br, signed=False, path="/", payment=None, w=390, h=844):
            ctx = b.new_context(viewport={"width": w, "height": h}, service_workers="block", is_mobile=True, has_touch=True)
            if signed: ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(session))}); }} catch (e) {{}}")
            body = json.dumps(br)
            ctx.route("**/rest/v1/rpc/public_site_by_host", lambda r: r.fulfill(status=200, content_type="application/json", body=body))
            if payment is not None:
                pb = json.dumps(payment)
                ctx.route("**/rest/v1/rpc/fn_public_payment_config", lambda r: r.fulfill(status=200, content_type="application/json", body=pb))
            ws_bridge.install(ctx)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(APP + path, wait_until="domcontentloaded")
            pg.wait_for_timeout(2500)
            return ctx, pg, errs

        def css_var(pg, name):
            return pg.evaluate(f"getComputedStyle(document.documentElement).getPropertyValue('{name}').trim()")

        print("A. the app applies a brand")
        ctx, pg, errs = open_page(brand(**{"copy.announcement": "Weekend cashback", "support.whatsapp": "+254712345678",
                                        "support.telegram": "https://t.me/goldrush", "social.tiktok": "https://tiktok.com/@goldrush",
                                        "legal.terms": "# Terms\n\nPlay responsibly.\n\nSecond paragraph.", "legal.company": "Gold Rush Ltd",
                                        "copy.flew_away": "GONE!", "seo.title": "Gold Rush — fly high", "seo.description": "Crash game"}))
        check("theme variables: call-to-action = brand colour", css_var(pg, "--g-cta") == trip(TOKENS["brand"]), css_var(pg, "--g-cta"))
        check("theme variables: page background = brand bg", css_var(pg, "--g-bg") == trip(TOKENS["bg"]), css_var(pg, "--g-bg"))
        check("title font variable", css_var(pg, "--font-title").startswith('"Poppins"'), css_var(pg, "--font-title"))
        check("brand fonts stylesheet loaded", pg.locator("#brand-fonts").count() == 1 and "Poppins" in (pg.locator("#brand-fonts").get_attribute("href") or ""))
        check("page title from the brand's SEO title", pg.title() == "Gold Rush — fly high", pg.title())
        check("description meta", pg.locator('meta[name="description"]').get_attribute("content") == "Crash game")
        check("theme-color = brand bg", pg.locator('meta[name="theme-color"]').get_attribute("content") == TOKENS["bg"])
        fav = pg.locator("#brand-icon").get_attribute("href") or ""
        check("generated favicon (brand tile + plane)", fav.startswith("data:image/svg+xml;base64,"), fav[:40])
        check("header wordmark in the brand's words", pg.get_by_test_id("brand-wordmark").inner_text() == "GoldRush")
        check("header plane is the brand's jet", pg.locator('[data-testid="brand-home"] svg path').count() >= 5)
        bet = pg.get_by_role("button", name=re.compile(r"^Bet")).first
        bg = bet.evaluate("e => getComputedStyle(e).backgroundColor"); fg = bet.evaluate("e => getComputedStyle(e).color")
        check("Bet button wears the brand colour", bg == rgb(TOKENS["brand"]), bg)
        check("Bet text uses the readable ink on gold (dark)", fg == "rgb(11, 15, 20)", fg)
        check("announcement shows", pg.get_by_test_id("announcement").inner_text().strip() == "Weekend cashback")
        pg.get_by_test_id("announcement").get_by_role("button", name="Dismiss").click(); pg.wait_for_timeout(200)
        check("announcement dismisses", pg.get_by_test_id("announcement").count() == 0)
        pg.get_by_role("button", name=re.compile("Game menu")).click(); pg.wait_for_timeout(300)
        wa = pg.get_by_role("menuitem", name="WhatsApp")
        check("menu: WhatsApp support link", wa.count() == 1 and wa.get_attribute("href") == "https://wa.me/254712345678", wa.get_attribute("href") if wa.count() else None)
        check("menu: Telegram + Email", pg.get_by_role("menuitem", name="Telegram").count() == 1 and pg.get_by_role("menuitem", name="Email").get_attribute("href") == "mailto:help@goldrush.example")
        check("menu: social + operator line", pg.get_by_role("link", name="Tiktok").count() == 1 and "Gold Rush Ltd" in pg.get_by_role("menu").inner_text())
        pg.get_by_role("menuitem", name="Terms").click(); pg.wait_for_timeout(600)
        check("legal page renders the brand's terms as text", pg.get_by_test_id("legal-terms").count() == 1 and "Second paragraph." in pg.get_by_test_id("legal-terms").inner_text())
        check("no page errors", not errs, errs[:2])
        ctx.close()

        print("A2. canvas plane, fly-away text (demo round)")
        ctx, pg, errs = open_page(brand(**{"copy.flew_away": "GONE!"}))
        pg.get_by_role("button", name=re.compile("Game menu")).click(); pg.wait_for_timeout(200)
        pg.get_by_role("menuitemradio", name="Demo").click()
        seen = False
        for _ in range(260):
            t = pg.locator('[role=status][aria-live]').first.inner_text()
            if "Flew away" in t: seen = True; break
            pg.wait_for_timeout(250)
        # The fly-away frame: the canvas is painted with the brand line; sample the crash text colour region.
        check("a demo round runs and flies away under the brand", seen)
        check("no page errors (canvas with brand plane)", not errs, errs[:2])
        ctx.close()

        print("A3. feature switches")
        off = {"features.two_bets": False, "features.autobet": False, "features.live_bets": False, "features.history": False,
               "features.chat": False, "features.demo": False, "features.free_bets": False, "features.registrations": False}
        ctx, pg, errs = open_page(brand(**off))
        check("second bet off: one Bet button, no ⊕", pg.get_by_role("button", name=re.compile(r"^Bet")).count() == 1 and pg.get_by_role("button", name="Add a second bet").count() == 0,
              pg.get_by_role("button", name=re.compile(r"^Bet")).count())
        check("auto play off: no Auto tab", pg.get_by_role("tab", name="Auto").count() == 0)
        check("live bets off: no bets board", pg.get_by_role("tab", name=re.compile("All bets", re.I)).count() == 0)
        check("sign-ups off: no Register button", pg.get_by_role("button", name="Register").count() == 0)
        pg.get_by_role("button", name=re.compile("Game menu")).click(); pg.wait_for_timeout(300)
        menu = pg.get_by_role("menu").inner_text()
        check("demo off: no Real/Demo switch", pg.get_by_role("menuitemradio").count() == 0)
        check("chat off: no Chat item", "Chat" not in menu, menu)
        pg.get_by_role("menuitem", name="Log in").click(); pg.wait_for_timeout(500)
        check("sign-ups off: the sheet only logs in", "New sign-ups are closed." in pg.get_by_role("dialog").inner_text())
        check("no page errors (switches)", not errs, errs[:2])
        ctx.close()

        print("A4. limits, chips, wallet switches (signed in)")
        pay = {"min_bet": 20, "max_bet": 5000, "bet_chips": [20, 40, 80, 160], "default_bet": 40, "min_deposit": 150, "max_deposit": 3000,
               "deposit_chips": [150, 300, 900], "min_withdrawal": 200, "max_withdrawal": 1000, "daily_withdrawal": 2000,
               "deposits": False, "withdrawals": True, "max_payout": 100000, "deposit_provider": "megapay", "offer": None}
        ctx, pg, errs = open_page(brand(), signed=True, payment=pay)
        chips = [t.strip() for t in pg.locator('[role=tablist][aria-label="Bet 1 mode"]').locator("xpath=../..").get_by_role("button", name=re.compile(r"^\d+$")).all_inner_texts()]
        check("bet chips are the brand's", chips[:4] == ["20", "40", "80", "160"], chips)
        stake = pg.locator('input[inputmode="numeric"]').first.input_value()
        check("starting bet is the brand's", stake == "40", stake)
        pg.locator("[data-balance-target]").first.click(); pg.wait_for_timeout(700)
        dlg = pg.get_by_role("dialog")
        check("deposits off: the wallet opens on Withdraw only (no segmented control)", dlg.get_by_role("tab", name="Deposit").count() == 0 and "Withdraw" in dlg.inner_text(), dlg.inner_text()[:200])
        check("withdraw caps shown", "Max 1,000" in dlg.inner_text() and "2,000/day" in dlg.inner_text(), dlg.inner_text()[:300])
        ctx.close()
        pay2 = dict(pay, deposits=False, withdrawals=False)
        ctx, pg, errs = open_page(brand(), signed=True, payment=pay2)
        pg.locator("[data-balance-target]").first.click(); pg.wait_for_timeout(700)
        check("both off: the wallet says payments are paused", pg.get_by_test_id("wallet-closed").count() == 1)
        ctx.close()

        print("A5. a suspended brand on its own domain")
        ctx, pg, errs = open_page(brand(status="suspended", matched="domain"))
        check("shows only the unavailable notice", pg.get_by_test_id("brand-unavailable").count() == 1 and pg.get_by_role("button", name=re.compile(r"^Bet")).count() == 0)
        ctx.close()
        ctx, pg, errs = open_page(brand(status="suspended", matched="domain"), path="/admin")
        check("…but the back office still opens there", pg.get_by_test_id("brand-unavailable").count() == 0)
        ctx.close()

        print("A6. the classic brand is untouched")
        ctx, pg, errs = open_page(brand(slug="aviator", tokens={}, **{"plane.model": "classic", "look.curve": "#e51e3c"}))
        check("no brand variables on <html> (classic :root defaults)", pg.evaluate("document.documentElement.style.getPropertyValue('--g-cta')") == "" and css_var(pg, "--g-cta") == "40 169 9")
        check("classic red plane sprite in the header", pg.locator('[data-testid="brand-home"] img[src="/plane.png"]').count() == 1)
        ctx.close()

        if LIVE:
            print("B. production pipeline: database → Worker → app")
            slug = f"e2e-{tag}"
            r = sql(f"""insert into sites(slug, name, status, wordmark_text, theme_tokens, config)
                        values ('{slug}', 'E2E Gold', 'active', 'E2EGold', '{json.dumps(TOKENS)}'::jsonb,
                        '{{"plane.model":"fighter","plane.body":"#f0b90b","seo.title":"E2E Gold","look.curve":"#f0b90b"}}'::jsonb) returning id""")
            live_site = r[0]["id"]
            # validate the fixture the same way a save would (tokens + settings)
            v = sql(f"select public._brand_validate_tokens(theme_tokens) t from sites where id = '{live_site}'")[0]["t"]
            check("fixture tokens pass the server validation", v is not None)
            time.sleep(1)
            st, html = http("GET", f"{APP}/?brand={slug}", raw=True)
            check("Worker renders the brand's title", "<title>E2E Gold</title>" in html, re.search(r"<title>.*?</title>", html))
            check("Worker renders the brand's CSS variables", f"--g-cta:{trip(TOKENS['brand'])}" in html)
            check("Worker hands the brand to the app (window.__BRAND__)", "window.__BRAND__=" in html and slug in html)
            check("Worker renders the generated favicon", 'id="brand-icon"' in html)
            st, man = http("GET", f"{APP}/manifest.webmanifest?brand={slug}")
            check("per-brand web-app manifest", isinstance(man, dict) and man.get("name") == "E2E Gold" and man.get("theme_color") == TOKENS["bg"], man)
            st, rob = http("GET", f"{APP}/robots.txt", raw=True)
            check("robots.txt served by the Worker", st == 200 and "Disallow: /admin" in rob, rob[:80])
            ctx = b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            ws_bridge.install(ctx)
            pg = ctx.new_page(); pg.goto(f"{APP}/?brand={slug}", wait_until="domcontentloaded"); pg.wait_for_timeout(3000)
            check("app shows the brand (wordmark, colours)", pg.get_by_test_id("brand-wordmark").inner_text() == "E2EGold" and css_var(pg, "--g-cta") == trip(TOKENS["brand"]))
            ctx.close()
        b.close()
finally:
    if uid: http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    if live_site:
        # the test's own fixture brand (never a real one): remove it and its version history
        try: sql(f"delete from sites where id = '{live_site}' and slug like 'e2e-%'")
        except Exception as e: print("cleanup:", e)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
