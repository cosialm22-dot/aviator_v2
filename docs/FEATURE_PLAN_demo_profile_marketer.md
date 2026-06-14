# Feature Plan — Demo Mode, Player Profile, Marketer Hub, Plane Sprite

> Engineering plan and decision log for the 2026-Q2 work. Every decision below is
> grounded in the existing system (server-authoritative engine, Phase-1 security
> lockdown, four-role RBAC). No new database migrations are introduced; all new
> capability is client-side or reuses existing SECURITY DEFINER RPCs.

## Delivery protocol
Work ships in **phases**. Each phase: implement → verify (`tsc --noEmit` +
`vitest run` + `vite build`) → commit to branch `feat/demo-profile-marketer`.
A phase is not started until the previous one is green and committed.

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Plane sprite replacement (`GameCanvas`) | ✅ done (on main) |
| 2 | Demo mode overhaul (header entry, rigged client engine, nudges) | ✅ done (on main) |
| 3 | Player profile MVP (`/profile`: Account · Stats · My Bets · Transactions) | ✅ done (on main) |
| 4 | Marketer hub (`/marketer` in player shell, removed from admin; charts + psychology + social invite) | ✅ done (on main) |

---

## Phase 1 — Plane sprite
- Source art (170×66, opaque dark-teal background) chroma-keyed to a transparent
  PNG (`redness = R − max(G,B)` smooth ramp), tight-cropped, 4× upscaled →
  `public/plane.png`.
- `GameCanvas` now dispatches: `drawRedPlane` → `drawPlaneSprite` (sprite +
  animated exhaust/flame trail) once the image decodes, else `drawVectorPlane`
  (the **original art preserved verbatim**) so a slow/failed load never renders an
  empty flight tip. Nose points +x, so the existing tangent rotation is unchanged.

---

## Phase 2 — Demo mode (decision-critical)
**Decision — demo must be a self-contained, rigged, client-only engine.**
A 80% win-rate is impossible while demo "rides the real shared rounds": the
visible crash point is the real one and cannot be faked. Therefore demo mode runs
its **own** round lifecycle (waiting→flying→crashed), multiplier animation, crash
points, simulated bot board and history — entirely in the browser, never touching
the DB. Real mode is unchanged (server-authoritative).

Requirements locked with product:
- Entry: a **Demo** button in the header, immediately left of **Sign In**
  (top-right). No signup required to play demo.
- Starting play-money balance: **KSh 1,000** (was 10,000). Wins keep accruing.
- **Rigged 80% win rate.** Crash point is generated *after* the betting window
  closes, with knowledge of the player's active demo bet(s):
  - Let `T` = the player's effective cashout target for the round: the max
    `auto_cashout` among active demo bets, or `2.00` for manual bets with no
    target (a comfortable, attainable default).
  - With probability **0.80**: sample `crash ≥ T` (favourable — player wins).
    Draw from a generous distribution biased above `T` so manual players also have
    ample time to cash out.
  - With probability **0.20**: sample `crash < T` (loss), but keep it ≥ 1.01 and
    occasionally near-miss (just below `T`) to maximise "so close" tension.
  - Rounds with **no** player bet use a neutral, realistic distribution (the rig
    only applies when the player has skin in the round).
  - Payout math reuses `demoEngine.cashoutCredit` (mirrors server `_bet_credit`).
- **Conversion nudges:** while in demo, rotate ≥10 creative toast messages urging
  real play (after wins, after a few rounds, on big multipliers). Implemented as a
  dedicated `useDemoNudges` hook + lightweight toast; throttled and dismissible.
- Real-money mode and the operator betting lock are untouched.

## Phase 3 — Player profile MVP
Route `/profile` inside the player app shell. Mobile-first (tabbed, large touch
targets, single-column at 360px). **Zero new backend** — all data already exists:
- **Account:** `profiles` (username, phone from auth email, avatar, role, joined).
- **Stats:** `get_my_stats()` RPC (rounds, win rate, wagered/won, best multiplier).
- **My Bets:** `bets` filtered to the user (RLS-readable).
- **Transactions:** `transactions` (owner-readable per RLS).
Provably-fair detail (seed hash → revealed seed) surfaced per crashed round.

## Phase 4 — Marketer hub
- **Move out of the operator admin panel.** Remove `marketer` from admin
  `STAFF_ROLES`; admin panel becomes operators-only (`admin`, `super_admin`).
- New route **`/marketer`** rendered in the **player shell** (marketer is already
  signed in as a player — no second login). Header "Marketer Dashboard" → `/marketer`.
- Content (reusing `marketer_dashboard()` + affiliate RPCs; charts via existing
  `recharts`-free SVG/`charts.tsx` patterns): earnings & funnel KPIs, referrals
  cumulative chart, commission ledger, **referral link with one-tap social share**
  (WhatsApp, X, Facebook, Telegram, copy), payout request, and motivational
  framing (goals, projected earnings, streaks) to position affiliate work as a
  real income opportunity worth investing in.

---

## Testing
Automated gate per phase: `npm run typecheck` (tsc), `vitest run` (unit/parity
tests, incl. new demo-rig tests), `vite build` (bundles clean). Pure logic
(demo crash rigging, nudge rotation, stats/format helpers) is unit-tested.
Interactive click-through remains a manual QA step (no browser harness in CI).
