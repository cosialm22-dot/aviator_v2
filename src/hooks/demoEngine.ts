// ============================================================================
// demoEngine - PURE math for free-play (Demo) mode.
// ----------------------------------------------------------------------------
// Demo mode is a SELF-CONTAINED, client-only sandbox (see useDemoGame). It does
// NOT ride the real shared rounds: a controlled, conversion-oriented win rate is
// impossible against a crash point the player can see, so the demo runs its own
// rigged round lifecycle entirely in the browser and never touches the DB.
//
// Two concerns live here, both pure and unit-tested:
//   1. cashoutCredit / validation - the PAYOUT math, which still mirrors the
//      server contract EXACTLY (floor to 2dp, max-payout cap, stake range) so
//      winning amounts look and feel identical to real money.
//   2. riggedCrashPoint - the demo's intentionally favourable crash generator
//      (target ~80% wins) used only by the demo engine, never by real money.
// ============================================================================

export const DEMO_MIN_BET = 50;             // mirrors game.min_bet
export const DEMO_MAX_BET = 50000;          // mirrors game.max_bet
export const DEMO_MAX_PAYOUT = 500000;      // mirrors game.max_payout
export const DEMO_STARTING_BALANCE = 1000;  // play-money starting balance (KSh)

// Demo is tuned to convert: the player wins ~80% of rounds they bet on.
export const DEMO_WIN_RATE = 0.8;
// Effective cashout target assumed for a manual (no auto-cashout) bet when
// deciding a favourable round - a comfortable, attainable multiplier.
export const DEMO_MANUAL_TARGET = 2.0;

/**
 * Credit for cashing out a stake at `mult`. Must equal the server's
 * `least(floor(amount*mult*100)/100, max_payout)` computed in Postgres `numeric`.
 * Computed in INTEGER CENTS (amount integer, mult 2dp) to avoid IEEE-754 drift
 * (e.g. 2010 * 1.49 must floor to 2994.90, not 2994.89), matching the server
 * bit-for-bit across the real input domain.
 */
export function cashoutCredit(amount: number, mult: number): number {
  const multCents = Math.round(mult * 100);            // exact integer hundredths
  const payout = Math.floor(amount * multCents) / 100; // integer*integer -> drift-free
  return Math.min(payout, DEMO_MAX_PAYOUT);
}

/** Validate a stake exactly as place_bet does (range + affordability). */
export function assertValidStake(amount: number, balance: number): void {
  if (!Number.isFinite(amount) || amount < DEMO_MIN_BET || amount > DEMO_MAX_BET) {
    throw new Error('Bet amount is outside the allowed limits.');
  }
  if (amount > balance) throw new Error('Insufficient balance.');
}

/** Validate an auto-cashout target exactly as the server does (> 1.00x). */
export function assertValidAutoCashout(target: number | null): void {
  if (target != null && target <= 1.0) {
    throw new Error('Auto-cashout must be greater than 1.00x.');
  }
}

/**
 * Rigged crash point for a demo round given the player's effective cashout
 * target `T` (the max auto-cashout among active bets, or DEMO_MANUAL_TARGET for
 * a manual bet). With probability DEMO_WIN_RATE the round crashes AT/ABOVE `T`
 * (the player wins, with occasional big multipliers for excitement); otherwise
 * it crashes BELOW `T` (a loss, frequently a near-miss to maximise tension).
 *
 * Pure: `rng` is injectable so the distribution can be unit-tested
 * deterministically. Result is always >= 1.00 and floored to 2dp.
 */
export function riggedCrashPoint(target: number, rng: () => number = Math.random): number {
  const T = Math.max(1.01, target);
  const floor2 = (n: number) => Math.floor(n * 100) / 100;

  if (rng() < DEMO_WIN_RATE) {
    // Favourable: crash strictly at/above the target so the player cashes out.
    const r = rng();
    let cp: number;
    if (r < 0.55) cp = T + rng() * 1.5;            // modest win just past target
    else if (r < 0.87) cp = T + 1.5 + rng() * 4.5; // solid win
    else cp = T + 6 + rng() * 40;                   // big, shareable win (FOMO)
    const v = floor2(cp);
    // Guarantee a 2dp result that is never below the target (so the player wins).
    return v >= T ? v : Math.ceil(T * 100) / 100;
  }

  // Unfavourable: crash below the target.
  if (T <= 1.02) return 1.0; // degenerate target -> instant bust
  const r = rng();
  const cp = r < 0.6
    ? T * 0.8 + rng() * (T * 0.2)        // near-miss [0.8T, T)
    : 1.01 + rng() * (T * 0.8 - 1.01);    // clearly short
  return Math.min(floor2(T - 0.01), Math.max(1.0, floor2(cp)));
}
