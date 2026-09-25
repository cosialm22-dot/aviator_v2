#!/usr/bin/env python3
"""Real-money game in a real browser, live backend (throwaway funded player, cleaned up after).

Checks over several rounds: the page follows rounds from the broadcast stream only (no per-round
REST polling); the multiplier climbs during flight; the "flew away" value equals the crash point
the server revealed; the history strip leads with it; a bet placed from the UI and cashed out
from the UI is paid what the server says; the balance label follows; the page never sees the
crash time; the client clock is synced to the server.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=…
  SUPABASE_REF=… [HOST_MAP=… PROXY_BYPASS=…] ROUNDS=3 python3 e2e/game_live_ui_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
ROUNDS = int(os.environ.get("ROUNDS", "3"))
PASS, FAIL, NOTES = [], [], []

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

admin_h = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}"}
tag = secrets.token_hex(3)
uid = None

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

try:
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"gui{tag}", "phone": phone}}, admin_h)
    uid = u["id"]
    st, session = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    sql(f"update wallets set real_balance = 100000, bonus_balance = 0 where user_id = '{uid}'")

    with sync_playwright() as pw_:
        browser = pw_.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 1440, "height": 950}, service_workers="block")
        ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(session))}); }} catch (e) {{}}")
        ws_bridge.install(ctx)
        page = ctx.new_page()
        errors, rest = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: rest.append((time.time(), r.method, r.url.split("/rest/v1/")[-1][:60])) if "/rest/v1/" in r.url else None)

        def until(fn, ms=15000):
            end = time.time() + ms / 1000
            while time.time() < end:
                ws_bridge.pump()
                try:
                    if fn(): return True
                except Exception: pass
                page.wait_for_timeout(50)
            return False

        status = page.locator('div.sr-only[role="status"]').first
        def txt():
            try: return status.inner_text(timeout=1000)
            except Exception: return ""
        page.goto(APP + "/", wait_until="domcontentloaded")
        check("clock is synced with server_time()", until(lambda: any("rpc/server_time" in r[2] for r in rest), 15000))
        panels = page.locator("div.rounded-2xl", has=page.get_by_role("tablist", name=re.compile(r"^Bet \d mode$")))
        check("signed-in player sees two bet panels", until(lambda: panels.count() == 2, 20000), panels.count())

        seen_rounds = []
        rest_mark = None
        for n in range(ROUNDS):
            # a take-off: multiplier text appears and climbs
            # start from a fresh take-off (skip a flight already in progress)
            until(lambda: "Multiplier" not in txt(), 60000)
            check(f"round {n+1}: take-off shows a climbing multiplier",
                  until(lambda: "Multiplier" in txt(), 40000), txt())
            m1 = float(re.search(r"([\d.]+)x", txt()).group(1))
            until(lambda: False, 700)
            t2 = txt()
            if "Multiplier" in t2:
                m2 = float(re.search(r"([\d.]+)x", t2).group(1))
                check(f"round {n+1}: multiplier rises ({m1} → {m2})", m2 > m1, (m1, m2))
            check(f"round {n+1}: crash shows 'Flew away'", until(lambda: "Flew away" in txt(), 120000))
            shown = float(re.search(r"([\d.]+)x", txt()).group(1))
            last = sql("select id, crash_multiplier, crashes_at from game_rounds where status='crashed' order by round_number desc limit 1")[0]
            check(f"round {n+1}: 'Flew away at {shown}x' equals the server's crash point {last['crash_multiplier']}",
                  abs(shown - float(last["crash_multiplier"])) < 0.005, (shown, last))
            check(f"round {n+1}: the public round row never carried the crash time", last["crashes_at"] is None, last)
            seen_rounds.append(last["id"])
            if n == 0: rest_mark = len(rest)
        polled = [r for r in rest[rest_mark:] if ("game_rounds" in r[2] or r[2].startswith("bets")) and r[1] == "GET"]
        check("no per-round REST polling of rounds or bets once live (broadcast only)", len(polled) == 0, polled[:4])

        # UI bet → UI cash out
        b0 = int(sql(f"select real_balance from wallets where user_id='{uid}'")[0]["real_balance"])
        bet_btn = panels.first.get_by_role("button", name=re.compile(r"^Bet\s"))
        until(lambda: False, 200)
        check("Bet becomes available in the next betting window", until(lambda: bet_btn.is_enabled() and "Multiplier" not in txt() and "Flew away" not in txt(), 40000))
        bet_btn.click()
        check("UI bet placed", until(lambda: re.search("Bet placed|Waiting for next round|Cancel|Cash Out", panels.first.inner_text()) is not None, 10000), panels.first.inner_text()[:120])
        cash = panels.first.get_by_role("button", name=re.compile(r"^Cash Out"))
        took_off = until(lambda: cash.is_visible() and cash.is_enabled(), 30000)
        cashed = False
        if took_off:
            cash.click(); cashed = True
        until(lambda: "Flew away" in txt(), 120000)
        bet = sql(f"select b.status, b.amount, b.cashout_multiplier, b.winnings, g.crash_multiplier from bets b join game_rounds g on g.id = b.round_id where b.user_id='{uid}' order by b.created_at desc limit 1")[0]
        if not took_off and float(bet["crash_multiplier"] or 0) <= 1.05:
            # the round busted almost at take-off: nothing could be cashed out; not a UI failure
            NOTES.append(f"round crashed at {bet['crash_multiplier']}x before a cash-out was possible")
            cashed = True
        b1 = int(sql(f"select real_balance from wallets where user_id='{uid}'")[0]["real_balance"])
        won = bet["status"] == "won"
        exp = -int(round(float(bet["amount"]) * 100)) + (int(round(float(bet["winnings"]) * 100)) if won else 0)
        check(f"UI cash-out settled on the server ({bet['status']} {bet['cashout_multiplier'] or ''})", bet["status"] in ("won", "lost") and (won or cashed), bet)
        check("wallet moved by exactly winnings − stake", b1 - b0 == exp, (b1 - b0, exp))
        bal = "{:,.2f}".format(b1 / 100)
        check(f"the balance label shows KES {bal}", until(lambda: bal in page.locator("header").inner_text(), 15000), page.locator("header").inner_text()[:120])
        check("no page errors", not errors, errors[:3])
        NOTES.append(f"REST calls during the watched rounds: {len(rest) - (rest_mark or 0)}")
        browser.close()
finally:
    if uid:
        sql(f"""delete from ledger_entries where user_id='{uid}'; delete from bonuses where user_id='{uid}';
                delete from transactions where user_id='{uid}'; delete from bets where user_id='{uid}';""")
        http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
for n in NOTES: print("  note:", n)
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
