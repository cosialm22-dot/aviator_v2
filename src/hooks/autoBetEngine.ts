import type { ActiveBet } from './useGame';

// ============================================================================
// autoBetEngine - PURE decision logic for the client-side auto-bet sequencer.
// ----------------------------------------------------------------------------
// Extracted from useAutoBet so the rules that govern an auto-bet run can be
// reasoned about and unit-tested in isolation, with no React, timers, or I/O.
// The hook (useAutoBet) owns side effects (placing bets, refs, effects); this
// module owns the arithmetic and the stop/continue decisions. Behaviour is
// identical to the original inline logic - this is a refactor, not a change.
// ============================================================================

export interface AutoBetConfig {
  rounds: number;    // number of rounds to auto-play (>= 1)
  stopLoss: number;  // halt when cumulative net <= -stopLoss (0 = disabled)
  stopWin: number;   // halt when cumulative net >=  stopWin  (0 = disabled)
}

export interface AutoBetStats {
  played: number;    // settlements tallied so far
  remaining: number; // rounds still to play (can briefly equal 0)
  net: number;       // cumulative profit/loss across the run
}

export const DEFAULT_AUTO_BET_CONFIG: AutoBetConfig = { rounds: 10, stopLoss: 0, stopWin: 0 };

/**
 * Clamp raw user input to a valid run config:
 *   - rounds >= 1 (always play at least one round),
 *   - stopLoss / stopWin >= 0 (0 means "disabled"),
 *   - all coerced to whole numbers.
 * Non-finite input (NaN/Infinity) collapses to the safe minimum.
 */
export function normalizeConfig(c: AutoBetConfig): AutoBetConfig {
  const floorSafe = (n: number, min: number) => {
    const v = Math.floor(n);
    return Number.isFinite(v) ? Math.max(min, v) : min;
  };
  return {
    rounds: floorSafe(c.rounds, 1),
    stopLoss: floorSafe(c.stopLoss, 0),
    stopWin: floorSafe(c.stopWin, 0),
  };
}

/**
 * Realized profit/loss of ONE settled bet.
 *   won  => winnings - stake
 *   lost => -stake
 * Only meaningful for terminal statuses; a missing payout counts as 0 won.
 */
export function settlementPnl(
  status: ActiveBet['status'],
  amount: number,
  winnings: number | null | undefined,
): number {
  return status === 'won' ? Number(winnings ?? 0) - amount : -amount;
}

/** Fold one settlement into the running stats (pure; no mutation). */
export function applySettlement(prev: AutoBetStats, pnl: number): AutoBetStats {
  return { played: prev.played + 1, remaining: prev.remaining - 1, net: prev.net + pnl };
}

/**
 * Whether the sequence must halt AFTER the latest settlement:
 *   - all requested rounds played (remaining <= 0), or
 *   - stop-loss armed and hit (net <= -stopLoss), or
 *   - stop-win armed and hit (net >= stopWin).
 */
export function shouldStop(stats: AutoBetStats, cfg: AutoBetConfig): boolean {
  const hitLoss = cfg.stopLoss > 0 && stats.net <= -cfg.stopLoss;
  const hitWin = cfg.stopWin > 0 && stats.net >= cfg.stopWin;
  return stats.remaining <= 0 || hitLoss || hitWin;
}

/**
 * Whether the next stake may be placed in the current waiting window:
 * rounds remain AND the affordable balance covers the (fixed) stake.
 */
export function canPlaceNext(remaining: number, stake: number, balance: number): boolean {
  return remaining > 0 && balance >= stake;
}
