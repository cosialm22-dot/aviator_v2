#!/usr/bin/env python3
"""Brand console in the browser, LIVE, as a real platform admin (multi-brand step 4).

Creates a throwaway platform with a platform admin, a brand under it (and one outside it), a
marketer and a brand owner, then drives the console:
  * the brands list shows only the platform's brands, drawn in their own look
  * a look from the gallery + a plane + a bird + words + a switch + a limit, saved in ONE version
  * the public brand payload carries exactly what was saved; the history shows the diff
  * validation errors come back as plain words; a stale save is refused (optimistic concurrency)
  * restore an earlier version
  * upload a plane image (Storage, brand-scoped) and fly it
  * the new-brand wizard creates a brand with a look and a marketer
  * a brand owner sees only brand-tier settings as editable
Everything created is removed at the end.

  APP_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=…
  [HOST_MAP=… PROXY_BYPASS=…] [SHOTS=dir] python3 e2e/brand_console_e2e.py
"""
import base64, json, os, re, secrets, sys, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws_bridge  # noqa: E402

APP = os.environ.get("APP_URL", "http://aviator.test/").rstrip("/")
URL, SECRET, PUB = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"], os.environ["SUPABASE_PUBLISHABLE_KEY"]
TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
SHOTS = os.environ.get("SHOTS")
PASS, FAIL = [], []

def bar_text(pg):
    """The save bar's words, or '' when it has closed (it auto-dismisses after a success)."""
    try: return pg.get_by_test_id("save-bar").inner_text(timeout=1500)
    except Exception: return ""

def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(info)[:400]}"))

def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            try: t = raw.decode()
            except UnicodeDecodeError: return r.status, {"bytes": len(raw), "type": r.headers.get("content-type")}
            return r.status, (json.loads(t) if t else {})
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

def make_user(k):
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": {"username": f"bc{k}{tag}", "phone": phone}}, admin_h)
    if st >= 300: raise SystemExit(f"create {k}: {st} {u}")
    users[k] = u["id"]
    sessions[k] = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})[1]

launch = {"args": []}
if os.environ.get("HOST_MAP"): launch["args"].append(f"--host-resolver-rules={os.environ['HOST_MAP']}")
if os.environ.get("HTTPS_PROXY"): launch["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": os.environ.get("PROXY_BYPASS", "")}

