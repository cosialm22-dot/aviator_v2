import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoWinEvent } from './useDemoGame';

// ============================================================================
// useDemoNudges - conversion prompts shown while practising in Demo mode.
// ----------------------------------------------------------------------------
// Surfaces a throttled, dismissible toast urging the player to switch to real
// money. Win-flavoured messages fire after a demo win (with the actual amount);
// general messages fire periodically. Pools rotate without immediate repeats.
// Pure of timers when inactive. CTA handling (switch to real / sign up) is the
// caller's concern (see DemoNudgeToast usage in App).
// ============================================================================

const MIN_GAP_MS = 13_000;   // never nag more often than this
const VISIBLE_MS = 9_000;    // auto-hide after this
const GENERAL_EVERY = 3;     // a general nudge every N rounds played

export interface DemoNudge { id: string; title: string; sub: string; tone: 'win' | 'general'; }

// Messages reference the just-won amount via {amt} (filled for win nudges).
const WIN_MESSAGES: { title: string; sub: string }[] = [
  { title: 'That {amt} was play money 😢', sub: 'The same cash-out in Real mode hits your M-Pesa for real.' },
  { title: 'You cashed out like a pro!', sub: 'Imagine {amt} landing in your wallet right now. Go Real →' },
  { title: 'Nice timing — {amt}!', sub: 'Real players are withdrawing wins like this every minute.' },
  { title: 'Demo {amt} feels good…', sub: 'Real {amt} feels unforgettable. One deposit away.' },
  { title: 'You clearly have the skill 🎯', sub: 'Now make it pay. Switch to Real and cash out for real.' },
];

const GENERAL_MESSAGES: { title: string; sub: string }[] = [
  { title: 'Winners don’t stay in demo ✈️', sub: 'Deposit from KSh 100 and turn practice into payouts.' },
  { title: 'The plane doesn’t care if it’s real', sub: 'But your wallet does. Play Real and keep what you win.' },
  { title: 'Your skills are wasted on play money', sub: 'Sign up in 30 seconds and bet for real M-Pesa wins.' },
  { title: 'Real wins. Instant M-Pesa. 💸', sub: 'Switch to Real mode and withdraw straight to your phone.' },
  { title: 'Next round could be your big one', sub: 'In Real mode that multiplier pays actual Shillings.' },
  { title: 'Practice is free. Profit isn’t.', sub: 'Make the leap — deposit and play for real now.' },
  { title: 'You’re one deposit from real wins 🚀', sub: 'Your comeback starts the moment you go Real.' },
];

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `nudge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fmtKsh(n: number): string {
  return 'KSh ' + Math.round(n).toLocaleString('en-KE');
}

interface Params { active: boolean; lastWin: DemoWinEvent | null; roundsPlayed: number; }

export function useDemoNudges({ active, lastWin, roundsPlayed }: Params): {
  current: DemoNudge | null;
  dismiss: () => void;
} {
  const [current, setCurrent] = useState<DemoNudge | null>(null);
  const lastShownRef = useRef(0);
  const winIdxRef = useRef(0);
  const genIdxRef = useRef(0);
  const seenWinAtRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHide = () => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } };

  const show = useCallback((nudge: DemoNudge) => {
    const now = Date.now();
    if (now - lastShownRef.current < MIN_GAP_MS) return; // throttle
    lastShownRef.current = now;
    setCurrent(nudge);
    clearHide();
    hideTimerRef.current = setTimeout(() => setCurrent(null), VISIBLE_MS);
  }, []);

  const dismiss = useCallback(() => { clearHide(); setCurrent(null); }, []);

  // Win nudge: only for a genuinely new win while active.
  useEffect(() => {
    if (!active || !lastWin || lastWin.at <= seenWinAtRef.current) return;
    seenWinAtRef.current = lastWin.at;
    const m = WIN_MESSAGES[winIdxRef.current++ % WIN_MESSAGES.length];
    const amt = fmtKsh(lastWin.amount);
    show({ id: newId(), tone: 'win', title: m.title.replace('{amt}', amt), sub: m.sub.replace('{amt}', amt) });
  }, [active, lastWin, show]);

  // General nudge: every N rounds the player participated in.
  useEffect(() => {
    if (!active || roundsPlayed === 0 || roundsPlayed % GENERAL_EVERY !== 0) return;
    const m = GENERAL_MESSAGES[genIdxRef.current++ % GENERAL_MESSAGES.length];
    show({ id: newId(), tone: 'general', title: m.title, sub: m.sub });
  }, [active, roundsPlayed, show]);

  // Clear when leaving demo; clean up the timer on unmount.
  useEffect(() => { if (!active) { clearHide(); setCurrent(null); } }, [active]);
  useEffect(() => () => clearHide(), []);

  return { current, dismiss };
}
