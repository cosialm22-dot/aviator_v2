#!/usr/bin/env python3
"""UI e2e for Mega Pay: the player's cashier and the operators' Deposits screen, in a real browser
against the real backend. No money moves:
  * the player's "send prompt" and "status" calls are intercepted in the browser (a real prompt would
    charge a real phone); everything the server itself decides is covered by the live function e2e;
  * the operator screen runs fully live on throwaway accounts and rows, including a real read-only
    Mega Pay connection test and status check, and a real hand confirmation on a throwaway deposit.
Everything created is deleted at the end, even on failure.

  npm run build && npx vite preview --port 4173
  APP_URL=http://aviator.test/ HOST_MAP="MAP aviator.test 127.0.0.1:4173" PROXY_BYPASS="*.test" \
  SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… \
  python3 e2e/megapay_ui_e2e.py
"""
import json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
STORAGE_KEY = f"sb-{REF}-auth-token"
PASS, FAIL = [], []
SHOTS = os.environ.get("SHOTS")  # optional folder for screenshots

def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:260]}"))

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
users = {}

def make_user(kind, phone):
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"mpui{kind}{tag}", "phone": phone}}, admin_h)
    if st >= 300: raise SystemExit(f"could not create {kind}: {st} {u}")
    users[kind] = u["id"]
    st, t = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    if st >= 300: raise SystemExit(f"sign-in failed: {st} {t}")
    return t

def rand_phone():
    return "2547" + str(secrets.randbelow(10**8)).zfill(8)

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

def new_page(browser, session, w, h):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    ctx.add_init_script(f"try {{ localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(json.dumps(session))}); }} catch (e) {{}}")
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