plat = site_b = site_x = new_site = None
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAKklEQVR42mP8z8BQzzAKRgEo0Bj/M4wGFBFG6+g0YBSPBtRoQI0G1MgGAAAQ7wv/4VbnJgAAAABJRU5ErkJggg==")
try:
    for k in ("pa", "own", "mk", "mk2"): make_user(k)
    plat = sql(f"insert into platforms(slug, name) values ('bc-{tag}', 'BC {tag}') returning id")[0]["id"]
    site_b = sql(f"insert into sites(slug, name, status, platform_id) values ('bc-{tag}', 'Console {tag}', 'active', '{plat}') returning id")[0]["id"]
    site_x = sql(f"insert into sites(slug, name, status) values ('bcx-{tag}', 'Outside {tag}', 'disabled') returning id")[0]["id"]
    sql(f"update profiles set role='platform_admin', platform_id='{plat}' where id='{users['pa']}'")
    sql(f"update profiles set site_id='{site_b}' where id in ('{users['own']}','{users['mk']}'); update wallets set site_id='{site_b}' where user_id in ('{users['own']}','{users['mk']}')")
    sql(f"update profiles set role='super_admin' where id='{users['own']}'")
    sql(f"update profiles set role='marketer' where id in ('{users['mk']}','{users['mk2']}'); select public._ensure_referral_code(id) from profiles where id in ('{users['mk']}','{users['mk2']}')")
    sql(f"update profiles set site_id='{site_b}' where id='{users['mk2']}'; update wallets set site_id='{site_b}' where user_id='{users['mk2']}'")

    with sync_playwright() as p:
        b = p.chromium.launch(**launch)
        def open_as(k, path):
            ctx = b.new_context(viewport={"width": 1440, "height": 1000}, service_workers="block")
            ctx.add_init_script(f"try {{ localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sessions[k]))}); }} catch (e) {{}}")
            ws_bridge.install(ctx)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(APP + path, wait_until="domcontentloaded")
            return ctx, pg, errs
        def until(fn, ms=15000):
            end = time.time() + ms / 1000
            while time.time() < end:
                ws_bridge.pump()
                try:
                    if fn(): return True
                except Exception: pass
                time.sleep(0.1)
            return False
        def shot(pg, n):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, f"{n}.png"), full_page=True)

        print("platform admin")
        ctx, pg, errs = open_as("pa", "/admin/brands")
        check("brands list shows the platform's brand", until(lambda: pg.get_by_test_id(f"brand-card-bc-{tag}").is_visible(), 20000))
        check("…and not a brand outside the platform", pg.get_by_test_id(f"brand-card-bcx-{tag}").count() == 0)
        nav = pg.locator("nav").inner_text()
        check("platform admin nav: Brands, no Controls / Platforms / Game control", "Brands" in nav and "Controls" not in nav and "Platforms" not in nav and "Game control" not in nav, nav)
        shot(pg, "brands")
        pg.get_by_test_id(f"brand-card-bc-{tag}").click()
        check("brand page opens with the live preview", until(lambda: pg.get_by_test_id("brand-preview").is_visible(), 15000))
        pg.get_by_role("tab", name="Look").click()
        pg.get_by_test_id("look-midnight-gold").click()
        check("applying a look shows unsaved changes", until(lambda: "unsaved change" in bar_text(pg), 5000))
        prev_cta = pg.get_by_test_id("brand-preview").evaluate("e => getComputedStyle(e.firstElementChild).getPropertyValue('--g-cta').trim()")
        check("the preview wears the look before saving", prev_cta == "240 185 11", prev_cta)
        shot(pg, "look")
        pg.get_by_role("tab", name="Plane & bird").click()
        pg.get_by_test_id("plane-rocket").click()
        pg.get_by_test_id("bird-flamingo").click()
        pg.get_by_role("tab", name="Content").click()
        pg.get_by_test_id("identity-wordmark_text").fill("RocketGold")
        pg.get_by_test_id("bs-copy-flew_away").fill("BLAST OFF")
        pg.get_by_test_id("bs-support-whatsapp").fill("0712345678")
        pg.get_by_role("tab", name="Features").click()
        pg.get_by_test_id("bs-features-chat").click()
        pg.get_by_role("tab", name="Limits & bonuses").click()
        pg.get_by_test_id("bs-limits-max_withdrawal").fill("25000")
        shot(pg, "limits")
        n = bar_text(pg)
        pg.get_by_label("Change note").fill("e2e: launch look")
        pg.get_by_test_id("save-brand").click()
        check("save succeeds", until(lambda: "Saved." in bar_text(pg), 15000), bar_text(pg))
        row = sql(f"select config_version v, config, wordmark_text w, theme_tokens->>'brand' b from sites where id='{site_b}'")[0]
        cfg = row["config"]
        check("one version with everything", row["v"] == 2 and row["w"] == "RocketGold" and row["b"] == "#f0b90b" and cfg.get("plane.model") == "rocket"
              and cfg.get("stream.bird") == "flamingo" and cfg.get("copy.flew_away") == "BLAST OFF" and cfg.get("features.chat") is False
              and cfg.get("limits.max_withdrawal") == 25000 and cfg.get("support.whatsapp") == "+254712345678" and cfg.get("look.theme_id") == "midnight-gold", (n, row))
        st, pub = http("POST", f"{URL}/rest/v1/rpc/public_site_by_host", {"p_host": "x.invalid", "p_slug": f"bc-{tag}"}, {"apikey": PUB})
        check("public payload carries the saved brand", pub.get("config", {}).get("plane.model") == "rocket" and pub.get("theme_tokens", {}).get("brand") == "#f0b90b" and pub.get("wordmark_text") == "RocketGold", pub.get("config", {}).get("plane.model"))
        pg.get_by_role("tab", name="History").click()
        check("history shows the change with its note and diff", until(lambda: "e2e: launch look" in pg.get_by_test_id("version-2").inner_text() and "BLAST OFF" in pg.get_by_test_id("version-2").inner_text(), 10000))
        shot(pg, "history")

        # validation in plain words
        pg.get_by_role("tab", name="Limits & bonuses").click()
        pg.get_by_test_id("bs-limits-min_bet").fill("99999999")
        pg.get_by_test_id("save-brand").click()
        check("an invalid value comes back in plain words", until(lambda: "Minimum bet:" in bar_text(pg), 10000), bar_text(pg))
        pg.get_by_role("button", name="Discard").click()
        # stale save: someone else saves meanwhile
        sql(f"update sites set config = config || '{{\"copy.tagline\":\"from elsewhere\"}}', config_version = config_version + 1 where id='{site_b}'")
        pg.get_by_role("tab", name="Content").click()
        pg.get_by_test_id("bs-copy-announcement").fill("Race you")
        pg.get_by_test_id("save-brand").click()
        check("a stale save is refused with a reload offer", until(lambda: "Someone else saved" in bar_text(pg), 10000))
        pg.get_by_test_id("save-bar").get_by_role("button", name="Reload").click()
        pg.wait_for_timeout(1500)
        pg.get_by_role("button", name="Discard").click() if pg.get_by_role("button", name="Discard").count() else None

        # restore version 1
        pg.get_by_role("tab", name="History").click()
        until(lambda: pg.get_by_test_id("restore-1").is_visible(), 10000)
        pg.get_by_test_id("restore-1").click(); pg.get_by_test_id("restore-1-confirm").click()
        check("restoring version 1 brings the classic look back", until(lambda: sql(f"select coalesce(config->>'plane.model','classic') m from sites where id='{site_b}'")[0]["m"] == "classic", 10000))

        # upload a plane
        pg.get_by_role("tab", name="Plane & bird").click()
        pg.get_by_test_id("plane-upload").set_input_files({"name": "plane.png", "mimeType": "image/png", "buffer": PNG})
        check("uploaded plane selects the custom model", until(lambda: pg.get_by_test_id("plane-custom").get_attribute("aria-checked") == "true", 15000))
        v0 = sql(f"select config_version v from sites where id='{site_b}'")[0]["v"]
        pg.get_by_test_id("save-brand").click()
        saved = until(lambda: sql(f"select config_version v from sites where id='{site_b}'")[0]["v"] > v0, 15000)
        url = sql(f"select config->>'plane.image_url' u from sites where id='{site_b}'")[0]["u"] or ""
        check("the image lives in the brand's own storage folder", saved and f"/brand-assets/{site_b}/plane/" in url, (saved, url, bar_text(pg)))
        st, _ = http("GET", url) if url else (0, None)
        check("…and is publicly readable", st == 200, st)

        # wizard
        pg.goto(APP + "/admin/brands", wait_until="domcontentloaded")
        until(lambda: pg.get_by_test_id("new-brand").is_visible(), 15000)
        pg.get_by_test_id("new-brand").click()
        pg.get_by_test_id("wizard-name").fill(f"Wizard {tag}")
        pg.get_by_test_id("wizard-next").click()
        pg.get_by_test_id("wizard-look-ocean-blue").click()
        pg.get_by_test_id("wizard-next").click()
        pg.get_by_label("Find marketer").fill(f"bcmk{tag}")
        found = until(lambda: pg.get_by_role("button", name=re.compile(f"bcmk{tag}")).count() > 0, 10000)
        shot(pg, "wizard-marketer")
        check("wizard finds the marketer", found, pg.get_by_role("dialog").inner_text()[:300])
        if found: pg.get_by_role("button", name=re.compile(f"bcmk{tag}")).first.click()
        pg.get_by_test_id("wizard-create").click()
        check("wizard lands on the new brand's Domains tab", until(lambda: "tab=domains" in pg.evaluate("location.href"), 15000), pg.evaluate("location.href"))
        r = sql(f"select id, platform_id, theme_tokens->>'brand' b, config->>'plane.model' m, default_marketer_id d from sites where slug = 'wizard-{tag}'")
        new_site = r[0]["id"] if r else None
        check("new brand: in the platform, with the look and the marketer", bool(r) and r[0]["platform_id"] == plat and r[0]["b"] == "#0a84ff" and r[0]["m"] == "concorde" and r[0]["d"] == users["mk"], r)
        check("no page errors (platform admin)", not errs, errs[:3])
        ctx.close()

        print("brand owner")
        ctx, pg, errs = open_as("own", "/admin/brands")
        check("brand owner goes straight to its brand", until(lambda: f"/admin/brands/{site_b}" in pg.evaluate("location.href") and pg.get_by_test_id("brand-preview").is_visible(), 20000), pg.evaluate("location.href"))
        pg.get_by_role("tab", name="Look").click()
        check("look is read-only for a brand owner", until(lambda: pg.get_by_test_id("look-ocean-blue").is_disabled(), 5000))
        pg.get_by_role("tab", name="Content").click()
        pg.get_by_test_id("bs-copy-tagline").fill("Owner words")
        pg.get_by_test_id("save-brand").click()
        check("…but it saves its own words", until(lambda: "Saved." in bar_text(pg), 10000), bar_text(pg))
        pg.get_by_role("tab", name="Limits & bonuses").click()
        check("limits are locked for a brand owner", pg.get_by_test_id("bs-limits-min_bet").is_disabled())
        check("no page errors (brand owner)", not errs, errs[:3])
        ctx.close()
        b.close()
