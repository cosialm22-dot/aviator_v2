// ============================================================================
// demoEngine - PURE settlement math for free-play (Demo) mode.
// ----------------------------------------------------------------------------
// Demo rides the REAL shared rounds (identical crash points to live). To keep
// practice honest, its payout math must MIRROR THE SERVER EXACTLY - never more
// generous. These functions reproduce the server contract:
//   * payout = floor(amount * mult, 2dp) capped at max_payout  (server _bet_credit, non-free)
//   * stakes constrained to [min_bet, max_bet]                  (server place_bet)
// Constants mirror system_settings defaults (game.min_bet / max_bet / max_payout).
// Pure and side-effect-free so they can be unit-tested and parity-checked.
// ============================================================================

export const DEMO_MIN_BET = 50;            // mirrors game.min_bet
export const DEMO_MAX_BET = 50000;         // mirrors game.max_bet
export const DEMO_MAX_PAYOUT = 500000;     // mirrors game.max_payout
export const DEMO_STARTING_BALANCE = 10000; // play-money sandbox starting balance

/**
 * Credit for cashing out a (non-free) stake at `mult`. Must equal the server's
 * `least(floor(amount*mult*100)/100, max_payout)` computed in Postgres `numeric`
 * (exact decimal). A naive float `floor(amount*mult*100)/100` suffers IEEE-754
 * drift (e.g. 2010 * 1.49 floors to 2994.89 instead of 2994.90), which would
 * make the demo diverge from real money by a cent. Since `amount` is an integer
 * stake and `mult` is always a 2-decimal value (server _multiplier_at truncates
 * to 2dp; auto-cashout targets are parsed to 2dp), we compute in INTEGER CENTS:
 *   floor(amount * round(mult*100)) / 100
 * `amount * round(mult*100)` is an exact integer, so there is no rounding drift
 * and the result matches the server bit-for-bit across the real input domain.
 */
export function cashoutCredit(amount: number, mult: number): number {
  const multCents = Math.round(mult * 100);                  // exact integer hundredths of the multiplier
  const payout = Math.floor(amount * multCents) / 100;       // integer * integer -> drift-free
  return Math.min(payout, DEMO_MAX_PAYOUT);
}

/**
 * Validate a stake exactly as place_bet does (range + affordability), throwing
 * the same friendly messages the real-money path surfaces so the UI behaves
 * identically in both modes.
 */
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
