// ============================================================================
// Server clock sync.
//
// The flight multiplier is a function of (now − started_at). started_at is stamped by the
// database clock, so a phone whose clock runs 1.5 s fast would show 1.14x while the server —
// which decides every cash-out — is still at 1.00x. We estimate the offset the way NTP does:
// ask the server for its time a few times, keep the sample with the shortest round trip, and
// assume the answer was produced halfway through it.
// ============================================================================

export interface ClockSample { sentAt: number; receivedAt: number; serverMs: number }

/** Offset (ms) to ADD to Date.now() to get server time, from the lowest-latency sample. */
export function estimateOffset(samples: ClockSample[]): { offset: number; rtt: number } | null {
  const ok = samples.filter((s) => Number.isFinite(s.serverMs) && s.receivedAt >= s.sentAt);
  if (!ok.length) return null;
  const best = ok.reduce((a, b) => (b.receivedAt - b.sentAt < a.receivedAt - a.sentAt ? b : a));
  const rtt = best.receivedAt - best.sentAt;
  return { offset: best.serverMs - (best.sentAt + rtt / 2), rtt };
}

export type ServerTimeFetch = () => Promise<number>;

/** Takes `n` samples (sequentially, so they don't queue behind each other). */
export async function syncClock(fetchServerMs: ServerTimeFetch, n = 4, now: () => number = Date.now): Promise<{ offset: number; rtt: number } | null> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < n; i++) {
    const sentAt = now();
    try {
      const serverMs = await fetchServerMs();
      samples.push({ sentAt, receivedAt: now(), serverMs });
    } catch { /* ignore a failed sample */ }
  }
  return estimateOffset(samples);
}

let offsetMs = 0;
/** Current best estimate of server time (ms since epoch). */
export const serverNow = (): number => Date.now() + offsetMs;
export const setServerOffset = (ms: number): void => { offsetMs = Number.isFinite(ms) ? ms : 0; };
export const getServerOffset = (): number => offsetMs;
