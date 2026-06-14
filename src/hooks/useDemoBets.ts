import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStatus } from '../types';
import type { ActiveBet, ActiveBets, BetSlot } from './useGame';

// ============================================================================
// useDemoBets - CLIENT-SIDE FREE-PLAY (DEMO) SANDBOX
// ----------------------------------------------------------------------------
// Demo mode lets anyone (guests, players, even operators) practise on the REAL
// shared rounds using play money only. It is deliberately 100% client-side:
//   • it never calls place_bet / cash_out and never writes wallets, bets,
//     transactions, leaderboards or any DB table, so it CANNOT touch real money
//     or pollute live stats / the public board;
//   • it consumes the authoritative round lifecycle (status, multiplier, round
//     id) produced by useGame and settles play-money bets locally with the SAME
//     payout math the server uses (auto-cashout pays at the target; manual pays
//     at the live multiplier; still-active bets lose on crash).
//
// The play-money balance persists per-browser in localStorage and is resettable.
// All settlement runs in idempotent, ref-based effects so React StrictMode's
// double-invocation can never double-credit a win.
// ============================================================================

export const DEMO_STARTING_BALANCE = 10000;
const STORAGE_KEY = 'aviator:demoBalance';
const MIN_BET = 50; // mirrors BettingPanel MIN_BET and the server game.min_bet

const EMPTY: ActiveBets = { 1: null, 2: null };
const SLOTS: readonly BetSlot[] = [1, 2] as const;

function loadBalance(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEMO_STARTING_BALANCE;
  } catch {
    return DEMO_STARTING_BALANCE;
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface Params {
  status: GameStatus;       // authoritative round status from useGame
  multiplier: number;       // current animated multiplier from useGame
  roundId: string | null;   // current round id from useGame
}

export function useDemoBets({ status, multiplier, roundId }: Params) {
  const [balance, setBalance] = useState<number>(loadBalance);
  const [activeBets, setActiveBets] = useState<ActiveBets>(EMPTY);

  // Refs mirror the latest committed values so user actions and settlement
  // effects read fresh data without stale closures.
  const betsRef = useRef<ActiveBets>(activeBets);
  betsRef.current = activeBets;
  const balanceRef = useRef<number>(balance);
  balanceRef.current = balance;
  const multRef = useRef<number>(multiplier);
  multRef.current = multiplier;

  // Persist the play-money balance per browser.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(balance)); } catch { /* ignore */ }
  }, [balance]);

  // New round (waiting) -> clear the board so the next bets can be placed.
  const lastRoundRef = useRef<string | null>(null);
  useEffect(() => {
    if (status === 'waiting' && roundId && roundId !== lastRoundRef.current) {
      lastRoundRef.current = roundId;
      betsRef.current = EMPTY;
      setActiveBets(EMPTY);
    }
  }, [status, roundId]);

  // Auto-cashout during flight: settle at the TARGET (matches the server payout
  // exactly, and is valid because the round is still flying => target < crash).
  useEffect(() => {
    if (status !== 'flying') return;
    const cur = betsRef.current;
    let credit = 0;
    let changed = false;
    const next: ActiveBets = { ...cur };
    for (const slot of SLOTS) {
      const b = cur[slot];
      if (b && b.status === 'active' && b.autoCashout != null && multiplier >= b.autoCashout) {
        const win = Math.floor(b.amount * b.autoCashout * 100) / 100;
        next[slot] = { ...b, status: 'won', cashout_multiplier: b.autoCashout, winnings: win };
        credit += win;
        changed = true;
      }
    }
    if (changed) {
      betsRef.current = next;
      setActiveBets(next);
      setBalance((bal) => bal + credit);
    }
  }, [multiplier, status]);

  // Crash: any bet still active loses.
  useEffect(() => {
    if (status !== 'crashed') return;
    const cur = betsRef.current;
    if (!cur[1] && !cur[2]) return;
    let changed = false;
    const next: ActiveBets = { ...cur };
    for (const slot of SLOTS) {
      const b = cur[slot];
      if (b && b.status === 'active') { next[slot] = { ...b, status: 'lost' }; changed = true; }
    }
    if (changed) { betsRef.current = next; setActiveBets(next); }
  }, [status]);

  // Place a play-money bet on a slot during the waiting window. Throws the same
  // friendly messages real betting uses so the UI behaves identically.
  const placeBet = useCallback(async (amount: number, autoCashoutAt: number | null, slot: BetSlot = 1) => {
    if (status !== 'waiting') throw new Error('Betting is closed for this round.');
    if (autoCashoutAt != null && autoCashoutAt <= 1.0) throw new Error('Auto-cashout must be greater than 1.00x.');
    const amt = Math.floor(amount);
    if (!Number.isFinite(amt) || amt < MIN_BET) throw new Error('Bet amount is outside the allowed limits.');
    if (betsRef.current[slot]) throw new Error('You already have a bet on this slot.');
    if (amt > balanceRef.current) throw new Error('Insufficient balance.');

    const bet: ActiveBet = {
      id: newId(), slot, amount: amt, autoCashout: autoCashoutAt,
      status: 'active', cashout_multiplier: null, winnings: null,
    };
    const next: ActiveBets = { ...betsRef.current, [slot]: bet };
    betsRef.current = next;
    setActiveBets(next);
    setBalance((bal) => bal - amt);
  }, [status]);

  // Manual cashout for a slot at the live multiplier (flight only).
  const cashOut = useCallback(async (slot: BetSlot = 1) => {
    if (status !== 'flying') return;
    const b = betsRef.current[slot];
    if (!b || b.status !== 'active') return;
    const m = multRef.current;
    const win = Math.floor(b.amount * m * 100) / 100;
    const next: ActiveBets = { ...betsRef.current, [slot]: { ...b, status: 'won', cashout_multiplier: m, winnings: win } };
    betsRef.current = next;
    setActiveBets(next);
    setBalance((bal) => bal + win);
  }, [status]);

  // Restore play money to the starting balance (top-up after a bust / practice).
  const reset = useCallback(() => { setBalance(DEMO_STARTING_BALANCE); }, []);

  return { balance, activeBets, placeBet, cashOut, reset };
}
