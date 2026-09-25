import { describe, it, expect } from 'vitest';
import { shortBetError } from './betErrors';

describe('short bet errors', () => {
  it('maps real and demo engine messages to a couple of words', () => {
    expect(shortBetError(new Error('Betting is closed for this round.'))).toBe('Betting closed');
    expect(shortBetError(new Error('Insufficient balance.'))).toBe('Low balance');
    expect(shortBetError(new Error('Bet amount is outside the allowed limits.'))).toBe('Outside limits');
    expect(shortBetError(new Error('Too late - the round already crashed.'))).toBe('Too late');
    expect(shortBetError(new Error('Please sign in to bet.'))).toBe('Log in first');
    expect(shortBetError(new Error('Operator accounts cannot place bets.'))).toBe('Staff account');
  });
  it('never shows raw text it does not know', () => {
    expect(shortBetError(new Error('duplicate key value violates unique constraint'))).toBe('Try again');
    expect(shortBetError('x')).toBe('Try again');
  });
});
