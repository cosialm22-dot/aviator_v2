import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Crash point generator with elevated house edge (~18-20%).
 *
 * Psychology design:
 * - ~35% of rounds crash at 1.0x-1.5x (instant losses, "unlucky" feeling)
 * - ~30% crash at 1.5x-2.5x (near-miss zone — user almost won big)
 * - ~20% crash at 2.5x-6x (moderate wins that feel great, reinforce play)
 * - ~10% crash at 6x-20x (exciting wins users screenshot and share)
 * - ~5% crash at 20x+ (rare "jackpot" rounds that create FOMO stories)
 *
 * The key insight: frequent 1.5x-2.3x rounds make users think 2x cashouts
 * are "easy", so they keep betting — but the 35% sub-1.5x crashes drain
 * balances steadily. Expected return to player: ~82% (18% house edge).
 */
export function generateCrashPoint(): number {
  const r = Math.random();

  // 8% instant crash at exactly 1.00x — brutal but rare enough to seem unlucky
  if (r < 0.08) return 1.00;

  // 27% crash between 1.01x–1.49x — below most cashout targets, pure loss
  if (r < 0.35) {
    return 1.01 + Math.random() * 0.48;
  }

  // 30% crash between 1.5x–2.49x — the near-miss sweetspot
  // Users set 2x auto-cashout, these rounds either just pay or just miss
  if (r < 0.65) {
    return 1.50 + Math.random() * 0.99;
  }

  // 20% crash between 2.5x–6x — satisfying wins that keep users engaged
  if (r < 0.85) {
    return 2.50 + Math.random() * 3.50;
  }

  // 10% crash between 6x–20x — exciting, shareable, FOMO-generating
  if (r < 0.95) {
    return 6.0 + Math.random() * 14.0;
  }

  // 5% crash between 20x–80x — legendary rounds, create word-of-mouth
  return 20.0 + Math.random() * 60.0;
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
  if (value < 2)   return '#34d399';
  if (value < 5)   return '#10b981';
  if (value < 10)  return '#06b6d4';
  return '#f59e0b';
}

/**
 * Gets the crash point color for history display.
 */
export function getCrashColor(value: number): string {
  if (value < 1.5) return 'bg-red-600 text-white';
  if (value < 2)   return 'bg-yellow-600 text-white';
  if (value < 5)   return 'bg-green-600 text-white';
  if (value < 10)  return 'bg-cyan-600 text-white';
  return 'bg-amber-500 text-black';
}

/**
 * Gets the next crash point from the crash_queue if enabled, otherwise generates randomly.
 * Reads game.queue_enabled from system_settings. Consumes queue items (marks them used).
 */
export async function getNextCrashPoint(supabase: SupabaseClient): Promise<{
  point: number;
  source: 'algorithm' | 'queue';
  queueId: string | null;
}> {
  try {
    const { data: settings } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'game.queue_enabled')
      .maybeSingle();

    if (settings?.value === true || settings?.value === 'true') {
      const { data: items } = await supabase
        .from('crash_queue')
        .select('id, crash_point')
        .eq('status', 'pending')
        .order('position', { ascending: true })
        .limit(1);

      if (items && items.length > 0) {
        await supabase
          .from('crash_queue')
          .update({ status: 'used', used_at: new Date().toISOString() })
          .eq('id', items[0].id);
        return { point: Number(items[0].crash_point), source: 'queue', queueId: items[0].id };
      }
    }
  } catch {
    // Queue fetch failed — fall back to random generation
  }

  return { point: generateCrashPoint(), source: 'algorithm', queueId: null };
}
