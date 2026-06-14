import { describe, it, expect } from 'vitest';
import {
  normalizeConfig,
  settlementPnl,
  applySettlement,
  shouldStop,
  canPlaceNext,
  type AutoBetConfig,
  type AutoBetStats,
} from './autoBetEngine';

describe('normalizeConfig', () => {
  it('floors decimals and enforces minimums', () => {
    expect(normalizeConfig({ rounds: 9.7, stopLoss: 3.9, stopWin: 5.2 }))
      .toEqual({ rounds: 9, stopLoss: 3, stopWin: 5 });
  });
  it('clamps rounds to at least 1 and limits to >= 0', () => {
    expect(normalizeConfig({ rounds: 0, stopLoss: -50, stopWin: -1 }))
      .toEqual({ rounds: 1, stopLoss: 0, stopWin: 0 });
  });
  it('collapses non-finite input to the safe minimum', () => {
    expect(normalizeConfig({ rounds: NaN, stopLoss: Infinity, stopWin: -Infinity }))
      .toEqual({ rounds: 1, stopLoss: 0, stopWin: 0 });
  });
});

describe('settlementPnl', () => {
  it('won => winnings minus stake', () => {
    expect(settlementPnl('won', 100, 250)).toBe(150);
  });
  it('won with missing winnings counts as 0 payout', () => {
    expect(settlementPnl('won', 100, null)).toBe(-100);
  });
  it('lost => negative stake', () => {
    expect(settlementPnl('lost', 100, null)).toBe(-100);
  });
});

describe('applySettlement', () => {
  it('increments played, decrements remaining, folds net', () => {
    const prev: AutoBetStats = { played: 2, remaining: 8, net: -50 };
    expect(applySettlement(prev, 120)).toEqual({ played: 3, remaining: 7, net: 70 });
  });
});

describe('shouldStop', () => {
  const cfg = (o: Partial<AutoBetConfig> = {}): AutoBetConfig => ({ rounds: 10, stopLoss: 0, stopWin: 0, ...o });
  it('stops when no rounds remain', () => {
    expect(shouldStop({ played: 10, remaining: 0, net: 5 }, cfg())).toBe(true);
  });
  it('does not stop while rounds remain and no limits armed', () => {
    expect(shouldStop({ played: 1, remaining: 9, net: -9999 }, cfg())).toBe(false);
  });
  it('stop-loss disabled when 0', () => {
    expect(shouldStop({ played: 1, remaining: 9, net: -1000 }, cfg({ stopLoss: 0 }))).toBe(false);
  });
  it('stop-loss fires at the boundary (net <= -stopLoss)', () => {
    expect(shouldStop({ played: 1, remaining: 9, net: -500 }, cfg({ stopLoss: 500 }))).toBe(true);
    expect(shouldStop({ played: 1, remaining: 9, net: -499 }, cfg({ stopLoss: 500 }))).toBe(false);
  });
  it('stop-win fires at the boundary (net >= stopWin)', () => {
    expect(shouldStop({ played: 1, remaining: 9, net: 500 }, cfg({ stopWin: 500 }))).toBe(true);
    expect(shouldStop({ played: 1, remaining: 9, net: 499 }, cfg({ stopWin: 500 }))).toBe(false);
  });
});

describe('canPlaceNext', () => {
  it('false when no rounds remain', () => {
    expect(canPlaceNext(0, 100, 99999)).toBe(false);
  });
  it('false when balance below stake', () => {
    expect(canPlaceNext(5, 100, 99)).toBe(false);
  });
  it('true when exact balance equals stake', () => {
    expect(canPlaceNext(5, 100, 100)).toBe(true);
  });
});

describe('full run simulation', () => {
  // Drive a sequence of settlements through the pure folds the same way the hook
  // does, and assert the run halts on exactly the right condition.
  function runUntilStop(cfg: AutoBetConfig, pnls: number[]): { played: number; stopped: boolean } {
    let stats: AutoBetStats = { played: 0, remaining: cfg.rounds, net: 0 };
    for (const pnl of pnls) {
      if (!canPlaceNext(stats.remaining, 100, 1e9)) break;
      stats = applySettlement(stats, pnl);
      if (shouldStop(stats, cfg)) return { played: stats.played, stopped: true };
    }
    return { played: stats.played, stopped: shouldStop(stats, cfg) };
  }

  it('plays exactly `rounds` bets when no limit trips', () => {
    const r = runUntilStop({ rounds: 5, stopLoss: 0, stopWin: 0 }, [-100, -100, -100, -100, -100]);
    expect(r).toEqual({ played: 5, stopped: true });
  });
  it('halts early on stop-win', () => {
    const r = runUntilStop({ rounds: 10, stopLoss: 0, stopWin: 300 }, [100, 100, 100, 100, 100]);
    expect(r.played).toBe(3); // +100,+100,+100 => net 300 >= 300
    expect(r.stopped).toBe(true);
  });
  it('halts early on stop-loss', () => {
    const r = runUntilStop({ rounds: 10, stopLoss: 250, stopWin: 0 }, [-100, -100, -100, -100]);
    expect(r.played).toBe(3); // net -300 <= -250
    expect(r.stopped).toBe(true);
  });
});
