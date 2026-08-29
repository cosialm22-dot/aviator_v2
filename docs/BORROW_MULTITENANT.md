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
| P4 | Platform console (all-brands): `platform_sites_overview` (per-brand KPIs), `platform_create_site`, `platform_update_site` (all `_is_platform_superadmin`-gated) + frontend Platform Console page/nav/route. **Also fixes a regression:** frontend role ladder never learned P2's roles, so `platform_superadmin` (the owner) was locked out of `/admin` — `roleContext`/`AdminGuard` now recognise the full ladder. | ✅ this PR |
| — | **Design decision (shared game config):** all brands share ONE game engine + one global game config (`system_settings`); the engine reads `_setting_num` (global), never per-site. `site_game_config`'s game columns are vestigial (only `commission_rate`/`qualifying_deposit_cents` are used per-site). No engine-multiplex; no per-brand game economy surfaced in the console. | ✅ |
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
- **[RESOLVED — `20260828090000_signup_site_attribution.sql`] `handle_new_user` did not stamp `site_id`.** Now resolves the brand from signup metadata (`site_id` → `site_slug` → default site), fails loud on an invalid explicit hint, stamps `site_id` on profile/wallet/ledger_entries/transactions/referrals, and scopes the referral-code lookup to the resolved site. Front-end must pass `site_slug` (or `site_id`) in the signup `raw_user_meta_data` once multi-domain hosting is live; until then the default-site fallback preserves current single-brand behaviour. Verified e2e (default, slug, id, invalid→fail, site-scoped referral, cross-brand fallback, money conservation).
- **[RESOLVED (user-owned tables) — `20260828100000_site_id_autostamp_triggers.sql`] systemic write-path `site_id`.** A full scan found 47 func/table inserts omitting `site_id`. Rather than edit every write path, a generic `_inherit_site_id(owner_col)` BEFORE-INSERT trigger now stamps `site_id` from the owning user's `profiles.site_id` on the 11 user-owned money/account tables: `transactions`, `ledger_entries`, `wallets`, `withdrawal_requests`, `free_bets`, `player_risk_scores`, `rain_claims`, `device_fingerprints`, `chat_messages` (owner `user_id`), `commission_payouts` (`marketer_id`), `referrals` (`player_id`). Verified e2e: direct inserts + real `place_bet` RPC → transaction/ledger stamped to the player's brand; site-A owner unchanged (non-breaking). **Still deferred to the engine-multiplex phase: `bets`, `game_rounds`, `round_secrets`, `crash_queue`, `rain_events`** (rounds are single-engine/global, so bet↔round↔player site coherence isn't yet defined; `bets` is also the hottest bot-heavy path). `admin_audit_log` also left global for now (actor/target audit, not user-brand data).

- **[RESOLVED — `20260828120000_public_site_by_host.sql` + `src/lib/siteBrand.ts`] signup `site_slug` wiring.** The web app now resolves the current host → brand on boot via the anon-callable `public_site_by_host(host)` RPC (exposes public brand fields only) and threads `site_slug` into `supabase.auth.signUp` metadata, so `handle_new_user` attributes each signup to the right brand. Unknown hosts fall back to the default brand (single-brand behaviour preserved). Multi-brand attribution activates automatically once a brand's `sites.primary_domain` is set and served on that host.

## Borrow backlog (from invest254) — progress
Beyond P1–P4 + attribution, the remaining borrowable feature set (evidence-based, from a live invest254↔aviator diff):
- **[DONE — `20260828130000_notifications.sql`] Notifications** — `user_notifications` + `notification_templates` + audience resolver + broadcast (ad-hoc & template) + category-resolve + dismiss/dismiss-all + realtime bell (player Header) + admin Notifications page (broadcast + templates). Site-scoped (brand admin → own brand, platform → all), RLS own-row, e2e-verified, deployed.
- **[DONE — `20260828140000_promo_codes.sql`] Promo codes** — `promo_codes` + `promo_redemptions`, per-brand unique codes, total + per-user caps, expiry/active, reward = free bet (works today) or bonus_cash (reserved for #3). Race-safe `redeem_promo_code` RPC + admin CRUD (site-scoped). Player redeem input in the wallet + admin Promo Codes page. e2e-verified (13 checks) + live smoke, deployed.
- **[SHIPPED] Bonus & wagering engine** (`bonuses`, `bonus_config`) — migration `20260829000000_bonus_wagering_engine.sql`. Unified cents engine on `bonus_balance`: restricted **welcome** (KES 200, wager 3x), **first_deposit_match** (100% match, cap KES 500, wager 3x, ported to cents), **promo** `bonus_cash` now tracked+wagered. Bonus-first staking + wagering accrual in `place_bet`; FIFO bonus→real conversion in `cash_out`/`_settle_flight`/`crash_round`; bonus stays non-withdrawable (`request_withdrawal` real-only). Supersedes the legacy 06-17 bonus system. Verified live e2e (money-conservation invariant: wallet balances == Σ ledger per kind). Frontend `useBonus.ts` remapped to the cents schema. See `supabase/tests/bonus_wagering_e2e.sql`.
  - ⚠️ Companion bug (separate, NOT in this PR): the M-Pesa STK callback credits deposits to `wallets.balance` directly instead of `real_balance` via `_wallet_move`, so real deposits don't persist in the cents model. Needs a P1b edge-function follow-up.
- **[SHIPPED — DB layer] Support chat** (`support_conversations`, `support_messages`) + escalation + **KB** (`kb_chunks`, pgvector `fn_kb_search`) — migration `20260829050000_support_chat.sql`. Human support works now (start/send/escalate, operators read transcripts via `_is_admin`); pgvector enabled, KB retrieval ready. Verified live e2e (`supabase/tests/support_chat_e2e.sql`).
  - **[TODO — #4b]** embedding ingestion + autonomous LLM answering (needs an external embedding/LLM provider + an edge function). `fn_kb_search`/`fn_support_log` are service_role-ready for it.
- **[PARTIAL/SHIPPED — additive analytics] Deep marketer economy** — migration `20260829040000_marketer_analytics.sql`: `affiliate_clicks` (tolerant `fn_record_affiliate_click`, wired to `/?ref=` capture), `marketer_expenses` (admin-logged, informational — NOT netted into payout math), `fn_marketer_funnel` (clicks→registrations→FTDs + expenses/ROI). No change to the existing GGR-on-demand commission/payout model. Verified live e2e (`supabase/tests/marketer_analytics_e2e.sql`).
  - **[SHIPPED — accrual layer]** migration `20260829070000_marketer_accrual_economy.sql`: expense-recovery netting (invest254 0105 — logged `marketer_expenses` net out of withdrawable, operator-toggleable via `marketing_config.expenses_reduce_commission`), a single-source-of-truth `fn_marketer_balance` (earned − committed − expenses), and a `fn_marketer_ledger` statement. Earned stays GGR-on-demand (no redundant stored wallet → no dual-source drift); `request_commission_payout` + `marketer_dashboard` repointed at the unified balance (no double-pay). Verified live e2e (`supabase/tests/marketer_accrual_e2e.sql`).
  - **[N/A — by design]** `marketer_wallets` (stored liability balance) intentionally NOT added: aviator's earned is a clean on-demand aggregate; duplicating it would create reconciliation bugs. `deposit_commissions`/`affiliate_commissions` (invest254's deposit-based accrual) not adopted — aviator commission stays GGR-based (unchanged economics).
- **[TODO] User overrides/limits** (`user_overrides`).
- **[SHIPPED] Versioned platform global config** (`platform_global_config(+versions)`) — migration `20260829060000_platform_global_config.sql`. platform_superadmin master kill-switches (deposits/withdrawals/play/marketers/registrations) + maintenance banner, versioned (immutable snapshots) + audited + `pg_notify`. Enforced live at `place_bet`/`request_withdrawal`/`handle_new_user`/`admin_promote_to_marketer`, and **deposits at the M-Pesa STK-push edge function** (`fn_platform_get_global_config` check before the Daraja push; deployed + e2e-verified: `403 DEPOSITS_DISABLED` when off). Excludes 0092 pool distributor (fairness line) + 0099 economy overrides (redundant with system_settings). Verified live e2e (`supabase/tests/platform_config_e2e.sql`).
- **[NEEDS PRODUCT/LEGAL SIGN-OFF] Withdrawal-pool "managed-book"** (`withdrawal_pool`, `pool_ledger`, `positions`, `position_decision`, `platform_pool_distributions`) — invest254's own docs state this removes public provable-fairness; will not implement without explicit go-ahead.
- **Excluded (not borrowable):** invest254 custom auth (`user_credentials/user_mfa/user_security_answers` → aviator uses Supabase Auth), engine internals (`positions/game_days/seed_overrides`), `schema_migrations`.
