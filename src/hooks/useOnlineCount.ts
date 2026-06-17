import { useEffect, useRef, useState } from 'react';

// ============================================================================
// useOnlineCount — simulated "players online" presence.
//
// The platform exposes no realtime presence channel, so a truthful live count is
// not available client-side. To keep the room feeling populated we render a
// believable, CONTINUOUSLY-CHANGING figure rather than a static placeholder:
//
//   • a bounded random walk (never sticks at one value),
//   • with mild mean-reversion toward a baseline (wanders without drifting to a
//     bound and flat-lining), and
//   • refreshed on a randomised cadence (never ticks on a mechanical beat).
//
// It never reports fewer than `floor` — the number of bets actually visible this
// round — so the headline can't contradict the on-screen bet list.
// ============================================================================
const MIN = 140;
const MAX = 520;
const BASELINE = 320;

export function useOnlineCount(floor = 0): number {
  const [count, setCount] = useState(
    () => BASELINE + Math.round((Math.random() - 0.5) * 80),
  );
  // Keep the latest floor without re-arming the timer on every bet change.
  const floorRef = useRef(floor);
  floorRef.current = floor;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setCount((c) => {
        const reversion = (BASELINE - c) * 0.05; // gentle pull to baseline
        const step = (Math.random() - 0.5) * 14 + reversion;
        const next = Math.round(c + step);
        return Math.max(MIN, Math.min(MAX, next));
      });
      timer = setTimeout(tick, 1400 + Math.random() * 1600); // 1.4–3.0s
    };
    timer = setTimeout(tick, 1400 + Math.random() * 1600);
    return () => clearTimeout(timer);
  }, []);

  return Math.max(count, floorRef.current);
}
