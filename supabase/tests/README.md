# Aviator V2 — SQL regression tests

These tests exercise the **real production RPCs** end-to-end against a live
database **without leaving any residue**.

## Self-rollback pattern (no pgTAP dependency)

Each test is a single `DO $T$ … $T$` block (one transaction under autocommit
clients). It:

1. Builds a throwaway fixture (an `auth.users` row — the `on_auth_user_created`
   trigger auto-provisions the profile + wallet — plus a synthetic round).
2. Simulates an authenticated caller with
   `set_config('request.jwt.claims', …, true)` so `auth.uid()` resolves inside
   the `SECURITY DEFINER` RPCs.
3. Runs assertions, accumulating a pass/fail log.
4. Ends with `RAISE EXCEPTION 'AVIATOR_…|ok=<bool>|<log>'`.

Because the block always raises, the surrounding transaction **always rolls
back** — fixtures, bets, wallet mutations and ledger rows all disappear. The
raised message carries the result, so the harness reports pass/fail while the
database is provably untouched. Uncommitted rows are invisible to the live game
loop, and the test takes no advisory lock, so it cannot interfere with live play.

## Running

Run against any environment with `psql` (or any SQL client that surfaces the
RAISE message):

```bash
psql "$DATABASE_URL" -f supabase/tests/phase1_auto_cashout_test.sql
```

A pass looks like:

```
AVIATOR_PHASE1_E2E|ok=t|T1 ok; T2 ok; … T10 cap+floor ok;
```

`ok=t` ⇒ all assertions passed. `ok=f` ⇒ read the log for the failing assertion.
