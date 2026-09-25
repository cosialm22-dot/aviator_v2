import { useEffect, useRef, useState } from 'react';
import { onWinLanded, winInFlight } from '../lib/winFx';

const COUNT_MS = 650;
const GRACE_MS = 280; // the balance can update a moment before the win flight starts

/**
 * The balance as shown in the header. Decreases (a bet) show at once. Increases count up, and if a
 * win is flying to the balance the count starts when it lands, so the number grows as the coins
 * arrive.
 */
export function useWinBalance(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    const set = (v: number) => { shownRef.current = v; setShown(v); };
    if (!(value > from) || typeof requestAnimationFrame !== 'function') { set(value); return; }
    let raf = 0, timer: ReturnType<typeof setTimeout> | undefined, off: (() => void) | undefined, started = false;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = () => {
      if (started) return; started = true;
      off?.(); if (timer) clearTimeout(timer);
      if (reduce) { set(value); return; }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / COUNT_MS);
        const e = 1 - Math.pow(1 - k, 3);
        set(k >= 1 ? value : from + (value - from) * e);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const waitForLanding = () => { off = onWinLanded(run); timer = setTimeout(run, 1600); };
    if (winInFlight()) waitForLanding();
    else timer = setTimeout(() => { if (winInFlight()) waitForLanding(); else run(); }, GRACE_MS);
    return () => { cancelAnimationFrame(raf); if (timer) clearTimeout(timer); off?.(); if (!started) set(value); else shownRef.current = value; };
  }, [value]);
  return shown;
}
