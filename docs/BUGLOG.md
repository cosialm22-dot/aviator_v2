# Bug Log (aviator_v2)

Running log of bugs found while working through issues, with what was wrong, the evidence, and the fix or the decision it needs.

---

## #17 — CRITICAL: the crash time of the live round is public — OPEN, needs the owner's authorisation (engine)
- **What:** `start_round` writes `game_rounds.crashes_at` (when the plane will crash) at take-off.
  - `game_rounds` is readable by anyone (RLS `true` for anon and authenticated).
  - It is in the realtime publication, so every client also receives it at take-off.
- **Evidence:** round 116233 took off at 23:13:13.38. Anyone could read `crashes_at = 23:13:28.36` straight away, and the round crashed at 23:13:28.23 at 3.85x. A script can therefore cash out a tick before every crash and win every round.
- **Why it matters:** no real players have bet yet. The first player who notices can drain the house.
- **Proposed fix (engine, not yet made):**
  - stop publishing `crashes_at` and the override fields (`is_override`, `override_reason`, `source`, `queue_id`) to clients;
  - let the client learn about the crash from the crash event only;
  - keep `crashes_at` in `round_secrets`, where `game_tick` already reads it.

## #16 — Database kept running out of memory — FIXED (migration `20260927090000_db_memory_pressure`)
- **Symptoms, measured over 5 minutes:**
  - About 158 pages a second swapped in and 335 major page faults a second.
  - Disk was read at 4.3 MiB/s around the clock, about 6.8 TB since boot.
  - About 500 MB of the 1 GB swap was in use, with 123 MB of RAM free on a 426 MB machine.
- **Root cause:** two engine lookups had no index and read whole tables many times a minute.
  - `SELECT max(crashed_at) FROM game_rounds WHERE status='crashed'` runs on every tick of the 3-second pause after each crash: 1.35 million full scans, 76.7 billion rows read, 5,357 pages each time.
  - `max(position)` on `crash_queue` runs every round: 214,000 full scans.
  - Both tables grow by about 4,400 rows a day, so the load grew every day whatever else was tuned.
- **Fix:**
  - Partial and descending indexes were built concurrently, with no downtime and no engine code changed. Each lookup now reads 5 pages instead of 5,357.
  - The player "Top" tab got an index too.
  - Full scans of both tables dropped to zero.
- **Measured after, same 5-minute method:**

  | Measure | Before | After |
  |---|---|---|
  | Swap-in (pages a second) | 158 | 56 |
  | Major page faults a second | 335 | 127 |
  | Disk reads (MiB a second) | 4.3 | 2.3 |
  | CPU busy | 7.5% | 4.1% |

- **Errors fixed at the same time:**
  - `game_drive` looped for 3,600 s but was killed by the 120 s statement timeout. That produced about 720 "canceling statement due to statement timeout" errors a day, each cancelling a tick in flight. `game.driver_max_seconds` is now 110, so the loop ends cleanly; runs now finish as "succeeded" at 1:50.
  - The Deposits screen's gateway card sorted the whole cron history table. Under memory pressure it hit the 120 s timeout, which caused the only two 500 errors in the API logs. It now reads the newest run by primary key.
  - `prune_cron_logs` never removed runs that had no end time. It now falls back to the start time.
