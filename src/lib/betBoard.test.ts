import { describe, it, expect } from 'vitest';
import { multColor, maskName, realOnly, fmtX } from './betBoard';

describe('bets board helpers', () => {
  it('colours multipliers like the mock: blue < 2x, purple 2–10x, pink >= 10x', () => {
    expect(multColor(1.99)).toContain('34b4ff');
    expect(multColor(2)).toContain('913ef8');
    expect(multColor(9.99)).toContain('913ef8');
    expect(multColor(10)).toContain('c017b4');
  });
  it('masks other players\' names', () => {
    expect(maskName('david8')).toBe('d***8');
    expect(maskName('ab')).toBe('a***');
  });
  it('drops bot rows so only real bets are listed or counted', () => {
    const rows = [{ id: 1, is_bot: true }, { id: 2, is_bot: false }, { id: 3, is_bot: true }];
    expect(realOnly(rows).map((r) => r.id)).toEqual([2]);
  });
  it('formats multipliers with thousands separators', () => {
    expect(fmtX(1217.79)).toBe('1,217.79x');
  });
});
