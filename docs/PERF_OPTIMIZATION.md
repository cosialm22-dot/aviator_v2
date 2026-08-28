# Performance / Scaling / Resource Optimization

Migration: `supabase/migrations/20260828000000_perf_optimization.sql`

## Incident & root-cause (diagnosed on the live DB)

The production database became unreachable (`FATAL: 57P03: the database system is
not accepting connections`). Root cause: **disk exhaustion** — the 2 GB disk was
**99.6 % full** (~8 MB free), so Postgres could not write WAL and refused all
connections. Recovery: resized the disk (2 GB → 8 GB); the DB returned to
`ACTIVE_HEALTHY`.

Underlying cause of the exhaustion (not just the symptom):

| Problem | Evidence | Impact |
|---|---|---|
| **Unbounded bot bets** | `public.bets` = 5.36 M rows / 1.22 GB (83 % of DB); 15–30 simulated **bot** bets persisted **every round**, forever | Filled the disk |
| **Driver overlap** | `game_drive(11)` ran ~11 s on a **10 s** cron schedule → overlapping worker procedures | Wasted CPU / connections |
| **No retention** | `game_rounds` (255 K), `round_secrets` (253 K), `cron.job_run_details` (66 MB) grew without bound | Ongoing growth |
| **Default autovacuum/fillfactor** | Hot, high-churn tables on Postgres defaults | Bloat |

## What this migration changes

1. **Ephemeral bot bets.** `crash_round()` now records the round aggregates
   (including bot volume, for display) and then **deletes the round's bot bets**.
   Bots have no wallet impact or audit value, so this removes ~99 % of row growth
   at the source. **Real-player bets are always retained.**

2. **Singleton game driver.** `game_drive()` is now a single long-running worker
   guarded by a **session advisory lock (`778812`)**:
   - At most **one** worker runs cluster-wide (no overlap). A second invocation
     returns immediately, so the cron **watchdog** (`*/15s`) is a cheap no-op while
     a worker is alive and **restarts** the worker within ≤15 s if it dies.
   - Loops `game_tick()` every `game.tick_ms` (default 250 ms), `COMMIT` per tick.
   - Per-tick errors are isolated (subtransaction) so one bad tick can't kill it.
   - Gap-free during flight; any handoff gap lands in the inter-round pause and is
     **settlement-deterministic** (settlement is driven by the sealed `crash_point`,
     not wall-clock), so correctness is preserved even across a worker restart.
   - Master switch: `system_settings 'game.driver_enabled'` (`true`/`false`).

3. **Retention jobs (pg_cron).**
   - `run_data_retention()` nightly (03:30): deletes `game_rounds` older than
     `game.retention_days` (default 90) → cascades to `bets` + `round_secrets`
     (NO-ACTION refs in `crash_queue`/`free_bets` are nulled first).
   - `prune_cron_logs()` nightly (04:00): trims `cron.job_run_details` beyond
     `ops.cron_log_retention_days` (default 2).

4. **Autovacuum + fillfactor tuning** on `bets`, `game_rounds`, `round_secrets`
   (aggressive scale factors, low cost delay, fillfactor for HOT updates).

## Operational runbook

| Action | How |
|---|---|
| **Pause the game** | `update system_settings set value='false'::jsonb where key='game.driver_enabled';` (worker exits within ~5 s) |
| **Resume the game** | set it back to `'true'::jsonb` (watchdog starts a worker within ≤15 s) |
| **Change tick rate** | `game.tick_ms` (ms) |
| **Change retention** | `game.retention_days`, `ops.cron_log_retention_days` |
| **Emergency stop driver entirely** | `select cron.alter_job((select jobid from cron.job where jobname='game_driver'), active:=false);` |

## Tuning knobs (system_settings)

`game.driver_enabled`, `game.tick_ms`, `game.driver_max_seconds`,
`game.retention_days`, `ops.cron_log_retention_days`.

## Validation (e2e, run on a clean DB)

- Singleton confirmed (concurrent 2nd `game_drive` returns immediately).
- Full round lifecycle open → bet → fly → crash; winning auto-cashout paid,
  losing bet settled, wallet credited, `win` transaction written.
- Bot bets purged on crash; real bets retained.
- Self-heal: after a worker stop mid-flight, a resumed tick crashes the stuck
  round and purges its bots.
- `run_data_retention()` deletes an aged round and cascades to bets/secrets.

## Future scaling (documented, not yet needed)

At the current data rate (bots ephemeral, only real bets persist), a scheduled
retention delete + aggressive autovacuum is sufficient. If real-bet volume grows
by ~100×, migrate `bets`/`game_rounds` to **declarative time partitioning** and
drop old partitions (instant, bloat-free) instead of `DELETE`-based retention.
