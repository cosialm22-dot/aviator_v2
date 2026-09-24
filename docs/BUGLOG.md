# Bug Log (aviator_v2)

Running log of bugs found while working through issues, with what was wrong, the evidence, and the fix or the decision it needs.

---

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

## Needs the owner's decision (not changed)
- **Demo is rigged:** `useDemoGame` / `riggedCrashPoint` set the demo win rate to about 80% (`DEMO_WIN_RATE`), with near-misses on losses, "to drive conversion to real play". Real rounds use an 18% house edge (`game.house_edge_percent`).
- **Results can be set by operators:** when `game.queue_enabled` is on, operators can queue crash points (`crash_queue`). Those rounds still get a committed seed hash, so a player cannot tell them apart. The menu and footer therefore carry no "Provably Fair" claim.
- **"Players online" is simulated:** `useOnlineCount` produces a random walk between 140 and 520.
- **Bot chat:** the chat mixes scripted bot messages in with real ones (`useChatStream`).
- **Low-balance pop-ups use made-up figures:** for example "87% of players win on their comeback bet!" (`AviatorGame` `LOW_BALANCE_NUDGES`).
- **Name and logo:** the game is called "Aviator", and the header wordmark imitates Spribe's logo.
