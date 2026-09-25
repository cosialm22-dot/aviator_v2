#!/usr/bin/env python3
"""Live engine e2e: plays real rounds on production with throwaway players and checks the rules,
the money, the timing and the broadcast stream. Everything created is removed at the end.

Per round:
  P1 slot 1: KES 100, auto cash-out 1.20x      P1 slot 2: KES 100, auto cash-out 50x
  P2 slot 1: KES 200, cashed out by hand ~0.4 s after take-off
Checks: each outcome follows the crash point exactly; winnings are floor(stake × multiplier);
wallet deltas equal winnings − stakes to the cent; nobody can read the crash time or crash point
before the crash (REST or broadcast); the crash is processed close to its secret instant;
auto cash-outs happen close to their exact instant; no bot rows are written.

  LISTENER="node <dir>/broadcast_listener.mjs" SUPABASE_URL=… SUPABASE_SECRET_KEY=… \
  SUPABASE_PUBLISHABLE_KEY=… SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… ROUNDS=3 python3 supabase/tests/engine_live_e2e.py
"""
import datetime as dt, json, math, os, decimal, secrets, subprocess, sys, tempfile, time, urllib.request

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
users, tokens = {}, {}

def make_player(kind):
    phone = "2547" + str(secrets.randbelow(10**8)).zfill(8)
    email, pw = f"{phone}@phone.aviator.ke", secrets.token_urlsafe(18)
    st, u = http("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                 "user_metadata": {"username": f"eng{kind}{tag}", "phone": phone}}, admin_h)
    if st >= 300: raise SystemExit(f"create {kind}: {st} {u}")
    users[kind] = u["id"]
    st, t = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})
    tokens[kind] = t["access_token"]

def rpc(kind, fn, body):
    return http("POST", f"{URL}/rest/v1/rpc/{fn}", body, {"apikey": PUB, "Authorization": f"Bearer {tokens[kind]}"})

def cents(kind):
    return int(sql(f"select real_balance from wallets where user_id='{users[kind]}'")[0]["real_balance"])

def live_round():
    st, r = http("GET", f"{URL}/rest/v1/game_rounds?select=id,round_number,status,betting_ends_at,started_at,crash_multiplier,server_seed&status=in.(waiting,flying)&order=round_number.desc&limit=1", None, {"apikey": PUB})
    return (r[0] if isinstance(r, list) and r else None), st, r

