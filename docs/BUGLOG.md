# Bug Log (aviator_v2)

Running log of bugs found while working through issues, with what was wrong, the evidence, and the fix or the decision it needs.

---

## #27 — Mobile-first player UI, fewer words, no pressure pop-ups — DONE (branch `ux/mobile-first`)
- **Target:** Kenya's phones. StatCounter, Aug 2026: 360x800 17.6%, 360x806 10.7%, 385x854 9.4%, 412x915 9.1%.
- **Before:**
  - On a 360 px phone the second Bet button was below the fold.
  - Stake −/+ were 19x24 px, and quick amounts and tabs were 24–28 px.
  - The countdown text was 8 px.
  - The Redeem button was cut off in the wallet.
- **Now:**
  - The first screen is history, the plane and both bet panels. The plane takes whatever height is left, and the bets list sits below.
  - Controls are 36–48 px.
  - No visible text is under 11 px.
  - There is no sideways scroll at 360, 385, 412, 768 or 1440 px.
- **Removed:**
  - Low-balance "Deposit now" pop-ups, including the invented "87% win on their comeback bet".
  - Demo "Play for Real" toasts every 3 rounds.
  - The random "players online" counter.
  - The rotating chat line under the plane.
  - "CASH OUT NOW!" and "Bet in - ready!" overlays, which repeated the button's own state.
  - The floating "Waiting for M-Pesa…" toast. A spinner now shows on the balance instead.
  - The bell dropdown. Notifications are now a dot on ☰ plus an inbox sheet.
  - Home, "Change Avatar" (no avatar editing exists) and the duplicate Game Limits / How To Play pages. They are merged into "Rules", with live limits.
  - The profile's Account and My Bets tabs (duplicates), the joined-date query, the M-Pesa method card, the long help lines, and the bolt.new og:image.
- **Notification model:** follows NN/g "Indicators, Validations, and Notifications" and Material snackbar guidance.
  - Passive events light an indicator (a menu dot).
  - Validation happens in context: a refused bet or cash-out shows in the button for 2.5 s, for example "Outside limits" or "Too late".
  - Action-required steps (the M-Pesa PIN) stay in the wallet sheet.
  - Nothing interrupts play.
- **Bug fixed:** a refused bet or cash-out failed silently (the promise was rejected and never handled). It now shows in the button.
- **Copy fixed:** the sign-up banner promised "KSh 500 free to start", but the server grants 200. The banner and wallet offer now come from `bonus_config` through `fn_public_payment_config` (migration `20260929090000`, which also returns the min/max bet and max win for Rules).
- **Single dialog system:** every dialog is a bottom sheet on phones and a centred card on larger screens, with Escape, backdrop tap and focus trapping. Chat is English throughout. Inputs are 16 px so iOS doesn't zoom. `touch-action: manipulation` is set, safe-area insets are respected, and reduced motion is honoured.
- **Efficiency:**
  - The chat stream (history query, realtime channel, bot timer) runs only while chat is open.
  - Inter now loads through `<link>` with preconnect instead of a render-blocking CSS `@import`, and one unused weight was dropped.
  - The app's own JS is 38.7 KB gzip, down from 42.3.
- **Tests:**
  - New `e2e/mobile_ui_e2e.py` (53/53): fit on 6 sizes, target sizes, text ≥ 11 px, the notification dot and inbox, sheets, wallet and register copy against the live offer, refused-bet feedback, and no pop-ups in demo.
  - `aviator-ui.e2e.mjs` 67/67 (now also 360x740).
  - `megapay_ui_e2e.py` 57/57.
  - `game_live_ui_e2e.py`, `admin_ui_e2e.py` 43/43.
  - Unit tests 99/99.

## #26 — Database after the Micro upgrade — MEASURED
- Compute moved from Nano to Micro on 2026-09-25 at the owner's instruction (1 GB RAM, `shared_buffers` 256 MB). The resize restarted Postgres once. The only errors in that window were the expected "shutting down" and "server restarted" messages, and one driver run cut short. Rounds resumed by themselves.
- **Same 5-minute method as #16:**

  | Measure | Original (Nano) | After indexes (Nano) | Micro + all of #18–#25 |
  |---|---|---|---|
  | Swap-in (pages a second) | 158 | 56 | 0 |
  | Major page faults a second | 335 | 127 | 29 |
  | Disk reads | 4.3 MiB/s | 2.3 MiB/s | 0.8 MiB/s |
  | CPU busy | 7.5% | 4.1% | 3.3% |
  | Free memory | 123 MB | — | 500 MB |
  | Buffer cache hit rate | — | — | 99.91% |

