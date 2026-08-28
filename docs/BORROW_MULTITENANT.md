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
| P1c | `site_game_config`(+immutable versions) + feasibility CHECK (min edge floor) + version-bump/notify trigger + `_site_setting_num` per-site reader (global fallback). Seeded default site from live settings (KES→cents, edge floored). Auth = option (a): keep Supabase Auth global identity, `site_id` scopes data. Engine wiring deferred to multiplex phase. | ✅ this PR |
| P2 | Roles & guards: root canonicalized → `platform_superadmin` (+ re-based `_enforce_super_admin_lock`); helpers `_is_platform_superadmin`/`_is_super_admin`/`_is_admin` widened; `current_site()` + `_can_admin_site()` (requireSite); RLS `site_id` second dimension on admin policies (brand admins see only their site; platform sees all); global config tables → platform-only; `block_operator_bets` covers all operator roles. | ✅ this PR |
| P3 | Marketer/affiliate per-site: `commission_rate`+`qualifying_deposit_cents` on `site_game_config`; `sites.default_marketer_id` roots unattributed players; per-site GGR/commission (`Σ site_ggr×site_rate`); per-site deposit qualification; `admin_set_commission_rate(rate,site)`; `fn_effective_marketer`. | ✅ this PR |
| P2b | Per-`admin_*` site scoping: all 12 mutating admin RPCs resolve the target row's `site_id` and call `_can_admin_site(...)` → `FORBIDDEN_SITE` cross-brand (SECURITY DEFINER bypasses RLS, so this closes the mutation-path gap left by P2). Verified e2e: all 12 blocked cross-brand, same-brand + platform succeed. | ✅ this PR |
| P2b-2 | Read-path site scoping: 10 read/list/overview admin RPCs (`admin_list_transactions/withdrawals/commission_payouts/fraud_alerts/affiliates/promotions`, `admin_affiliate_overview/referrals`, `admin_commission_overview`, `admin_finance_summary`) filter `(_is_platform_superadmin() OR <t>.site_id = current_site())`. Verified e2e (two brands): scoped admin sees only own brand, platform sees all. | ✅ this PR |
| P4 | Platform console + per-brand admin (site switcher + all-sites overview) | ⬜ next |
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

## Findings log
- **[P2b-2] `handle_new_user` does not stamp `site_id`** on the profile/wallet/ledger_entries/transactions it creates — they fall to the `site_id` column DEFAULT (default site). Result: multi-brand signups are misattributed to the default site (verified: 6 test signups across 2 sites put all 6 welcome-bonus deposits on site A). Fix belongs to the deferred **per-site signup attribution** work (needs a site-context-at-signup mechanism, since Supabase Auth has no site dimension). Tracked for the auth/tenancy-signup phase; out of P2b-2 scope (row/aggregate visibility only).