listener = None
events_path = os.path.join(tempfile.mkdtemp(), "events.jsonl")
try:
    for k in ("p1", "p2"): make_player(k)
    sql(f"update wallets set real_balance = 1000000, bonus_balance = 0 where user_id in ('{users['p1']}','{users['p2']}')")
    if os.environ.get("LISTENER"):
        env = {**os.environ, "OUT": events_path, "DUR": str(40 * ROUNDS + 30)}
        listener = subprocess.Popen(os.environ["LISTENER"].split(), env=env, cwd=os.environ.get("LISTENER_CWD"))
        time.sleep(4)

    played = []
    for n in range(ROUNDS):
        # wait for a fresh betting window with at least 2 s left
        r = None
        for _ in range(300):
            w = sql("select id from game_rounds where status='waiting' and betting_ends_at - clock_timestamp() > interval '3.5 seconds' limit 1")
            if w and all(p["id"] != w[0]["id"] for p in played):
                r = {"id": w[0]["id"]}; break
            time.sleep(0.2)
        rid = r["id"]
        b0 = {k: cents(k) for k in ("p1", "p2")}
        # place the three bets concurrently (sequential calls through a slow link can miss the window)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(3) as ex:
            f1 = ex.submit(rpc, "p1", "place_bet", {"p_round_id": rid, "p_amount": 100, "p_auto_cashout": 1.20, "p_slot": 1})
            f2 = ex.submit(rpc, "p1", "place_bet", {"p_round_id": rid, "p_amount": 100, "p_auto_cashout": 50, "p_slot": 2})
            f3 = ex.submit(rpc, "p2", "place_bet", {"p_round_id": rid, "p_amount": 200, "p_slot": 1})
            (s1, x1), (s2, x2), (s3, x3) = f1.result(), f2.result(), f3.result()
        check(f"round {n+1}: three bets accepted", s1 < 300 and s2 < 300 and s3 < 300,
              (s1, s2, s3, x3, sql(f"select status, betting_ends_at, clock_timestamp() now from game_rounds where id='{rid}'")))
        if s3 >= 300: continue
        # wait for take-off; peek at what the public can see while flying
        for _ in range(200):
            r, _, _ = live_round()
            if r and r["id"] == rid and r["status"] == "flying": break
            time.sleep(0.05)
        check(f"round {n+1}: in flight the public sees no crash point or seed",
              r and r.get("crash_multiplier") is None and r.get("server_seed") is None, r)
        st_ca, body_ca = http("GET", f"{URL}/rest/v1/game_rounds?select=crashes_at&id=eq.{rid}", None, {"apikey": PUB})
        check(f"round {n+1}: the crash-time column cannot be read at all", st_ca in (401, 403) and "permission denied" in str(body_ca), (st_ca, body_ca))
        time.sleep(0.4)
        sc, co = rpc("p2", "cash_out", {"p_round_id": rid, "p_slot": 1})
        # wait for the crash
        for _ in range(3000):
            g = sql(f"select status, crash_multiplier, crashed_at, started_at from game_rounds where id='{rid}'")[0]
            if g["status"] == "crashed": break
            time.sleep(0.25)
        cp = float(g["crash_multiplier"])
        sec = sql(f"select crashes_at, crash_point from round_secrets where round_id='{rid}'")[0]
        bets = {(b["user_id"], b["slot"]): b for b in sql(f"select user_id, slot, status, cashout_multiplier, winnings, amount from bets where round_id='{rid}' and user_id in ('{users['p1']}','{users['p2']}')")}
        a = {k: cents(k) for k in ("p1", "p2")}
        exp_p1, exp_p2 = -20000, -20000
        # P1 slot 1 (1.20x)
        b = bets[(users["p1"], 1)]
        if cp > 1.20:
            check(f"round {n+1} (crash {cp}x): 1.20x auto cash-out won exactly KES 120", b["status"] == "won" and float(b["cashout_multiplier"]) == 1.20 and float(b["winnings"]) == 120, b)
            exp_p1 += 12000
        else:
            check(f"round {n+1} (crash {cp}x): 1.20x auto cash-out lost (crash came first)", b["status"] == "lost", b)
        b = bets[(users["p1"], 2)]
        if cp > 50:
            check(f"round {n+1}: 50x auto cash-out won KES 5,000", b["status"] == "won" and float(b["winnings"]) == 5000, b); exp_p1 += 500000
        else:
            check(f"round {n+1}: 50x auto cash-out lost", b["status"] == "lost", b)
        b = bets[(users["p2"], 1)]
        if sc < 300:
            m = float(co["multiplier"])
            check(f"round {n+1}: manual cash-out at {m}x paid floor(200 × {m})", b["status"] == "won" and decimal.Decimal(b["winnings"]) == (decimal.Decimal(200) * decimal.Decimal(str(m))).quantize(decimal.Decimal("0.01"), rounding=decimal.ROUND_FLOOR) and m < cp, (b, co))
            exp_p2 += int(round(float(b["winnings"]) * 100))
        else:
            check(f"round {n+1}: manual cash-out refused only because the round had crashed", co.get("message", "").split(":")[0] in ("ROUND_CRASHED", "BET_NOT_ACTIVE", "ROUND_NOT_FLYING"), co)
            check(f"round {n+1}: …and that bet lost", b["status"] == "lost", b)
        check(f"round {n+1}: wallets moved by exactly winnings − stakes", a["p1"] - b0["p1"] == exp_p1 and a["p2"] - b0["p2"] == exp_p2,
              {"p1": (a["p1"] - b0["p1"], exp_p1), "p2": (a["p2"] - b0["p2"], exp_p2)})
        lag = sql(f"select extract(epoch from (g.crashed_at - s.crashes_at))*1000 ms from game_rounds g join round_secrets s on s.round_id=g.id where g.id='{rid}'")[0]["ms"]
        NOTES.append(f"round {n+1}: crash {cp}x processed {float(lag):.0f} ms after its instant")
        check(f"round {n+1}: crash processed within 60 ms of its secret instant ({float(lag):.0f} ms)", -5 <= float(lag) <= 60, lag)
        st_lag = sql(f"select extract(epoch from (g.started_at - g.betting_ends_at))*1000 ms from game_rounds g where g.id='{rid}'")[0]["ms"]
        NOTES.append(f"round {n+1}: take-off stamped {float(st_lag):.0f} ms after betting closed")
        check(f"round {n+1}: take-off stamped at (not before) the close of betting, within 60 ms", -5 <= float(st_lag) <= 60, st_lag)
        played.append({"id": rid, "cp": cp, "crashes_at": sec["crashes_at"], "started_at": g["started_at"]})

    nb = sql("select count(*) n from bets where is_bot")[0]["n"]
    check("no bot rows are written any more", nb == 0, nb)

    if listener:
        listener.wait()
        ev = [json.loads(l) for l in open(events_path) if l.strip()]
        rounds_ev = [e for e in ev if e["event"] == "round"]
        check("the broadcast stream is live", any(e["event"] == "status" and e["payload"] == "SUBSCRIBED" for e in ev), ev[:3])
        leaked = [e for e in rounds_ev if e["payload"].get("status") != "crashed" and (e["payload"].get("crash_multiplier") is not None or e["payload"].get("server_seed") is not None or "crashes_at" in e["payload"])]
        check("broadcast never carries the crash time, crash point or seed before the crash", not leaked, leaked[:1])
        for p in played:
            seen = {e["payload"]["status"]: e for e in rounds_ev if e["payload"]["id"] == p["id"]}
            check(f"round {p['id'][:8]}: waiting, flying and crashed events all arrived", set(seen) >= {"waiting", "flying", "crashed"}, list(seen))
            if "crashed" in seen:
                c = seen["crashed"]
                check(f"round {p['id'][:8]}: crash event carries the revealed crash point", float(c["payload"]["crash_multiplier"]) == p["cp"], c)
                sent = dt.datetime.fromisoformat(c["payload"]["sent_at"]).timestamp()
                NOTES.append(f"round {p['id'][:8]}: crash event delivered {(c['at'] / 1000 - sent) * 1000:.0f} ms after it was sent (clock skew included)")
        mine = [e for e in ev if e["event"] == "bet" and e["payload"].get("user_id") in users.values()]
        check("bet events arrive for placed, won and lost bets", {e["payload"]["status"] for e in mine} >= {"active", "won"} , {e["payload"]["status"] for e in mine})
finally:
    if listener and listener.poll() is None: listener.kill()
    ids = ",".join(f"'{u}'" for u in users.values())
    if ids:
        sql(f"""delete from ledger_entries where user_id in ({ids}); delete from bonuses where user_id in ({ids});
                delete from transactions where user_id in ({ids}); delete from bets where user_id in ({ids});
                delete from player_risk_scores where user_id in ({ids});""")
        for uid in users.values(): http("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, admin_h)
        print("  cleanup:", sql(f"select (select count(*) from auth.users where id in ({ids})) u, (select count(*) from bets where user_id in ({ids})) b"))
for n in NOTES: print("  note:", n)
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