- **Database errors, last 2 hours, read clinically:** nothing is left unexplained.
  - Restart messages from the resize.
  - Expected rejections from the test suites: BETTING_CLOSED, BELOW_MIN, OPERATOR_CANNOT_DEPOSIT, the permission-denied checks.
  - 200 "permission denied for table game_rounds" in one 78-second burst at 00:13, from a browser tab still running the old bundle when the crash-time column was hidden. That bundle asked for the column. Pages load network-first through the service worker, so a reload fixes it, and none have occurred since.
  - About 90 seconds of timeouts at 00:23, while an early version of the RLS test held table locks. The test was rewritten so it no longer does that.

## #25 — Client delivery: bundle split, caching, pushes instead of polling — DONE (branch `perf/client-delivery`)
- **First load:**
  - The profile page, marketer hub, sign-in and wallet modals are loaded on demand. The two modals are prefetched when the browser is idle, so they still open instantly.
  - Vendor code is split into `vendor-react` (53 KB gzip), `vendor-supabase` (34 KB) and icons.
  - The app's own entry chunk is 42 KB gzip.
- **Repeat visits:** hashed files under `/assets/` were served `max-age=0, must-revalidate`, so every visit re-checked every file. `public/_headers` now makes them `immutable` for a year. Sounds and images are cached for a week. `index.html` and `sw.js` are never cached, so a deploy is picked up on the next load. Verified live with `curl -I`.
- **Maintenance flag:** it was polled from every open page. It is now fetched once and pushed on the broadcast topic `config` by a trigger on `system_settings` (migration `20260928120000`). A 5-minute safety poll remains.
- **Chat:** chat went through postgres_changes, so every message was WAL-decoded and RLS-checked once per open page. It now goes out on the broadcast topic `chat` (migration `20260928130000`), and `chat_messages` was dropped from the publication (migration `20260928140000`).
- **Notifications:** still postgres_changes, but now filtered to the player's own `user_id`, so the server doesn't evaluate other players' rows for every page.
- **Test:** `supabase/tests/push_channels_e2e.py` (7/7) checks both triggers on production inside a transaction that is rolled back, so no player sees a maintenance flash or a test chat line.
- **Note for multi-brand:** the `game` and `chat` topics are global. That is correct today: there is one brand, and `bets`, `game_rounds` and `chat_messages` are readable by everyone under RLS. A second brand with its own rounds would need per-brand topics (e.g. `game:<site_id>`).

## #24 — RLS and indexes (Supabase performance advisor) — FIXED (migration `20260928110000`)
- **Per-row policy calls:** 15 policies called `auth.uid()` or `_is_admin()` once per row. They are now wrapped in `(SELECT …)`, so Postgres evaluates them once per query.
- **Staff checks:** brand-staff checks compare `site_id` to a single `_staff_site()` value instead of calling `_can_admin_site(site_id)` for every row. Overlapping SELECT policies on withdrawals and STK requests were merged into one each.
- **Indexes added:** `crash_queue(round_id)` and `free_bets(used_round_id)`. Without them, the retention job scanned all of `crash_queue` for each round it deleted. A tiny partial index covers the live round.
- **Indexes dropped:** 7 duplicate or unused indexes on hot tables, including a DESC copy of the unique round-number index and the full status index. This means less write work on every round.
- **Proof:** `supabase/tests/rls_tuning_e2e.py` (12/12) seeds two brands and 8 callers, records every row each caller can see under the old policies, applies the new ones and compares. The results are identical.

## #23 — Server clock sync — DONE
- The multiplier is drawn from `now − started_at`. A phone whose clock ran 1.5 s fast showed 1.14x while the server was still at 1.00x.
- The client now estimates its offset from the server as NTP does, using `server_time()`: 4 samples, keeping the one with the fastest round trip, repeated every 5 minutes (`src/lib/serverClock.ts`, with unit tests).

