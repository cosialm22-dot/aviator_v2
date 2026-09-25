#!/usr/bin/env python3
"""Run the self-contained SQL e2e files against the live project — ALWAYS inside BEGIN … ROLLBACK.

Some of these files end in RAISE EXCEPTION (the result travels in the error and the transaction dies
with it); others end in RAISE NOTICE when they pass and rely on the CALLER to roll back. Sent on
their own through an autocommit client, the second kind COMMITS its fixtures (users, synthetic
rounds numbered 900000+, config toggles) into production — which once parked the live game behind a
fake "waiting" round for five minutes (BUGLOG #32). This runner is the only supported way to run
them: every file is wrapped in BEGIN; …; ROLLBACK; and a pass is only reported when the ROLLBACK
itself ran (i.e. the file did not raise).

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/run_sql_tests.py [file.sql …]
"""
import glob, json, os, re, sys, urllib.request

TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]
HERE = os.path.dirname(os.path.abspath(__file__))

def run(sql: str):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

files = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "*.sql")))
bad = 0
for f in files:
    body = open(f, encoding="utf-8").read()
    if re.search(r"^\s*COMMIT\s*;", body, re.M | re.I):
        print(f"  [SKIP] {os.path.basename(f)}: contains COMMIT — refusing to run it against production"); bad += 1; continue
    st, out = run("BEGIN;\nSET LOCAL lock_timeout = '15s';\nSET LOCAL statement_timeout = '120s';\n" + body + "\nROLLBACK;")
    try: msg = json.loads(out).get("message", "") if out.startswith("{") else ""
    except Exception: msg = out
    name = os.path.basename(f)
    if st < 300:
        ok = True; detail = "passed (NOTICE); rolled back"
    else:
        m = re.search(r"\|ok=(t|f)\|(.*?)(\nCONTEXT|$)", msg, re.S)
        if m:
            ok = m.group(1) == "t"; detail = m.group(2).strip()[:600]
        else:
            ok = False; detail = msg.replace("Failed to run sql query: ", "")[:600]
    bad += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {detail}"))
print(f"\n{len(files) - bad} passed, {bad} failed (every file rolled back)")
sys.exit(1 if bad else 0)
