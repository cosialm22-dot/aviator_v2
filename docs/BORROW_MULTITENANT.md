# Multi-Tenant Borrow — Progress Tracker

Borrowing invest254's multi-tenant, white-label platform architecture into aviator_v2.
Reference: `invest254_ARCHITECTURE_BLUEPRINT.md` + `invest254_DEEP_REFERENCE.md`.

## Locked decisions
- **Engine:** graft tenancy onto aviator's existing Postgres/pg_cron engine (multiplex by `site_id`).
- **Money:** integer **cents** (match invest254).
- **Roles:** full ladder `platform_superadmin > admin (+finance_admin, support) > marketer > player`.
- **Fairness/pool:** **per-brand toggle** via `sites.pool_mode` (support both provably-fair and managed-book).
- **Marketer demo isolation:** adopt fully (non-withdrawable `demo_balance` + real/demo views).

## Phase plan (each = sub-branch → e2e tests → PR)
| Phase | Scope | Status |
|---|---|---|
| **P1a** | Tenancy skeleton: `sites` + `site_id` on data tables (default-filled, non-breaking) + role-ladder allow-list + `pool_mode` | ✅ merged (#6) |
| **P1b** | Money model: cents + `real/bonus/demo` balances + `ledger_entries` + `fn_is_marketer_account` + `_wallet_move`; rewrote `handle_new_user`, `place_bet`, `cash_out`, `_settle_flight`, `request_withdrawal`, `admin_adjust_balance`, `claim_rain`. `wallets.balance` kept as numeric-KES compat cache. Marketer demo isolation enforced; bonus/wagering column reserved (logic deferred). | ✅ this PR |
| P1c | `site_game_config`(+versions) + feasibility CHECK, per-site config keying, per-site day seeds, per-site identity/auth decision | ⬜ |
| P2 | Roles & guards: canonicalize root → `platform_superadmin` (+ update `_enforce_super_admin_lock`), `requireSite`/RLS second dimension, platform gate | ⬜ |
| P3 | Marketer/affiliate: hierarchical per-site 25% GGR, default marketer, payouts, expenses, demo isolation | ⬜ |
| P4 | Platform console + per-brand admin (site switcher + all-sites overview) | ⬜ |
| P5 | Payments per-site (M-Pesa creds by ref) + withdrawal-pool controller (guarded by `pool_mode`) | ⬜ |

## P1a details (this PR)
Migration `20260828020000_p1a_tenancy_foundation.sql` — **additive & non-breaking**:
- `sites` table (mirrors invest254 `0044`, KES-adapted): brand identity/theme, per-site M-Pesa
  refs (secrets by reference), `master_seed_ref`, `pool_mode`, `default_daily_pool_cents`,
  `withdrawals_enabled`, `owner_user_id`; default **Aviator** site seeded (`…0001`).
- `site_id` (FK→sites, `NOT NULL DEFAULT` default-site, indexed) added to 20 tenant data tables.
  Existing SECURITY DEFINER RPCs keep working — new rows auto-stamp the default site until P1b
  stamps `site_id` explicitly.
- `profiles.role` CHECK widened to the full ladder (root promotion + guards deferred to P2 so the
  `_enforce_super_admin_lock` root protection is never weakened piecemeal).

**Validated (e2e on clean DB):** signup → profile+wallet auto-`site_id`; `open_round` +
`place_bet` (500→400) + `cash_out` (→515) all work; every row stamped to the default site.

### Deferred decision (P1c)
aviator uses **Supabase Auth** (global email uniqueness), so invest254's *per-site identity*
(same phone across brands) needs an auth-strategy decision before per-site identity uniques.