## #22 — Engine timing — FIXED (full engine authorisation given 2026-09-25)
- **Before:** `game_drive` woke on a fixed interval, so a crash or take-off could be processed up to one interval late (250 ms or more).
- **Now:** `game_tick` returns when the next thing happens: close of betting, the crash instant, or the next auto cash-out. The driver sleeps exactly until then, clamped to 3 ms–1 s. It commits after waking, so `now()` is fresh.
- **Measured on production:** crashes are processed 3–4 ms after their secret instant, and take-off is stamped 3–4 ms after betting closes. `engine_live_e2e.py` checks both stay under 60 ms.

## #21 — Bot bets — REMOVED from the database ("keep, but make them free")
- About 80% of all row changes, and of the WAL behind them, were bot rows: 15–30 inserted, updated and deleted every round. They are no longer written, and the old rows were deleted.
- **Visible change: none.** Since #4, the bet list shows real players only, so nobody ever saw the bot rows.

## #20 — Realtime moved to Broadcast — DONE (migrations `20260928090000`, `20260928100000`)
- **Before:** rounds and bets went through postgres_changes, which decodes the WAL and runs RLS for every subscriber. Measured delivery was p50 about 500 ms and p90 750–870 ms.
- **Now:** triggers send exactly the public fields on the topic `game` (events `round` and `bet`), and the tables left the publication. Measured delivery is 27–43 ms, the same for 1 or 1,000 viewers.
- The client uses one channel and re-syncs over REST when it (re)connects. It no longer polls REST for every round; the UI test asserts this.

## #19 — P0: internal functions callable by anyone — FIXED (migration `20260928080000`)
- **What:** Supabase grants EXECUTE on every new public function to `anon` and `authenticated`. 241 SECURITY DEFINER functions were callable by anyone, including `crash_round`, `start_round`, `_wallet_move` and `_settle_flight`. With just the public key, anyone could end a round or move money.
- **Fix:** EXECUTE revoked from PUBLIC, anon and authenticated on every internal function; they are granted to `service_role` only. `ALTER DEFAULT PRIVILEGES` stops new functions from being exposed. Client RPCs now need an explicit GRANT.
- **Verified:**
  - anon calling `crash_round` gets 401.
  - anon calling `_wallet_move` gets 404.
  - The public config RPC still works.
  - Every UI suite passes.

## #18 — (was #17) crash time readable by players — FIXED
- `start_round` no longer writes `game_rounds.crashes_at`. The time lives only in `round_secrets`.
- Players and the public get column-level SELECT without `crashes_at` or the override fields.
- Broadcast events carry the crash point and seed only once the round has crashed.
- **Tests:**
  - `engine_live_e2e.py` asserts that reading the column is refused.
  - Every round event before the crash is checked for leaks.
  - The UI test confirms the stored row never carries the time.

## #17 — CRITICAL: the crash time of the live round is public — FIXED, see #18
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

## Observation — game driver "fails" every 2 minutes — RESOLVED (#16: runs now end cleanly at 110 s; #22: event-driven)
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
- **Authorise the fix for #17:** DONE. Authorised on 2026-09-25 and fixed (#18).
- **Upgrade the compute from Nano to Micro:** DONE on 2026-09-25 (#26).
- **Rotate the credentials used in this session**, as planned.
- **Make one real KES 100 deposit** from a player account to confirm the whole path with real money.

## Needs the owner's decision (not changed)
- **Demo is rigged:** `useDemoGame` / `riggedCrashPoint` set the demo win rate to about 80% (`DEMO_WIN_RATE`), with near-misses on losses, "to drive conversion to real play". Real rounds use an 18% house edge (`game.house_edge_percent`).
- **Results can be set by operators:** when `game.queue_enabled` is on, operators can queue crash points (`crash_queue`). Those rounds still get a committed seed hash, so a player cannot tell them apart. The menu and footer therefore carry no "Provably Fair" claim.
- **Bot chat:** the chat panel still mixes scripted bot messages in with real ones (owner chose to keep them, 2026-09-25). They no longer appear on the game screen.
- **Name and logo:** the game is called "Aviator", and the header wordmark imitates Spribe's logo.
