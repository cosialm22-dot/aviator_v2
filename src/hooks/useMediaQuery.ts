import { useSyncExternalStore } from 'react';

/** True while the media query matches (e.g. '(min-width: 1024px)'). */
export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => matchMedia(q).matches,
    () => false,
  );
}
