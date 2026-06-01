/**
 * Generates a provably-fair-style crash point.
 * Distribution: P(crash >= x) = 0.97/x for x >= 1
 * House edge: ~3%
 */
export function generateCrashPoint(): number {
  const h = Math.random();
  if (h < 0.03) return 1.00;
  const raw = 0.97 / (1 - h);
  return Math.floor(raw * 100) / 100;
}

/**
 * Returns multiplier at a given elapsed time (ms).
 * Growth rate tuned so ~2x is reached at ~7s.
 */
export function getMultiplierAtTime(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1.0;
  const raw = Math.pow(Math.E, 0.00009 * elapsedMs);
  return Math.floor(raw * 100) / 100;
}

/**
 * Returns elapsed time (ms) at which a given multiplier is reached.
 */
export function getTimeAtMultiplier(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return Math.log(multiplier) / 0.00009;
}

/**
 * Formats multiplier for display.
 */
export function formatMultiplier(value: number): string {
  if (value >= 100) return value.toFixed(0) + 'x';
  return value.toFixed(2) + 'x';
}

/**
 * Returns color class based on multiplier value.
 */
export function getMultiplierColor(value: number): string {
  if (value < 1.5) return '#fbbf24';
  if (value < 2) return '#34d399';
  if (value < 5) return '#10b981';
  if (value < 10) return '#06b6d4';
  return '#f59e0b';
}

/**
 * Gets the crash point color for history display.
 */
export function getCrashColor(value: number): string {
  if (value < 1.5) return 'bg-red-600 text-white';
  if (value < 2) return 'bg-yellow-600 text-white';
  if (value < 5) return 'bg-green-600 text-white';
  if (value < 10) return 'bg-cyan-600 text-white';
  return 'bg-amber-500 text-black';
}
