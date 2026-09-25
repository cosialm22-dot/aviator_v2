#!/usr/bin/env python3
"""Mobile-first player UI, signed in and signed out, on the live backend (throwaway player, cleaned up).

Fit: on every common phone size the whole betting surface (both Bet buttons) is on the first screen,
nothing scrolls sideways, no visible text is under 11 px and the game controls are thumb-sized.
Quiet: no pop-ups push deposits; a new notification only lights a dot on the menu; the inbox, free
bets, my bets and rules open as sheets (also from other pages). Copy: register shows the live bonus
offer, the wallet CTA carries the amount, the profile shows a formatted phone.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=…
  SUPABASE_REF=… [HOST_MAP=… PROXY_BYPASS=…] python3 e2e/mobile_ui_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
PASS, FAIL = [], []
# Kenya's most common phone viewports (StatCounter, Aug 2026: 360x800 17.6%, 360x806, 385x854, 412x915)
# minus browser chrome, plus a small phone, a tablet and a laptop.
PHONES = [(360, 640), (360, 720), (385, 760), (412, 820)]
OTHERS = [(768, 1024), (1440, 900)]

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:300]}"))

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

FIT = r"""() => {
  const vw = innerWidth, out = { hscroll: document.documentElement.scrollWidth > vw + 1, tiny: [] };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only')) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (own && parseFloat(cs.fontSize) < 11) out.tiny.push(`${cs.fontSize}:${own.slice(0, 20)}`);
  }
  return out;
}"""

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}
uid = None
try:
    tag = secrets.token_hex(3)
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"mob{tag}", "phone": phone}}, admin_h)
    uid = u["id"]
    st, session = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    offer = http("POST", f"{URL}/rest/v1/rpc/fn_public_payment_config", {}, {"apikey": PUB})[1].get("offer") or {}

    with sync_playwright() as p:
        b = p.chromium.launch(**launch)

        def open_page(w, h, signed):
            ctx = b.new_context(viewport={"width": w, "height": h}, service_workers="block", is_mobile=w < 800, has_touch=w < 800)
            if signed: ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(session))}); }} catch (e) {{}}")
            # count React commits (a stand-in DevTools hook) to prove the flight doesn't re-render the page
            ctx.add_init_script("""window.__commits = 0; window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(),
              inject() { return 1; }, onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };""")
            # record every audio play (source, muted) so the fly-away sound can be checked
            ctx.add_init_script("""(() => { window.__played = []; const p = HTMLMediaElement.prototype.play;
              HTMLMediaElement.prototype.play = function () { window.__played.push({ src: this.src, muted: this.muted, t: Date.now() }); return p.call(this); }; })();""")
            ws_bridge.install(ctx)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(APP + "/", wait_until="domcontentloaded")
            return ctx, pg, errs

        def until(pg, fn, ms=15000):
            end = time.time() + ms / 1000
            while time.time() < end:
                ws_bridge.pump()
                try:
                    if fn(): return True
                except Exception: pass
                pg.wait_for_timeout(60)
            return False

        # ── fit on every size ──
        for w, h in PHONES + OTHERS:
            ctx, pg, errs = open_page(w, h, True)
            lbl = f"{w}x{h}"
            bets = pg.get_by_role("button", name=re.compile(r"^Bet\s"))
            until(pg, lambda: bets.count() == 2 and bets.nth(1).is_visible(), 20000)
            boxes = [bets.nth(i).bounding_box() for i in range(2)]
            if h >= 700:
                check(f"{lbl}: both Bet buttons on the first screen", all(bx and bx["y"] >= 0 and bx["y"] + bx["height"] <= h for bx in boxes), boxes)
            m = pg.evaluate(FIT)
            check(f"{lbl}: no sideways scroll", not m["hscroll"])
            check(f"{lbl}: no visible text under 11 px", not m["tiny"], m["tiny"][:6])
            if w < 800:
                small = pg.evaluate("""() => [...document.querySelectorAll('[aria-label^="Bet 1 mode"] button, [aria-label^="Decrease bet"], [aria-label^="Increase bet"], [aria-label="Game menu"], [aria-label^="Balance"], [role=tablist][aria-label="Play mode"] button')]
                    .map(e => e.getBoundingClientRect()).filter(r => r.height < 28 || r.width < 36).length""")
                check(f"{lbl}: game controls are thumb-sized", small == 0, small)
            check(f"{lbl}: no page errors", not errs, errs[:2])
            ctx.close()

        # ── signed-in flows on the most common phone ──
        ctx, pg, errs = open_page(360, 720, True)
        menu_btn = pg.get_by_role("button", name=re.compile(r"^Game menu"))
        until(pg, lambda: menu_btn.is_visible(), 15000)
        check("header: balance pill opens the wallet (no separate Deposit button, no bell)",
              until(pg, lambda: pg.get_by_role("button", name=re.compile("Open wallet")).is_visible(), 15000) and pg.get_by_role("button", name=re.compile("^Notifications")).count() == 0)
        check("menu: no dot while nothing is new", (menu_btn.get_attribute("aria-label") or "") == "Game menu")
        sql(f"insert into user_notifications(user_id, level, title, body) values ('{uid}', 'info', 'Mobile e2e {tag}', 'Hello')")
        check("a new notification lights a dot on the menu (no pop-up)",
              until(pg, lambda: menu_btn.get_attribute("aria-label") == "Game menu, new items", 15000) and pg.get_by_text(f"Mobile e2e {tag}").count() == 0)
        menu_btn.click()
        menu = pg.get_by_role("menu", name="Game menu")
        mt = menu.inner_text()
        check("menu: Notifications, Free bets, My bets, Rules, Chat, Wallet, Log out", re.search(r"Notifications\s*1[\s\S]*Free bets[\s\S]*My bets[\s\S]*Rules[\s\S]*Chat[\s\S]*Wallet[\s\S]*Log out", mt) is not None, mt)
        menu.get_by_role("menuitem", name=re.compile("^Notifications")).click()
        sheet = pg.get_by_role("dialog", name="Notifications")
        check("inbox opens as a sheet with the item", until(pg, lambda: f"Mobile e2e {tag}" in sheet.inner_text(), 5000))
        pg.wait_for_timeout(400)  # let the slide-up finish
        sb = sheet.bounding_box()
        check("sheet sits at the bottom on phones", sb and abs(sb["y"] + sb["height"] - 720) <= 2, sb)
        sheet.get_by_role("button", name="Dismiss").click()
        check("dismiss empties the inbox and clears the dot", until(pg, lambda: "Nothing new" in sheet.inner_text(), 5000)
              and until(pg, lambda: menu_btn.get_attribute("aria-label") == "Game menu", 5000))
        pg.keyboard.press("Escape")
        for item, title, text in [("Free bets", "Free bets", "None right now"), ("My bets", "My bets", "No bets yet")]:
            menu_btn.click(); pg.get_by_role("menu", name="Game menu").get_by_role("menuitem", name=item).click()
            d = pg.get_by_role("dialog", name=title)
            check(f"{item} opens as a sheet", until(pg, lambda: text in d.inner_text(), 8000), d.inner_text() if d.count() else "")
            d.get_by_role("button", name="Close").first.click()

        # a refused bet is said inside the button, briefly, in two words (server reply stubbed)
        pg.route("**/rest/v1/rpc/place_bet", lambda r: r.fulfill(status=400, content_type="application/json",
                 headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"code": "P0001", "message": "BET_OUT_OF_RANGE"})))
        status = pg.locator('div.sr-only[role="status"]').first
        until(pg, lambda: "Flew away" in status.inner_text() or "Multiplier" in status.inner_text(), 30000)
        until(pg, lambda: "Waiting" in status.inner_text(), 30000)
        panel1 = pg.locator("div.rounded-2xl", has=pg.get_by_role("tablist", name="Bet 1 mode"))
        panel1.get_by_role("button", name=re.compile(r"^Bet\s")).click()
        alert = panel1.get_by_role("alert")
        check("refused bet: 'Outside limits' shows in the button", until(pg, lambda: alert.inner_text() == "Outside limits", 5000))
        check("refused bet: the message clears by itself", until(pg, lambda: alert.count() == 0, 5000))
        pg.unroute("**/rest/v1/rpc/place_bet")

        # wallet
        pg.get_by_role("button", name=re.compile("Open wallet")).click()
        wal = pg.get_by_role("dialog", name="Wallet")
        until(pg, lambda: wal.is_visible(), 5000)
        wt = wal.inner_text()
        if offer.get("match_pct"):
            check("wallet: first-deposit offer is the live one", f"+{int(float(offer['match_pct']))}% first deposit, up to {int(offer['match_cap']):,} KES" in wt, wt[:200])
        check("wallet: no method card or long help text", "Instant prompt" not in wt and "For your security" not in wt and len(wt.split()) <= 40, len(wt.split()))
        pg.get_by_label("Amount in Kenyan shillings").fill("500")
        check("wallet: the CTA carries the amount", wal.get_by_role("button", name="Deposit 500 KES").is_visible())
        wal.get_by_role("tab", name="Withdraw").click()
        pg.get_by_label("Amount in Kenyan shillings").fill("100")
        check("wallet: withdraw asks for the password and shows the amount", pg.get_by_label("Password", exact=True).is_visible() and wal.get_by_role("button", name="Withdraw 100 KES").is_visible())
        wal.get_by_role("tab", name="Deposit").click()
        wal.get_by_role("button", name="Add promo code").click()
        pr = pg.get_by_label("Promo code").bounding_box(); ap = wal.get_by_role("button", name="Apply").bounding_box(); wb = wal.bounding_box()
        check("wallet: promo code field and Apply fit inside the sheet", ap and wb and ap["x"] + ap["width"] <= wb["x"] + wb["width"] and pr["width"] > 100, (pr, ap, wb))
        pg.keyboard.press("Escape")
        check("Escape closes the wallet", until(pg, lambda: not wal.is_visible(), 3000))

        # profile, then a menu panel from the profile page
        pg.goto(APP + "/profile", wait_until="domcontentloaded")
        fmt = f"+254 {phone[3:6]} {phone[6:9]} {phone[9:]}"
        check("profile: formatted phone, Stats and Payments only", until(pg, lambda: fmt in pg.locator("main").inner_text(), 10000)
              and pg.get_by_role("tab").all_inner_texts() == ["Stats", "Payments"], pg.locator("main").inner_text()[:200])
        menu_btn.click(); pg.get_by_role("menu", name="Game menu").get_by_role("menuitem", name="Rules").click()
        check("Rules from the profile page returns to the game and opens", until(pg, lambda: pg.get_by_role("dialog", name="Rules").is_visible(), 5000) and pg.url.rstrip("/") == APP)
        check("no page errors (signed in)", not errs, errs[:2])
        ctx.close()

        # ── signed out: register shows the live offer ──
        ctx, pg, errs = open_page(360, 720, False)
        pg.get_by_role("button", name="Register").click()
        reg = pg.get_by_role("dialog", name="Register")
        until(pg, lambda: reg.is_visible(), 5000)
        want = " · ".join([s for s in [f"{int(offer['welcome']):,} KES free" if offer.get("welcome") else "", f"+{int(float(offer['match_pct']))}% first deposit" if offer.get("match_pct") else ""] if s])
        check("register: bonus line matches the server's offer", until(pg, lambda: want in reg.inner_text(), 5000), (want, reg.inner_text()[:160]))
        check("register: three fields and one button, no filler copy", reg.locator("input").count() == 3 and "30 seconds" not in reg.inner_text())
        pg.keyboard.press("Escape")
        # the freeze: with the Top list open, a flight must not re-render the page (it used to, 15x a second)
        board = pg.get_by_role("region", name="Bets")
        st_ = pg.locator('div.sr-only[role="status"]').first
        until(pg, lambda: "Waiting" in st_.inner_text(), 40000)
        board.get_by_role("tab", name="Top").click()
        until(pg, lambda: "Multiplier" in st_.inner_text(), 30000)
        pg.wait_for_timeout(300)
        c0 = pg.evaluate("window.__commits"); pg.wait_for_timeout(2000); c1 = pg.evaluate("window.__commits")
        still = "Multiplier" in st_.inner_text()
        # only the screen-reader status ticks (4/s, a leaf); before the fix the whole game tree
        # re-rendered 15x a second (30+ commits in 2 s)
        check("flight with Top open: only the tiny status leaf updates (≤ 5 commits/s)", (c1 - c0) <= 10 or not still, (c1 - c0, still))
        tabs_ok = True
        for t_ in ["Previous", "All Bets", "Top", "All Bets"]:
            board.get_by_role("tab", name=t_).click(); pg.wait_for_timeout(150)
            tabs_ok = tabs_ok and board.get_by_role("tab", name=t_).get_attribute("aria-selected") == "true"
        check("switching All / Previous / Top responds at once", tabs_ok)
        pg.get_by_role("button", name=re.compile(r"^Game menu")).click()
        mt_ = pg.get_by_role("menu", name="Game menu").inner_text()
        check("Real / Demo is in the menu (not on the plane)", mt_.strip().startswith("Real") and pg.locator('main [aria-label="Play mode"]').count() == 0, mt_[:40])
        pg.get_by_role("menuitemradio", name="Demo").click()
        check("choosing Demo closes the menu and switches", pg.get_by_role("menu", name="Game menu").count() == 0 and pg.get_by_label("Demo balance", exact=True).is_visible())
        check("signed-out demo keeps Register in the header", pg.get_by_role("button", name="Register").is_visible() and pg.get_by_label("Demo balance", exact=True).is_visible())
        pg.wait_for_timeout(15000)
        check("demo: no 'Play for Real' toasts", pg.get_by_text(re.compile("Play for Real|Deposit Now", re.I)).count() == 0)
        # fly-away sound: the first tap unlocks audio (silently); each crash then plays the jet roar
        played = lambda: pg.evaluate("window.__played")
        first = next((p_ for p_ in played() if "flyaway" in p_["src"]), None)
        check("first tap unlocks the sounds silently", first is not None and first["muted"], played()[:4])
        status = pg.locator('div.sr-only[role="status"]').first
        until(pg, lambda: "Multiplier" in status.inner_text(), 30000)
        n0 = len([p_ for p_ in played() if "flyaway" in p_["src"] and not p_["muted"]])
        crashed = until(pg, lambda: "Flew away" in status.inner_text(), 60000)
        pg.wait_for_timeout(300)
        loud = [p_ for p_ in played() if "flyaway" in p_["src"] and not p_["muted"]]
        check("the jet roar plays when the plane flies away", crashed and len(loud) == n0 + 1, (crashed, n0, loud[-2:]))
        r_ = pg.evaluate("fetch('/sounds/flyaway.mp3').then(async r => ({ s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }))")
        check("flyaway.mp3 is served (audio, small)", r_["s"] == 200 and "audio" in (r_["t"] or "") and r_["n"] < 40000, r_)
        pg.get_by_role("button", name=re.compile(r"^Game menu")).click()
        pg.get_by_role("switch", name="Sound").click()   # off
        pg.keyboard.press("Escape")
        until(pg, lambda: "Multiplier" in status.inner_text(), 30000)
        n1 = len([p_ for p_ in played() if "flyaway" in p_["src"] and not p_["muted"]])
        until(pg, lambda: "Flew away" in status.inner_text(), 60000); pg.wait_for_timeout(300)
        check("sound off: no roar", len([p_ for p_ in played() if "flyaway" in p_["src"] and not p_["muted"]]) == n1)
        check("no page errors (signed out)", not errs, errs[:2])
        ctx.close()
        b.close()
finally:
    if uid:
        sql(f"delete from user_notifications where user_id='{uid}'; delete from bonuses where user_id='{uid}'; delete from ledger_entries where user_id='{uid}'; delete from transactions where user_id='{uid}'")
        http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
        print("  cleanup:", sql(f"select (select count(*) from auth.users where id='{uid}') u"))
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