- **Still costing memory (owner's decisions):**
  - **The machine:** it is Nano (0.5 GB RAM), which is too small for Postgres plus the Supabase services on the same box. In a paid (Pro) organisation Nano is billed at the Micro price (1 GB), so upgrading to Micro doubles the RAM at no extra cost. It needs a restart of a few minutes.
  - **Bot bets:** 15–30 bot rows are inserted, updated and deleted every round. That is 7.85 million of the 9.7 million row changes since stats were reset, and each change goes through the WAL (7.8 GB so far) and realtime decoding. The top statement in `pg_stat_statements` is realtime's WAL reader (2,830 s, 280,000 calls). Turning bots off, or keeping them out of the realtime publication, would remove most of the remaining write load.
- **Other log findings (harmless):**
  - PostgREST's "Warp server error: Thread killed by timeout manager" (about 160 a day) is PostgREST closing idle keep-alive connections.
  - Every other error in the last 24 hours came from test runs and was expected.

## #15 — Admin dashboard, phase 1: shell, brand scope, Overview, Players, Audit, platform switches — DONE (branch `feat/admin-tenancy`)
- **Layout, modelled on the invest254 console:**
  - grouped navigation: Money / Players / Game / Growth / Administration / Platform;
  - a workspace header that always names the brand or "all brands";
  - ⌘K jump menu (same list as the sidebar), a collapsible icon rail (⌘/Ctrl+B), and a phone drawer;
  - one UI kit (`src/admin/ui/kit.tsx`): page header, stat cards that never cut figures, tables, pagination, empty, error and loading states, modal, two-step confirm, switch, tabs.
- **Brand scope:**
  - The platform owner picks "All brands" or one brand in the header; the choice is remembered.
  - A gold banner shows while looking at one brand.
  - Pages that don't follow the scope yet say so rather than silently mixing brands.
  - Everyone else is pinned to their own brand, and the server enforces it (`_admin_scope`).
- **Overview (rebuilt):**
  - Figures are computed on the server by `admin_overview`: Nairobi days, bots excluded, no 1,000-row cap. The old page added up capped client queries across every brand.
  - Contents: today's KPIs with change against yesterday, charts of money in and out and of players over 7, 14 or 30 days, a "Needs attention" queue with links, and balances owed to players.
- **Players (rebuilt):**
  - `admin_list_players` does the search (username, phone or id), status filters, account types and sorting on the server, with pagination and the full total.
  - Filters are kept in the URL; there is a CSV export.
  - The old page read `profiles` directly, so every brand saw every brand's players.
- **Audit log (new page):**
  - filters by action, staff member, date range and brand;
  - plain-language action names with the raw code;
  - a "Full record" view of each entry;
  - the log is read-only.
- **Brands & controls:**
  - the 5 platform switches (deposits, withdrawals, real-money betting, sign-ups, new marketers), each confirmed, versioned and audited; all 5 are enforced server-side;
  - "Open" on a brand scopes the back office to it;
  - the invalid "Archived" status is replaced by "Disabled".
- **Tests:**

  | Test | Result |
  |---|---|
  | `admin_tenancy_e2e.py` (rolled back) | 47/47 |
  | `e2e/admin_ui_e2e.py` (live brand tiers + mocked platform owner) | 42/42 |
  | `megapay_ui_e2e.py` re-run | 56/56 |
  | vitest | 90/90 |

## #14 — Multi-tenant security gaps (from #7) — FIXED (migration `20260926090000_admin_tenancy`)
- **Global controls belong to the platform owner:** `admin_set_setting` (game, finance, maintenance) and the crash-queue RPCs were allowed for any `super_admin`. They are now platform owner only.
  - **Effect today:** the aviator brand's `super_admin` can no longer change platform-wide game settings or queue crash points. The platform owner can.
- **Staff tables are read-only:**
  - Direct writes are gone on `admin_audit_log`, `withdrawal_requests`, `player_risk_scores`, `crash_queue` and `system_settings`. The catch-all `admin_full_access` policies are dropped and INSERT/UPDATE/DELETE are revoked from API roles.
  - The audit trail can no longer be edited or deleted by staff.
- **M-Pesa paybill:**
  - `mpesa_config` is no longer readable through the API. The old Payments tab downloaded the passkey, consumer secret and security credential into the browser.
  - `admin_get_mpesa_config` returns only "saved" flags.
  - `admin_save_mpesa_config` is platform owner only, validated, and audited with secret names only.
- **Missing brand checks added:**
  - promotions (create now tags the brand; edit, switch and delete check it);
  - `admin_get_mpesa_detail`;
  - `admin_set_site_theme` (a brand owner themes only their own brand).
- **Support role fixed:** support can read players, risk alerts and the live round, and the player page is view-only for them. Before, the UI showed support pages that the server refused.
- **One owner per brand:** `uniq_one_super_admin` (one in total) is now `uniq_one_super_admin_per_site`.
- **Audit rows land on the right brand:** rows written without a brand went to the default brand. A trigger now attributes them to the target player's brand, or else to the acting staff member's brand.
- **Settings:**
  - the General, Game, Finance and paybill tabs show only for the platform owner; brand owners keep Theme and Staff;
  - Game control hides the queue controls from everyone except the platform owner.
- **Applying it:** production takes every lock up front, in one statement with a timeout, because the game driver's long transaction caused a deadlock on the first test run. The game kept running throughout.
- **Still open (phase 2):**
  - Withdrawals, Finance, Risk, Marketing, Promo codes, Notifications and Game control do not follow the brand picker yet. The page says so.
  - Role lists in Staff and player detail are stale: finance_admin and support can't be assigned, because `admin_set_role` rejects them.

## Observation — game driver "fails" every 2 minutes (not changed: engine)
- `cron.job_run_details` shows `game_driver` ending with "canceling statement due to statement timeout" about 720 times a day. `game_drive()` sleeps in a loop until the 2-minute statement timeout stops it, and the next run picks up. Rounds keep flowing.
- This looks like the intended design, but it fills the cron history with failures and holds locks for long stretches. It is in the engine, so I left it alone.

## #13 — Deposits screen for operators — DONE
- **Sections:**
  - gateway health: a live connection test and the automatic-check status (booleans only);
  - deposit limits: editable by the platform owner only, because they apply to every brand; read-only for everyone else;
  - brand KPIs: credited today, 7-day success rate, waiting, unconfirmed, needs attention. The platform owner sees all brands or picks one.
- **The list:**
  - filters: All / Needs attention / Waiting / Unconfirmed / Credited / Failed;
  - search by phone, receipt or id;
  - phones are masked, and each row has details and "Check now".
- **"Confirm payment":** for unconfirmed deposits, or prompts that never got a Mega Pay answer.
  - It needs the M-Pesa receipt, a reason and a confirmation tick.
  - It is allowed for finance_admin and above, on their own brand only.
  - It works once per deposit and once per receipt, is audited, and is refused for amount mismatches.
- **Access:** support can view but not confirm; players can't open the screen.

## #12 — Staff could write deposit rows directly — FIXED (branch `feat/megapay-gateway`)
- **What:** `mpesa_stk_requests` had policy `admin_full_access` (ALL) for any staff on the brand, including support. A staff member could insert or edit a deposit row (amount, Mega Pay id), and the reconcile job would credit the row's amount once Mega Pay reported that id as paid.
- **Fix:** staff now have read-only access to their own brand's rows (`admin_read_site`), and INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated`. Rows are written only by the edge functions (service role). Staff changes go through the audited `fn_admin_megapay_manual_credit`.
- **Also:** when Mega Pay reports a paid amount that differs from the row, nothing is credited. The row is flagged `AMOUNT_MISMATCH` and listed under Needs attention.
- **Verification:** `megapay_admin_e2e.py` (grants and policy checks) and `megapayRuntime.test.ts`.

## #11 — A brand admin's "check now" swept every brand — FIXED
- **What:** `megapay-reconcile` called by any staff member settled every brand's waiting deposits and returned platform-wide counts.
- **Fix:** the cron job and the platform owner still sweep everything. A brand's staff sweep only their brand, and the platform housekeeping counts are hidden from them.
- **Verification:** live e2e "another brand's admin sweep skips this brand's deposit and hides platform totals".

## #10 — Daraja deposits never worked in production — REPLACED by Mega Pay
- **Evidence:**
  - no Daraja secrets are set;
  - `mpesa-stk-callback` is deployed with verify_jwt on, so Safaricom would get 401;
  - it writes `result_desc` and `callback_payload`, which don't exist (the live column is `result_description`);
  - `mpesa-stk-push` trusts a `user_id` sent in the request body.
- **Decision:** player deposits now go through Mega Pay (`payments.deposit_provider = megapay`). The Daraja functions are left deployed but unused. Withdrawals still use `mpesa-b2c`, and that is untouched here.

## #9 — The cashier's minimum was KES 50 in the app — FIXED
- **What:** `WalletModal` hard-coded `MIN_DEPOSIT = 50`, so the app's rule could differ from the server's.
- **Fix:** limits come from `fn_public_payment_config()` (KES 100 – 150,000 today), and the quick amounts follow them. The platform owner sets them in Deposits → Deposit limits.
- **Also fixed:** typing or pasting `07…`, `254…` or `+254 …` into the phone field used to cut the number short. It now keeps the 9 local digits.

## #8 — Mega Pay integrated as the deposit gateway — DONE (branch `feat/megapay-gateway`)
- **Credentials:** the same Mega Pay account as invest254 (production `/backend/v1`). They are held as function secrets; the key is never sent to the browser and the email is masked in the admin view.
- **Flow:**
  1. `megapay-stk-push` takes `{amount, phone}`. The player comes from the session.
  2. `fn_megapay_begin` validates and records the deposit before Mega Pay is called.
  3. The prompt goes out.
  4. The app polls `megapay-status`. The server asks Mega Pay and `fn_megapay_settle` credits exactly once: row lock, final-state check, and a unique receipt.
- **Why polling:** Mega Pay's webhook is set per account and points to invest254, so aviator settles by polling instead:
  - the `megapay_reconcile` cron job runs every minute;
  - a deposit is shown as "Unconfirmed" after 15 minutes and still checked for 3 days;
  - `megapay-callback` exists, but it only re-queries Mega Pay and never trusts the body.
- **Player app:**
  - a "Check your phone" screen with the number, the amount and a live timer;
  - "Close — I'll keep playing";
  - clear messages for a cancelled payment or a server refusal;
  - "Waiting for M-Pesa" when Mega Pay hasn't confirmed yet.
- **Operators:** a new Deposits screen (`/admin/deposits`). Details: see #13.
- **Tests, all passing:**

  | Test | Result |
  |---|---|
  | `megapay.test.ts` + `megapayRuntime.test.ts` | 16/16 |
  | `megapayClient.test.ts`, `deposits.test.ts`, phone | unit tests pass |
  | `megapay_gateway_e2e.py` | 35/35, rolled back |
  | `megapay_concurrency_e2e.py` (8 simultaneous settles × 5 → one credit each) | 5/5 |
  | `megapay_admin_e2e.py` | 35/35, rolled back |
  | `megapay_functions_live_e2e.py` (live HTTPS, throwaway users, read-only Mega Pay calls) | 21/21 |
  | `e2e/megapay_ui_e2e.py` (browser: cashier on desktop and phone, Deposits for admin, support and player) | 56/56 |

- **Not yet done:**
  - **Automatic checks:** they need two vault secrets (see "Needs the owner's action"). Until then, deposits settle while the player waits in the app, and when staff press "Check waiting deposits now".
  - **No real payment made yet:** no real payment has gone through end to end. The first KES 100 deposit should be made by the owner.

## #7 — Found while building the admin tools (multi-tenant) — OPEN, for the admin dashboard work
- **One super_admin in total:** `uniq_one_super_admin` allows a single `super_admin` across all brands, so a second brand cannot have its own owner.
- **Global settings writable by a brand's super_admin:** `_is_super_admin()` includes a brand's `super_admin`, which gates `admin_set_setting`, `system_settings` (policy ALL) and `mpesa_config`. A brand owner can change settings that apply to every brand. The new payment settings RPC is limited to the platform owner.
- **Audit log is editable by staff:** `admin_audit_log` has policy `admin_full_access` (ALL), so staff can edit or delete audit rows for their brand.
- **Staff can edit withdrawal rows directly:** `withdrawal_requests` has policy ALL for brand staff, not just through RPCs.
- **Crash queue:** `crash_queue` has policy ALL for brand staff. This ties to the owner's decision on queued results.

---

## #6 — Only one Bet button on desktop — FIXED (branch `ui/two-bet-panels`)
- **Reported:** the mock has two bet panels (two Bet buttons) everywhere; desktop showed one, with ⊕ to add the second.
- **Fix:** both panels are shown by default on every screen size. ⊖ on the second removes it and ⊕ on the first brings it back.
- **Verification:** `e2e/aviator-ui.e2e.mjs` passes 38/38.

## #5 — Game screen rebuilt to the owner's mocks (UI) — FIXED (branch `ui/aviator-mock`)
- **Bet panels:**
  - Bet / Auto tabs, a stepper, 2×2 quick amounts and one big button that goes Bet → Cancel ("Waiting for next round") → Cash Out (live value) → Bet.
  - Auto adds Auto Play (with its limits) and an Auto Cash Out switch.
  - ⊕ adds and ⊖ removes the second panel. By default there are two on phones and one on desktop, as in the mocks.
- **Bets board:** the All Bets / Previous / Top tabs.
  - **All Bets:** a header with the bet count, total win and cashed-out bar, and pill rows (green when won).
  - **Previous:** the "Round Result" card.
  - **Top:** X / Win / Rounds × Day / Month / Year, with a card for each winning bet (bet, win, result, round max).
  - **Layout:** a left rail on desktop; on phones it sits under the bet panels as one scrolling page.
  - **Footer:** "Powered by TRIOCODES".
- **Round history strip:** multipliers are coloured blue under 2x, purple from 2x to 10x and pink from 10x. A "…" button opens the full history.
- **☰ game menu:** player card with Change Avatar, a Sound switch, Free Bets (with a count), My Bet History, Game Limits, How To Play, Chat, the account links and Home.
- **Sounds:** CC0 Kenney sounds (`public/sounds/LICENSE.txt`) for bet placed, cash out and flew away.
- **Tests:**
  - `e2e/aviator-ui.e2e.mjs`: 36/36 at 1920 px and 390 px, run in demo mode.
  - Unit tests 56/56, including the new `betBoard.test.ts`.
  - `npm run typecheck` is clean.

## #4 — Bet lists showed bot bets as players — FIXED (display)
- **What:** at every round start the server inserts bot bets (`_seed_bots(round, crash_point)`, `is_bot = true`). The All Bets and Previous lists showed them as players; the demo engine does the same with simulated players.
- **Evidence:** the public API currently returns 24 bot bets and 0 real bets.
- **Fix:** the board lists and counts only rows with `is_bot = false`. Other players' names are masked ("d***8"); your own rows show "You".
- **Effect:** until real players bet, All Bets is empty. The bots are still created server-side, and that is the owner's call.

## #3 — The waiting screen claimed "UFC × Aviator official partners" and "SPRIBE official game" — FIXED
- **What:** `GameCanvas` drew `partners-ufc-aviator.png` between rounds.
- **Why it matters:** the game is not a Spribe game or a UFC partner, and the owner asked for no Spribe branding.
- **Fix:** the artwork and its drawing code are removed. The waiting screen now shows only the label, the loader and the countdown.

## #2 — The Bet / Cash Out button was missing; typecheck failed — FIXED
- **What:** commit `cc32801` removed the primary button from both panels. Live production (`index-lxQlAr9E.js`) had no way to bet or cash out, and `npm run typecheck` failed on the props it left unused.
- **Fix:** the button is back in the mock's design.

## #1 — `npm ci` failed (lock file out of sync); one unit test red — FIXED
- **Lock file:** `react-router-dom` was missing from `package-lock.json`. It was refreshed with `npm install`.
- **Unit test:** the canvas glow started at deep purple, but the mock is blue under 2x ("flew away 1.91x") and purple at 2.37x. The blue → purple → red stops are restored, and `canvasMotion.test.ts` passes again.

---

## Needs the owner's action
- **Automatic deposit checks:** DONE on 2026-09-25. Both vault secrets were created at the owner's instruction, and a test call through pg_net to `megapay-reconcile` returned HTTP 200.
- **Authorise the fix for #17** (crash time readable by players). This is urgent before real players arrive.
- **Upgrade the compute from Nano to Micro:** see #16. It costs the same on the Pro plan.
- **Make one real KES 100 deposit** from a player account to confirm the whole path with real money.

## Needs the owner's decision (not changed)
- **Demo is rigged:** `useDemoGame` / `riggedCrashPoint` set the demo win rate to about 80% (`DEMO_WIN_RATE`), with near-misses on losses, "to drive conversion to real play". Real rounds use an 18% house edge (`game.house_edge_percent`).
- **Results can be set by operators:** when `game.queue_enabled` is on, operators can queue crash points (`crash_queue`). Those rounds still get a committed seed hash, so a player cannot tell them apart. The menu and footer therefore carry no "Provably Fair" claim.
- **"Players online" is simulated:** `useOnlineCount` produces a random walk between 140 and 520.
- **Bot chat:** the chat mixes scripted bot messages in with real ones (`useChatStream`).
- **Low-balance pop-ups use made-up figures:** for example "87% of players win on their comeback bet!" (`AviatorGame` `LOW_BALANCE_NUDGES`).
- **Name and logo:** the game is called "Aviator", and the header wordmark imitates Spribe's logo.
