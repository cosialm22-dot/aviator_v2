import { describe, it, expect } from 'vitest';
import {
  cashoutCredit,
  assertValidStake,
  assertValidAutoCashout,
  DEMO_MIN_BET,
  DEMO_MAX_BET,
  DEMO_MAX_PAYOUT,
} from './demoEngine';

// EXACT reference for the server (_bet_credit, non-free) over the real input
// domain (integer stake, 2-decimal multiplier), computed in integer cents to
// match Postgres `numeric` arithmetic. The demo must equal this for every input.
function serverCredit(amount: number, mult: number): number {
  return Math.min(Math.floor(amount * Math.round(mult * 100)) / 100, DEMO_MAX_PAYOUT);
}

describe('cashoutCredit', () => {
  it('floors to 2 decimals like the server (numeric, drift-free)', () => {
    expect(cashoutCredit(1000, 2)).toBe(2000);
    expect(cashoutCredit(333, 2)).toBe(666);
    // Drift-prone case: naive float floors to 2994.89; numeric server pays 2994.90.
    expect(cashoutCredit(2010, 1.49)).toBe(2994.9);
    expect(cashoutCredit(199, 1.33)).toBe(serverCredit(199, 1.33));
  });
  it('caps at max_payout', () => {
    expect(cashoutCredit(50000, 20)).toBe(DEMO_MAX_PAYOUT);   // 1,000,000 -> capped
    expect(cashoutCredit(50000, 10)).toBe(500000);            // exactly the cap
    expect(cashoutCredit(50000, 9.99)).toBe(499500);          // just under the cap
  });
  it('matches the server formula across a wide 2dp sample (parity, incl. drift cases)', () => {
    for (const amount of [50, 100, 199, 333, 1000, 2010, 12345, 50000]) {
      for (const mult of [1.01, 1.33, 1.49, 1.5, 2, 2.37, 2.49, 5, 9.99, 10, 13.13, 25, 100]) {
        expect(cashoutCredit(amount, mult)).toBe(serverCredit(amount, mult));
      }
    }
  });
});

describe('assertValidStake', () => {
  it('rejects below min / above max / unaffordable', () => {
    expect(() => assertValidStake(DEMO_MIN_BET - 1, 1e9)).toThrow(/allowed limits/);
    expect(() => assertValidStake(DEMO_MAX_BET + 1, 1e9)).toThrow(/allowed limits/); // max_bet parity
    expect(() => assertValidStake(NaN, 1e9)).toThrow(/allowed limits/);
    expect(() => assertValidStake(100, 50)).toThrow(/Insufficient balance/);
  });
  it('accepts valid affordable stakes at the boundaries', () => {
    expect(() => assertValidStake(DEMO_MIN_BET, DEMO_MIN_BET)).not.toThrow();
    expect(() => assertValidStake(DEMO_MAX_BET, DEMO_MAX_BET)).not.toThrow();
  });
});

describe('assertValidAutoCashout', () => {
  it('null is allowed (manual cashout)', () => {
    expect(() => assertValidAutoCashout(null)).not.toThrow();
  });
  it('rejects targets <= 1.00x', () => {
    expect(() => assertValidAutoCashout(1.0)).toThrow(/greater than 1.00x/);
    expect(() => assertValidAutoCashout(0.5)).toThrow(/greater than 1.00x/);
  });
  it('accepts targets above 1.00x', () => {
    expect(() => assertValidAutoCashout(1.01)).not.toThrow();
  });
});
