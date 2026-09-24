import { describe, it, expect } from 'vitest';
import { delta, kes, kesCompact, maskPhone, pct, relTime, staffError } from './format';

describe('admin formatting', () => {
  it('money', () => {
    expect(kes(1234)).toBe('KSh 1,234');
    expect(kes(1234.5)).toBe('KSh 1,234.50');
    expect(kes(-100)).toBe('−KSh 100');
    expect(kes('x')).toBe('KSh 0');
    expect(kesCompact(1_250_000)).toBe('KSh 1.3M');
    expect(kesCompact(45_300)).toBe('KSh 45.3K');
    expect(kesCompact(999)).toBe('KSh 999');
    expect(kesCompact(-2_000_000)).toBe('−KSh 2.0M');
  });
  it('deltas are coloured by whether the move is good', () => {
    expect(delta(112, 100)).toEqual({ text: '▲ 12%', good: true });
    expect(delta(80, 100)).toEqual({ text: '▼ 20%', good: false });
    expect(delta(80, 100, 'down')).toEqual({ text: '▼ 20%', good: true });
    expect(delta(5, 0)).toEqual({ text: 'New', good: true });
    expect(delta(0, 0)).toBeNull();
  });
  it('percent, time, phone', () => {
    expect(pct(1, 4)).toBe('25%');
    expect(pct(1, 0)).toBe('—');
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(relTime('2026-09-25T11:59:00Z', now)).toBe('1m ago');
    expect(relTime('2026-09-25T09:00:00Z', now)).toBe('3h ago');
    expect(relTime('2026-09-20T12:00:00Z', now)).toBe('5d ago');
    expect(maskPhone('254712345678')).toBe('0712 •••678');
  });
  it('error copy never leaks SQL', () => {
    expect(staffError(new Error('FORBIDDEN_SITE'))).toBe('That belongs to another brand.');
    expect(staffError({ message: 'INVALID_RANGE: minimum bet must be >= 1' })).toBe('Minimum bet must be >= 1');
    expect(staffError(new Error('relation "x" does not exist'))).toBe('Something went wrong. Please try again.');
  });
});
