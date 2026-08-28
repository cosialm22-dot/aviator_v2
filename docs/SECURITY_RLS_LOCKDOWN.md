# Security: RLS Write Lockdown (critical)

Migration: `supabase/migrations/20260828010000_security_rls_lockdown.sql`

## Severity: CRITICAL — money & privilege

A security audit of the live database found that several tables granted broad
write privileges to the `anon`/`authenticated` roles **and** had permissive RLS
policies, making them writable directly through the public PostgREST API (i.e.
by any logged-in player), bypassing the game's SECURITY DEFINER RPCs.

### Proven exploits (reproduced in an authenticated-user RLS context)

| Table | Policy | Impact |
|---|---|---|
| `wallets` | `UPDATE` own row | Set own **balance to any amount** (infinite money) |
| `bets` | `INSERT`/`UPDATE` (`CHECK true`) | Forge bets / set `status='won'`, arbitrary `winnings` |
| `transactions` | `INSERT` own | Forge deposit/win ledger rows |
| `profiles` | `UPDATE` own row | **Privilege escalation** to `role='admin'`, self un-ban, inflate stats |
| `game_rounds` | `INSERT`/`UPDATE` (`CHECK true`) | Fabricate/alter rounds & crash multipliers |

Correctly protected (no change needed): `round_secrets` (pre-crash crash point —
no client SELECT policy), `mpesa_config`, `withdrawal_requests`, `system_settings`
(admin-only), and cross-user reads on `wallets`/`transactions` (own-row SELECT).

## Fix

These tables are written **only** by SECURITY DEFINER RPCs (`place_bet`,
`cash_out`, `place_free_bet`, `request_withdrawal`, `open/start/crash_round`,
`handle_new_user`, `admin_*`), all owned by `postgres` and therefore bypassing
RLS. The frontend performs **every** mutation via `.rpc(...)` and only ever
`SELECT`s these tables directly (verified across the codebase).

The migration:
- **Drops** the client-write policies on `wallets`, `transactions`, `bets`,
  `game_rounds`, `profiles`.
- **Preserves** all SELECT policies (own wallet/transactions, public bets feed,
  profiles read) and the legitimate `chat_messages` INSERT.
- **Revokes** redundant `INSERT/UPDATE/DELETE/TRUNCATE` grants from `anon`/
  `authenticated` on those tables, and revokes `TRUNCATE` schema-wide (TRUNCATE
  is not RLS-gated).

## Validation (e2e, on a clean DB)

Post-fix, in the exact authenticated-user RLS context PostgREST uses:
- ❌ `UPDATE wallets` / `UPDATE profiles(role)` / `INSERT transactions` /
  `INSERT game_rounds` → **all `permission denied`**.
- ✅ Signup provisions profile + wallet (via trigger).
- ✅ `place_bet(100 @ auto 2×)` → wallet 500 → 400, bet `active`.
- ✅ `cash_out` at 1.15× → wallet 400 → 515, bet `won`, `win` transaction written.

## Follow-ups (not in this migration)

- If a user-facing "edit profile" (username/avatar/phone) feature is added, do it
  via a dedicated SECURITY DEFINER RPC (e.g. `update_my_profile`) — do **not**
  re-open a direct `UPDATE` policy on `profiles`.
- Consider `ALTER DEFAULT PRIVILEGES` so future tables don't auto-grant writes to
  client roles.
