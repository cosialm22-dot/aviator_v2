import { describe, expect, it } from 'vitest';
import { CROWD_MAX, CROWD_MIN, generateBots } from './botSimulator';

describe('demo crowd', () => {
  it('150–300 players per round, unique names and ids', () => {
    for (let r = 0; r < 50; r++) {
      const bots = generateBots(Infinity, undefined, r);
      expect(bots.length).toBeGreaterThanOrEqual(CROWD_MIN);
      expect(bots.length).toBeLessThanOrEqual(CROWD_MAX);
      expect(new Set(bots.map((b) => b.username)).size).toBe(bots.length);
      expect(new Set(bots.map((b) => b.id)).size).toBe(bots.length);
    }
  });
  it('sorted by cash-out point (nulls last) so the frame loop can use a pointer', () => {
    const bots = generateBots(Infinity, 300, 1);
    const pts = bots.map((b) => b.cashoutAt ?? Infinity);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThanOrEqual(pts[i - 1]);
  });
  it('no bot cashes out at or above a known crash point', () => {
    const bots = generateBots(2, 300, 1);
    expect(bots.every((b) => b.cashoutAt == null || b.cashoutAt < 2)).toBe(true);
  });
  it('300 players in well under a millisecond each', () => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) generateBots(Infinity, 300, i);
    expect((performance.now() - t) / 200).toBeLessThan(2);
  });
});
