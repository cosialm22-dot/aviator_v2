# Bug Log (aviator_v2)

Running log of bugs found while working through issues, with what was wrong, the evidence, and the fix or the decision it needs.

---

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
- **Turn on automatic deposit checks.** In the Supabase SQL editor, once:
  `select vault.create_secret('https://yhfxgzfmcwinpgmzcgma.supabase.co', 'project_url');`
  `select vault.create_secret('<the MEGAPAY_CRON_SECRET value>', 'megapay_cron_secret');`
  The `megapay_reconcile` job already runs every minute and starts working as soon as both exist. Deposits → Automatic checks will then show "Every minute".
- **Make one real KES 100 deposit** from a player account to confirm the whole path with real money.

## Needs the owner's decision (not changed)
- **Demo is rigged:** `useDemoGame` / `riggedCrashPoint` set the demo win rate to about 80% (`DEMO_WIN_RATE`), with near-misses on losses, "to drive conversion to real play". Real rounds use an 18% house edge (`game.house_edge_percent`).
- **Results can be set by operators:** when `game.queue_enabled` is on, operators can queue crash points (`crash_queue`). Those rounds still get a committed seed hash, so a player cannot tell them apart. The menu and footer therefore carry no "Provably Fair" claim.
- **"Players online" is simulated:** `useOnlineCount` produces a random walk between 140 and 520.
- **Bot chat:** the chat mixes scripted bot messages in with real ones (`useChatStream`).
- **Low-balance pop-ups use made-up figures:** for example "87% of players win on their comeback bet!" (`AviatorGame` `LOW_BALANCE_NUDGES`).
- **Name and logo:** the game is called "Aviator", and the header wordmark imitates Spribe's logo.
