import { useEffect, useState } from 'react';

/**
 * The live multiplier for a component that has to show it (e.g. the Cash Out value), sampled on
 * its own clock while `active`. The engines keep the frame-rate value in a ref and never push it
 * through React state, so only the few components that use this hook re-render during a flight.
 */
export function useLiveMultiplier(get: () => number, active: boolean, hz = 12): number {
  const [m, setM] = useState(get);
  useEffect(() => {
    setM(get());
    if (!active) return;
    const id = setInterval(() => setM(get()), 1000 / hz);
    return () => clearInterval(id);
  }, [get, active, hz]);
  return active ? m : get();
}
