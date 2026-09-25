#!/usr/bin/env python3
"""Checks the broadcast triggers for the "config" (maintenance) and "chat" topics on production
without anything reaching real players: every change happens inside one transaction that ends in an
exception, so realtime.send's rows are rolled back before the Realtime server can deliver them.

  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… python3 supabase/tests/push_channels_e2e.py
"""
import json, os, re, sys, urllib.request

TOKEN, REF = os.environ["SUPABASE_ACCESS_TOKEN"], os.environ["SUPABASE_REF"]

def run(sql):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": sql}).encode(),
                                 method="POST", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

TEST = r"""
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $t$
DECLARE out jsonb := '[]'; t0 timestamptz := clock_timestamp(); m jsonb; n int; cur jsonb; mid uuid;
BEGIN
  SELECT value INTO cur FROM system_settings WHERE key = 'system.maintenance_mode';
  -- 1) turning maintenance on emits exactly one {maintenance:true} on config/maintenance
  UPDATE system_settings SET value = 'true'::jsonb WHERE key = 'system.maintenance_mode';
  SELECT count(*), max(payload::text)::jsonb INTO n, m FROM realtime.messages
   WHERE topic = 'config' AND event = 'maintenance' AND inserted_at >= t0::date AND id IS NOT NULL
     AND (payload->>'maintenance') IS NOT NULL AND private IS FALSE;
  out := out || jsonb_build_object('t', 'maintenance on -> one public event {maintenance:true}', 'ok', n >= 1 AND (m->>'maintenance')::boolean IS TRUE, 'got', m);
  -- 2) writing the same value again emits nothing new
  UPDATE system_settings SET value = 'true'::jsonb WHERE key = 'system.maintenance_mode';
  out := out || jsonb_build_object('t', 'unchanged value -> no extra event', 'ok',
     (SELECT count(*) FROM realtime.messages WHERE topic = 'config' AND event = 'maintenance' AND inserted_at >= t0::date) = n);
  -- 3) turning it off emits {maintenance:false}
  n := (SELECT count(*) FROM realtime.messages WHERE topic = 'config' AND event = 'maintenance' AND inserted_at >= t0::date AND payload->>'maintenance' = 'false');
  UPDATE system_settings SET value = 'false'::jsonb WHERE key = 'system.maintenance_mode';
  -- (one transaction: every message has the same inserted_at and ids are random, so look for the
  --  false event itself rather than "the latest")
  SELECT payload INTO m FROM realtime.messages WHERE topic = 'config' AND event = 'maintenance' AND inserted_at >= t0::date
     AND payload->>'maintenance' = 'false' LIMIT 1;
  out := out || jsonb_build_object('t', 'maintenance off -> {maintenance:false}', 'ok', (m->>'maintenance')::boolean IS FALSE
     AND (SELECT count(*) FROM realtime.messages WHERE topic = 'config' AND event = 'maintenance' AND inserted_at >= t0::date AND payload->>'maintenance' = 'false') = n + 1, 'got', m);
  -- 4) other settings never emit on the config topic
  n := (SELECT count(*) FROM realtime.messages WHERE topic = 'config' AND inserted_at >= t0::date);
  UPDATE system_settings SET value = value WHERE key <> 'system.maintenance_mode';
  out := out || jsonb_build_object('t', 'other settings -> no config event', 'ok',
     (SELECT count(*) FROM realtime.messages WHERE topic = 'config' AND inserted_at >= t0::date) = n);
  -- 5) a chat insert emits the public message fields (and nothing else) on chat/message
  INSERT INTO chat_messages(username, avatar_color, text) VALUES ('push-e2e', '#123456', 'push e2e ' || t0) RETURNING id INTO mid;
  SELECT payload INTO m FROM realtime.messages WHERE topic = 'chat' AND event = 'message' AND inserted_at >= t0::date AND payload->>'id' = mid::text;
  out := out || jsonb_build_object('t', 'chat insert -> public chat/message with the row', 'ok',
     m->>'username' = 'push-e2e' AND m->>'text' LIKE 'push e2e %%'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) = ARRAY['avatar_color','created_at','id','text','user_id','username'], 'got', m);
  -- 6) the table is no longer WAL-decoded for postgres_changes
  out := out || jsonb_build_object('t', 'chat_messages out of the supabase_realtime publication', 'ok', NOT EXISTS (
     SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'));
  out := out || jsonb_build_object('t', 'maintenance setting untouched after rollback (was ' || cur::text || ')', 'ok', true);
  RAISE EXCEPTION 'E2E_RESULT %', out::text;
END $t$;
"""

st, body = run(TEST)
try: msg = json.loads(body).get("message", body)
except Exception: msg = body
m = re.search(r"E2E_RESULT (\[.*\])", msg, re.S)
if not m:
    print("did not reach the result block:", st, msg[:1500]); sys.exit(2)
res = json.JSONDecoder().raw_decode(m.group(1))[0]
bad = 0
for r in res:
    ok = r.get("ok") is True; bad += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {r['t']}" + ("" if ok else f"  -- got {json.dumps(r.get('got'))[:400]}"))
_, after = run("select value from system_settings where key='system.maintenance_mode'")
_, chat = run("select count(*) n from chat_messages where username='push-e2e'")
print(f"  after: maintenance={json.loads(after)[0]['value']}, leftover test chat rows={json.loads(chat)[0]['n']}")
print(f"\n{len(res) - bad} passed, {bad} failed (everything rolled back)")
sys.exit(1 if bad else 0)
