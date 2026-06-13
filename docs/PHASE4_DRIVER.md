# Phase 4 - Game-loop driver (Supabase-only)

The server advances the single shared round by calling `public.game_tick()` on a
fast cadence. `game_tick()` is idempotent and transaction-advisory-locked, so it
is safe to call concurrently or more often than needed.

## Components
- `supabase/functions/game-loop/index.ts` - **active** Edge Function. Runs a
  250 ms tick loop for ~58 s per invocation.
- `supabase/migrations/20260612122000_phase4_driver_pgcron.sql` - schedules a
  per-minute `pg_cron` keepalive that invokes the function. **Apply at cutover only.**
- `worker/game-worker.ts.example` - the future always-on worker (Option A), inert.

## Deploy order (cutover)
1. **Deploy frontend (Phase 5) first** so the legacy client stops creating rounds.
2. Deploy the function:
   ```bash
   supabase functions deploy game-loop
   ```
3. Store secrets in Vault (once):
   ```sql
   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
   select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');
   ```
4. Apply the scheduler migration:
   ```bash
   supabase db push   # applies 20260612122000_phase4_driver_pgcron.sql
   ```
5. (Optional) start immediately instead of waiting for the next minute by running
   the same `net.http_post(...)` from the SQL editor once.
6. Verify:
   ```sql
   select jobname, schedule, active from cron.job where jobname='aviator-game-loop';
   select status, count(*) from game_rounds group by status;   -- expect waiting/flying churn
   ```

## Stop / maintenance
```sql
select cron.unschedule('aviator-game-loop');
```

## Tuning (no redeploy - all live in system_settings)
`game.betting_ms`, `game.post_crash_ms`, `game.house_edge_percent`,
`game.max_payout`, `game.bots_min`, `game.bots_max`, `game.max_crash_point`.
