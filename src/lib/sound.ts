import { useSyncExternalStore } from 'react';

// Game sounds (CC0 "Interface Sounds" by Kenney, public/sounds/LICENSE.txt): bet placed, cash
// out, flew away with a bet riding, and the toggle click. On by default; the choice is saved per
// device. Browsers only allow audio after a user gesture, which every trigger here follows.
export type SoundName = 'place' | 'win' | 'loss' | 'toggle';
const KEY = 'aviator:sound';
const VOLUME: Record<SoundName, number> = { place: 0.5, win: 0.6, loss: 0.45, toggle: 0.4 };

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

export function playSound(name: SoundName): void {
  if (!enabled || typeof Audio === 'undefined') return;
  try {
    let a = cache.get(name);
    if (!a) { a = new Audio(`/sounds/${name}.mp3`); a.preload = 'auto'; cache.set(name, a); }
    a.volume = VOLUME[name];
    a.currentTime = 0;
    void a.play().catch(() => { /* autoplay blocked before the first tap */ });
  } catch { /* no audio support */ }
}
