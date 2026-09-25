import { useSyncExternalStore } from 'react';

// Game sounds (all CC0, see public/sounds/LICENSE.txt): bet placed, cash out, the jet roar when
// the plane flies away, and the toggle click. On by default; the choice is saved per device.
// Browsers (iOS above all) only play audio an element has been allowed to play by a user gesture,
// so the first tap anywhere unlocks every sound; after that they play on game events too.
export type SoundName = 'place' | 'win' | 'flyaway' | 'toggle';
const NAMES: SoundName[] = ['place', 'win', 'flyaway', 'toggle'];
const KEY = 'aviator:sound';
// flyaway is a sustained roar (mean -10 dB vs about -20 dB for the chimes): 0.3 puts it level.
const VOLUME: Record<SoundName, number> = { place: 0.5, win: 0.6, flyaway: 0.3, toggle: 0.4 };

let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
const listeners = new Set<() => void>();
const cache = new Map<SoundName, HTMLAudioElement>();

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  listeners.forEach((l) => l());
  if (on) playSound('toggle');
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => enabled,
    () => true,
  );
}

function audio(name: SoundName): HTMLAudioElement {
  let a = cache.get(name);
  if (!a) { a = new Audio(`/sounds/${name}.mp3`); a.preload = 'auto'; cache.set(name, a); }
  return a;
}

// First tap/key anywhere: load every sound and play each one silently for an instant, which is
// what lets iOS/Android play it later from a game event (e.g. the fly-away) without a tap.
if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    for (const n of NAMES) {
      try {
        const a = audio(n);
        if (!a.paused) continue;
        a.muted = true;
        // If a real play claimed the element meanwhile (it unmutes it), leave it playing.
        void a.play().then(() => { if (a.muted) { a.pause(); a.currentTime = 0; a.muted = false; } }, () => { a.muted = false; });
      } catch { /* no audio support */ }
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

export function playSound(name: SoundName): void {
  if (!enabled || typeof Audio === 'undefined') return;
  try {
    const a = audio(name);
    a.muted = false;
    a.volume = VOLUME[name];
    a.currentTime = 0;
    void a.play().catch(() => { /* autoplay blocked before the first tap */ });
  } catch { /* no audio support */ }
}