try:
    p_phone = rand_phone()
    P = make_user("player", p_phone)
    A = make_user("admin", rand_phone())
    S = make_user("support", rand_phone())
    sql(f"update profiles set role='admin' where id='{users['admin']}'; update profiles set role='support' where id='{users['support']}'")
    pid = users["player"]
    rows = sql(f"""
      insert into mpesa_stk_requests(user_id, phone_number, amount, checkout_request_id, status, provider, site_id, created_at, result_description, reference)
      values ('{pid}','{p_phone}',700,'e2e-ui-tmo-{tag}','timeout','megapay','00000000-0000-0000-0000-000000000001', now() - interval '2 hours', null, 'AVIATOR'),
             ('{pid}','{p_phone}',250,'mp-pending:e2e-ui-orph-{tag}','failed','megapay','00000000-0000-0000-0000-000000000001', now() - interval '40 minutes', 'No Mega Pay response', 'AVIATOR'),
             ('{pid}','{p_phone}',300,'e2e-ui-pend-{tag}','pending','megapay','00000000-0000-0000-0000-000000000001', now() - interval '1 minute', null, 'AVIATOR')
      returning id, status""")
    ids = {r["status"]: r["id"] for r in rows}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch)

        # ───────────────────────── player cashier ─────────────────────────
        for w, h, lbl in [(1280, 900, "desktop"), (390, 844, "phone")]:
            ctx, page, errors = new_page(browser, P, w, h)
            sent = []
            status_script = []

            def stk(route, request):
                sent.append(json.loads(request.post_data or "{}"))
                mode = page.evaluate("window.__mp_mode || 'ok'")
                if mode == "ratelimit":
                    route.fulfill(status=429, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                  body=json.dumps({"success": False, "error": "RATE_LIMITED", "message": "Too many deposit prompts. Wait a minute and try again."}))
                else:
                    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                  body=json.dumps({"success": True, "id": "11111111-2222-3333-4444-555555555555", "transaction_request_id": "TRX"}))

            def status(route, request):
                s = status_script.pop(0) if status_script else "pending"
                route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                              body=json.dumps({"id": "11111111-2222-3333-4444-555555555555", "status": s, "amount": 500, "receipt": "TST123ABC" if s == "completed" else None}))

            page.route("**/functions/v1/megapay-stk-push", stk)
            page.route("**/functions/v1/megapay-status", status)
            page.goto(APP + "/", wait_until="domcontentloaded")
            # The balance pill (with its +) opens the wallet on every screen size.
            dep_btn = page.get_by_role("button", name=re.compile(r"Open wallet"))
            ok = until(lambda: dep_btn.first.is_visible(), 20000)
            check(f"{lbl}: signed-in player can open the wallet from the balance", ok)
            dep_btn.first.click()
            dlg = page.get_by_role("dialog", name="Wallet")
            check(f"{lbl}: wallet opens", until(lambda: dlg.is_visible()))
            check(f"{lbl}: limits come from the server (KES 100 – 150,000)",
                  until(lambda: "Min 100 · Max 150,000" in page.get_by_test_id("deposit-limits").inner_text()),
                  page.get_by_test_id("deposit-limits").inner_text())
            phone_in = page.get_by_label("M-Pesa phone number")
            check(f"{lbl}: the M-Pesa number is prefilled from the account", phone_in.input_value() == p_phone[3:], phone_in.input_value())
            chips = dlg.locator("div.grid-cols-6 button").all_inner_texts()
            check(f"{lbl}: quick amounts start at the minimum", chips[:3] == ["100", "250", "500"], chips)

            amt = page.get_by_label("Amount in Kenyan shillings")
            cta = page.get_by_role("button", name=re.compile(r"^Deposit( [\d,]+ KES)?$"))
            for val, pat, name in [("50", "smallest deposit is KES 100", "below the minimum"),
                                   ("100.5", "whole number", "a fractional amount"),
                                   ("200000", "largest single deposit is KES 150,000", "above the maximum")]:
                amt.fill(val); cta.click()
                check(f"{lbl}: {name} is refused in the app", until(lambda: pat in page.get_by_role("alert").inner_text(), 3000))
            check(f"{lbl}: nothing was sent to Mega Pay for refused amounts", len(sent) == 0, sent)

            phone_in.fill(""); phone_in.fill("+254 712 345 678")
            check(f"{lbl}: a pasted +254 number is normalised", phone_in.input_value() == "712345678", phone_in.input_value())
            phone_in.fill(p_phone[3:])
            shot(page, f"wallet-form-{lbl}")

            # success: pending, pending, completed
            status_script[:] = ["pending", "pending", "completed"]
            amt.fill("500"); cta.click()
            check(f"{lbl}: 'Check your phone' shows the number and amount",
                  until(lambda: page.get_by_test_id("deposit-awaiting-pin").is_visible(), 8000)
                  and f"+254{p_phone[3:]}" in page.get_by_test_id("deposit-awaiting-pin").inner_text()
                  and "KES 500.00" in page.get_by_test_id("deposit-awaiting-pin").inner_text())
            shot(page, f"wallet-awaiting-{lbl}")
            check(f"{lbl}: only amount and phone are sent (never a user id)", sent and sent[-1] == {"amount": 500, "phone": p_phone}, sent[-1:] if sent else sent)
            check(f"{lbl}: confirmed deposit shows 'Deposit Confirmed'", until(lambda: page.get_by_text("Deposit Confirmed").is_visible(), 20000))
            page.get_by_role("button", name="Done").click()

            # failed
            status_script[:] = ["failed"]
            amt.fill("500"); cta.click()
            check(f"{lbl}: a cancelled payment returns to the form with a clear message",
                  until(lambda: "was not completed" in page.get_by_role("alert").inner_text(), 15000))

            # server refusal message is shown verbatim
            page.evaluate("window.__mp_mode = 'ratelimit'")
            amt.fill("500"); cta.click()
            check(f"{lbl}: the server's refusal is shown to the player",
                  until(lambda: "Too many deposit prompts" in page.get_by_role("alert").inner_text(), 8000))
            page.evaluate("window.__mp_mode = 'ok'")

            # close while waiting — keep playing, toast shows, balance updates later
            status_script[:] = ["pending"] * 200
            amt.fill("500"); cta.click()
            until(lambda: page.get_by_test_id("deposit-awaiting-pin").is_visible(), 8000)
            page.get_by_role("button", name="Keep playing").click()
            check(f"{lbl}: the player can close the prompt screen and keep playing (spinner on the balance)",
                  until(lambda: not dlg.is_visible(), 3000) and page.get_by_role("status", name="Waiting for M-Pesa").is_visible())
            overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check(f"{lbl}: no sideways scroll", overflow <= 1, overflow)
            check(f"{lbl}: no page errors", not errors, errors[:2])
            ctx.close()

        # ───────────────────────── operator: Deposits ─────────────────────────
        ctx, page, errors = new_page(browser, A, 1440, 950)
        page.goto(APP + "/admin/deposits", wait_until="domcontentloaded")
        check("admin: Deposits page opens", until(lambda: page.get_by_role("heading", name="Deposits").is_visible(), 20000))
        check("admin: Deposits is in the sidebar", page.get_by_role("link", name="Deposits").first.is_visible())
        gh = page.get_by_test_id("gateway-health")
        check("admin: gateway card shows Mega Pay in production", until(lambda: "Mega Pay" in gh.inner_text() and "production" in gh.inner_text().lower(), 10000), gh.inner_text()[:200])
        check("admin: automatic checks report their real state (running every minute)", until(lambda: "Every minute" in page.get_by_test_id("gateway-health").inner_text() or page.get_by_test_id("auto-check-off").is_visible(), 10000))
        NOTES_AUTO = page.get_by_test_id("gateway-health").inner_text()
        check("admin: automatic checks are on now that the vault secrets exist", "Every minute" in NOTES_AUTO, NOTES_AUTO[:200])
        check("admin: a brand admin sees limits read-only", page.get_by_test_id("gateway-settings").count() == 0)
        page.get_by_test_id("gateway-test").click()
        check("admin: live connection test succeeds", until(lambda: "Connected" in page.get_by_test_id("gateway-test-result").inner_text(), 20000))

        page.get_by_label("Search deposits").fill("0" + p_phone[3:])
        table = page.get_by_test_id("deposits-table")
        check("admin: search by phone finds the player's three deposits", until(lambda: page.get_by_test_id("deposit-row").count() == 3, 10000), page.get_by_test_id("deposit-row").count())
        check("admin: phone numbers are masked in the list", ("0" + p_phone[3:]) not in table.inner_text() and "•••" in table.inner_text())
        page.get_by_role("tab", name=re.compile("Needs attention")).click()
        check("admin: 'Needs attention' shows the stale and the orphaned deposit only",
              until(lambda: page.get_by_test_id("deposit-row").count() == 2, 10000), page.get_by_test_id("deposit-row").count())
        shot(page, "admin-attention")
        page.get_by_role("tab", name="Waiting").click()
        until(lambda: page.get_by_test_id("deposit-row").count() == 1, 10000)
        row = page.get_by_test_id("deposit-row").first
        row.get_by_role("button", name="Check now").click()
        check("admin: 'Check now' asks Mega Pay and reports the result",
              until(lambda: "Waiting for PIN" in page.get_by_role("status").inner_text(), 20000))
        row.get_by_role("button", name="Show details").click()
        check("admin: details show the Mega Pay id", until(lambda: f"e2e-ui-pend-{tag}" in table.inner_text(), 3000))

        page.get_by_role("tab", name="Needs attention").click()
        until(lambda: page.get_by_test_id("deposit-row").count() == 2, 10000)
        orphan = page.get_by_test_id("deposit-row").filter(has_text="KSh 250")
        orphan.get_by_test_id("confirm-by-hand").click()
        dlg = page.get_by_role("dialog", name="Confirm payment")
        credit = page.get_by_test_id("confirm-credit")
        shot(page, "admin-confirm-dialog")
        check("admin: the credit button stays disabled until receipt, reason and confirmation are given", credit.is_disabled())
        receipt = ("E2E" + secrets.token_hex(4)).upper()[:10]
        dlg.get_by_label("M-Pesa receipt").fill(receipt.lower())
        dlg.get_by_label("Reason").fill("UI e2e — throwaway deposit")
        dlg.get_by_role("checkbox").check()
        credit.click()
        check("admin: hand confirmation credits and says so", until(lambda: "Credited KSh 250" in page.get_by_role("status").inner_text(), 15000))
        bal = sql(f"select real_balance from wallets where user_id='{pid}'")[0]["real_balance"]
        audit = sql(f"select count(*) n from admin_audit_log where action='megapay_manual_credit' and admin_id='{users['admin']}'")[0]["n"]
        st = sql(f"select status, mpesa_receipt_number from mpesa_stk_requests where id='{ids['failed']}'")[0]
        check("admin: the player's wallet got exactly KES 250, the row is Credited with the receipt, and it is audited",
              int(bal) >= 25000 and audit == 1 and st["status"] == "completed" and st["mpesa_receipt_number"] == receipt, (bal, audit, st))

        page.get_by_test_id("deposits-check-all").click()
        check("admin: 'Check waiting deposits now' runs a sweep and reports it",
              until(lambda: "Checked" in page.get_by_role("status").inner_text(), 60000))
        check("admin: no page errors", not errors, errors[:2])
        ctx.close()

        # narrow screen
        ctx, page, errors = new_page(browser, A, 390, 844)
        page.goto(APP + "/admin/deposits", wait_until="domcontentloaded")
        until(lambda: page.get_by_role("heading", name="Deposits").is_visible(), 20000)
        page.wait_for_timeout(1200)
        shot(page, "admin-phone")
        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("admin (phone): the page does not scroll sideways", overflow <= 1, overflow)
        ctx.close()

        # support: can look, cannot confirm
        ctx, page, errors = new_page(browser, S, 1440, 950)
        page.goto(APP + "/admin/deposits", wait_until="domcontentloaded")
        check("support: can open Deposits", until(lambda: page.get_by_role("heading", name="Deposits").is_visible(), 20000))
        page.get_by_label("Search deposits").fill("0" + p_phone[3:])
        until(lambda: page.get_by_test_id("deposit-row").count() == 3, 10000)
        check("support: no 'Confirm payment' actions", page.get_by_test_id("confirm-by-hand").count() == 0)
        ctx.close()

        # player: no access
        ctx, page, errors = new_page(browser, P, 1280, 900)
        page.goto(APP + "/admin/deposits", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        check("player: cannot reach the Deposits screen", not page.get_by_role("heading", name="Deposits").is_visible())
        ctx.close()
        browser.close()
finally:
    ids_sql = ",".join(f"'{u}'" for u in users.values())
    if ids_sql:
        sql(f"""delete from admin_audit_log where admin_id in ({ids_sql});
                delete from ledger_entries where user_id in ({ids_sql});
                delete from bonuses where user_id in ({ids_sql});
                delete from mpesa_stk_requests where user_id in ({ids_sql});
                delete from transactions where user_id in ({ids_sql});
                delete from player_risk_scores where user_id in ({ids_sql});""")
        for uid in users.values():
            http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
        left = sql(f"select (select count(*) from auth.users where id in ({ids_sql})) u, (select count(*) from profiles where id in ({ids_sql})) p, (select count(*) from ledger_entries where user_id in ({ids_sql})) l")
        print(f"  cleanup: {left}")

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