finally:
    # this run's fixtures only (same pattern as admin_ui_e2e.py)
    sites = [x for x in (new_site, site_b, site_x) if x]
    for s in sites:
        try:
            objs = [r["name"] for r in sql(f"select name from storage.objects where bucket_id='brand-assets' and name like '{s}/%'")]
            if objs: http("DELETE", f"{URL}/storage/v1/object/brand-assets", {"prefixes": objs}, admin_h)
        except Exception as e: print("cleanup storage:", str(e)[:120])
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"""delete from admin_audit_log where admin_id in ({ids}) or target_id in (select id::text from profiles where id in ({ids}));
                delete from referrals where marketer_id in ({ids}) or player_id in ({ids});
                update sites set default_marketer_id = null where default_marketer_id in ({ids});
                delete from ledger_entries where user_id in ({ids}); delete from bonuses where user_id in ({ids});
                delete from transactions where user_id in ({ids});""")
        for uid in users.values(): http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
    for s in sites:
        try: sql(f"delete from admin_audit_log where site_id='{s}'; delete from wallets where site_id='{s}'; delete from profiles where site_id='{s}'; delete from sites where id='{s}'")
        except Exception as e: print("cleanup site:", str(e)[:160])
    if plat:
        try: sql(f"delete from admin_audit_log where target_id='{plat}'; delete from platforms where id='{plat}'")
        except Exception as e: print("cleanup platform:", str(e)[:120])
    if ids:
        print("  cleanup:", sql(f"select (select count(*) from auth.users where id in ({ids})) u, (select count(*) from sites where slug like '%{tag}%') s, (select count(*) from platforms where slug like '%{tag}%') p"))

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
