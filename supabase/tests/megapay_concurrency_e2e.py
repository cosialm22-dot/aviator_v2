#!/usr/bin/env python3
"""Concurrency e2e for fn_megapay_settle: many sessions settle the SAME deposit at the same moment
(player polling + the reconcile job + an admin "check now") — exactly one credit must happen.

Runs on a local Postgres (needs two+ real sessions, which the Management API can't give). It builds
a minimal replica of the tables the migration touches, with a deposit-credit trigger equivalent to
the live fn_credit_mpesa_deposit, then applies the real migration file.

  PGHOST=/tmp PGPORT=5433 python3 supabase/tests/megapay_concurrency_e2e.py
"""
import os, re, threading, psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "migrations", "20260925100000_megapay_gateway.sql")
HOST, PORT, DB = os.environ.get("PGHOST", "/tmp"), int(os.environ.get("PGPORT", "5433")), "megapay_conc_test"

REPLICA = r"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE sites(id uuid PRIMARY KEY, name text, wordmark_text text);
INSERT INTO sites VALUES ('00000000-0000-0000-0000-000000000001','Aviator',NULL);
CREATE TABLE profiles(id uuid PRIMARY KEY, role text DEFAULT 'player', is_banned boolean DEFAULT false,
  total_deposited numeric DEFAULT 0, last_active_at timestamptz, site_id uuid DEFAULT '00000000-0000-0000-0000-000000000001');
CREATE TABLE wallets(user_id uuid PRIMARY KEY, real_balance bigint NOT NULL DEFAULT 0);
CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, amount numeric,
  payment_method text, reference text, description text, status text DEFAULT 'completed', created_at timestamptz DEFAULT now(),
  site_id uuid DEFAULT '00000000-0000-0000-0000-000000000001');
CREATE FUNCTION fn_credit_mpesa_deposit() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.type='deposit' AND coalesce(NEW.payment_method,'')='mpesa' AND NEW.status='completed' THEN
    UPDATE wallets SET real_balance = real_balance + round(NEW.amount*100)::bigint WHERE user_id = NEW.user_id;
  END IF; RETURN NEW; END $f$;
CREATE TRIGGER trg_credit_mpesa_deposit AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fn_credit_mpesa_deposit();
CREATE TABLE mpesa_stk_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES profiles(id),
  phone_number text, amount numeric, merchant_request_id text, checkout_request_id text UNIQUE, response_code text,
  response_description text, status text, result_code text, result_description text, mpesa_receipt_number text,
  transaction_date text, created_at timestamptz DEFAULT now(), completed_at timestamptz, site_id uuid);
CREATE TABLE system_settings(key text PRIMARY KEY, value jsonb NOT NULL, category text NOT NULL DEFAULT 'general',
  description text, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_global_config(id boolean PRIMARY KEY DEFAULT true, deposits_enabled boolean DEFAULT true);
INSERT INTO platform_global_config DEFAULT VALUES;
CREATE FUNCTION fn_platform_get_global_config() RETURNS jsonb LANGUAGE sql AS $f$ SELECT to_jsonb(g) FROM platform_global_config g $f$;
CREATE FUNCTION _game_setting_num(p_key text) RETURNS numeric LANGUAGE sql AS $f$ SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = p_key $f$;
"""

def conn(db):
    c = psycopg2.connect(host=HOST, port=PORT, user="postgres", dbname=db); c.autocommit = True; return c

a = conn("postgres")
with a.cursor() as c:
    c.execute(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{DB}' AND pid<>pg_backend_pid()")
    c.execute(f"DROP DATABASE IF EXISTS {DB}"); c.execute(f"CREATE DATABASE {DB}")
a.close()
setup = conn(DB)
with setup.cursor() as c:
    c.execute(REPLICA)
    c.execute(open(MIG, encoding="utf-8").read())
    c.execute("INSERT INTO profiles(id) VALUES ('11111111-1111-1111-1111-111111111111'); INSERT INTO wallets(user_id) VALUES ('11111111-1111-1111-1111-111111111111')")

PASS, FAIL = [], []
def check(name, ok, info=""):
    (PASS if ok else FAIL).append(name); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {info}"))

U = "11111111-1111-1111-1111-111111111111"
for round_no in range(1, 6):
    with setup.cursor() as c:
        c.execute("SELECT fn_megapay_begin(%s, '254711000001', 700)", [U]); dep = c.fetchone()[0]
        c.execute("SELECT fn_megapay_attach(%s, %s, 'MR')", [dep["id"], f"TR-{round_no}"])
        c.execute("DELETE FROM mpesa_stk_requests WHERE status='failed'")  # keep the rate-limit window clear
        c.execute("UPDATE mpesa_stk_requests SET created_at = now() - interval '5 minutes' WHERE id = %s", [dep["id"]])
        c.execute("SELECT real_balance FROM wallets WHERE user_id=%s", [U]); before = c.fetchone()[0]
    barrier = threading.Barrier(8); results = []
    def settle(i):
        cc = conn(DB)
        with cc.cursor() as c:
            barrier.wait()
            try:
                c.execute("SELECT fn_megapay_settle(%s, 'paid', %s, 'Completed')", [f"TR-{round_no}", f"RCPT{round_no}"])
                results.append(c.fetchone()[0]["result"])
            except psycopg2.Error as e:
                results.append("error:" + e.pgcode)
        cc.close()
    ts = [threading.Thread(target=settle, args=(i,)) for i in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    with setup.cursor() as c:
        c.execute("SELECT real_balance FROM wallets WHERE user_id=%s", [U]); after = c.fetchone()[0]
        c.execute("SELECT count(*) FROM transactions WHERE reference=%s", [f"RCPT{round_no}"]); ntx = c.fetchone()[0]
    check(f"round {round_no}: 8 simultaneous settles → one credit of KES 700",
          after - before == 70000 and ntx == 1 and results.count("credited") == 1 and results.count("already_completed") == 7,
          f"delta={after-before} tx={ntx} results={results}")

setup.close()
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
raise SystemExit(1 if FAIL else 0)
