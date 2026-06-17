import { describe, it, expect } from 'vitest';
import { multiplierColor, planeParkFactor } from './canvasMotion';

const rgb = (s: string) => s.split(',').map(n => parseInt(n.trim(), 10));

describe('multiplierColor — background glow blue → purple → red', () => {
  it('is a calm blue at low multipliers (1x)', () => {
    const [r, , b] = rgb(multiplierColor(1.0));
    expect(b).toBeGreaterThan(r + 80); // strongly blue
  });

  it('shifts toward purple at mid multipliers (~4x)', () => {
    const [r, g, b] = rgb(multiplierColor(4.0));
    // purple = red + blue with the lowest channel being green
    expect(r).toBeGreaterThan(120);
    expect(b).toBeGreaterThan(120);
    expect(g).toBeLessThan(r);
    expect(g).toBeLessThan(b);
  });

  it('is red at high multipliers (20x)', () => {
    const [r, , b] = rgb(multiplierColor(20));
    expect(r).toBeGreaterThan(b + 80); // strongly red
  });

  it('clamps to the top stop above 50x', () => {
    expect(multiplierColor(1000)).toBe(multiplierColor(50));
  });

  it('transitions monotonically from blue toward red as the round climbs', () => {
    const blueAt1 = rgb(multiplierColor(1));
    const redAt20 = rgb(multiplierColor(20));
    expect(redAt20[0]).toBeGreaterThan(blueAt1[0]); // more red higher up
    expect(redAt20[2]).toBeLessThan(blueAt1[2]);    // less blue higher up
  });
});

describe('planeParkFactor — when the hover engages', () => {
  it('is 0 at/below 2x (plane still climbing, no hover)', () => {
    expect(planeParkFactor(1)).toBe(0);
    expect(planeParkFactor(2)).toBe(0);
  });

  it('ramps in and saturates at 10x', () => {
    expect(planeParkFactor(6)).toBeCloseTo(0.5, 5);
    expect(planeParkFactor(10)).toBe(1);
    expect(planeParkFactor(50)).toBe(1);
  });

  it('is monotonically increasing across the ramp', () => {
    expect(planeParkFactor(4)).toBeLessThan(planeParkFactor(8));
  });
});
