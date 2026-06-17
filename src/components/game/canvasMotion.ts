// Pure motion/colour helpers for the flight canvas. Kept in their own module
// (not GameCanvas.tsx) so the component file only exports a component — and so
// this logic is unit-testable in isolation.

// Background glow colour shifts with the multiplier: a single calm blue at low
// multipliers, transitioning through purple to red as the round climbs — so the
// canvas itself signals how high the round has flown.
export const GLOW_STOPS: [number, [number, number, number]][] = [
  [1.0,  [40, 120, 230]],   // blue
  [2.0,  [90, 90, 235]],    // indigo
  [4.0,  [150, 65, 225]],   // purple
  [8.0,  [210, 45, 150]],   // magenta
  [15.0, [235, 35, 70]],    // red
  [50.0, [240, 90, 40]],    // red-orange
];

/** Interpolated "r, g, b" glow string for a given multiplier (clamped to stops). */
export function multiplierColor(m: number): string {
  const x = Math.max(1, m);
  let lo = GLOW_STOPS[0];
  let hi = GLOW_STOPS[GLOW_STOPS.length - 1];
  for (let i = 0; i < GLOW_STOPS.length - 1; i++) {
    if (x >= GLOW_STOPS[i][0] && x <= GLOW_STOPS[i + 1][0]) { lo = GLOW_STOPS[i]; hi = GLOW_STOPS[i + 1]; break; }
  }
  const span = hi[0] - lo[0];
  const f = span > 0 ? Math.min(1, Math.max(0, (x - lo[0]) / span)) : 0;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f);
  return `${r}, ${g}, ${b}`;
}

// Parked-plane hover ramp: 0 below 2x (the plane is still climbing) rising to 1
// at 10x, so the wander only engages once the plane is effectively parked.
export function planeParkFactor(m: number): number {
  return Math.min(1, Math.max(0, (m - 2) / 8));
}
