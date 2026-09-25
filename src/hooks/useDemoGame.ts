import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStatus, GameRound, BotPlayer } from '../types';
import type { ActiveBet, ActiveBets, BetSlot, LiveBetEntry } from './useGame';
import { getMultiplierAtTime, getTimeAtMultiplier, generateCrashPoint } from '../lib/gameEngine';
import { generateBots } from '../lib/botSimulator';
import {
  DEMO_STARTING_BALANCE,
  DEMO_MANUAL_TARGET,
  cashoutCredit,
  assertValidStake,
  assertValidAutoCashout,
  riggedCrashPoint,
} from './demoEngine';

// ============================================================================
// useDemoGame - SELF-CONTAINED, CLIENT-ONLY, RIGGED FREE-PLAY ENGINE
// ----------------------------------------------------------------------------
// Demo mode runs its OWN round lifecycle (waiting -> flying -> crashed) entirely
// in the browser: own multiplier animation, own simulated bot board, own history
// and a play-money balance persisted per-browser. It NEVER calls an RPC or
// writes any DB table, so it cannot touch real money or pollute live stats.
//
// Why decoupled from the real rounds: a controlled ~80% win rate is impossible
// while riding the real shared crash points (the crash is visible and can't be
// faked). The crash point is therefore generated locally AFTER the betting
// window closes, using riggedCrashPoint() with knowledge of the player's bets,
// so the demo is intentionally favourable to drive conversion to real play.
// Payout amounts still use the exact server math (cashoutCredit) so wins feel
// real. Real mode (useGame) is entirely unaffected.
//
// The engine only runs while `active` (demo selected); otherwise it idles and
// the balance is preserved. The returned surface mirrors useGame so AviatorGame
// can consume real or demo interchangeably.
// ============================================================================

const STORAGE_KEY = 'aviator:demoBalance';
const BETTING_MS = 6000;       // mirrors game.betting_ms
const POST_CRASH_MS = 3000;    // mirrors game.post_crash_ms
const UI_THROTTLE_MS = 80;     // React update cadence; canvas reads the ref at 60fps
const SLOTS: readonly BetSlot[] = [1, 2] as const;
const EMPTY_BETS: ActiveBets = { 1: null, 2: null };

export interface DemoWinEvent { id: string; amount: number; mult: number; at: number; }

interface DemoBot extends BotPlayer { status: 'active' | 'won' | 'lost'; cashedMult: number | null; }

export interface DemoGame {
  active: boolean;
  gameStatus: GameStatus;
  currentMultiplier: number;
  getMultiplier: () => number;
  currentRound: GameRound | null;
  history: GameRound[];
  activeBets: ActiveBets;
  liveBets: LiveBetEntry[];
  countdown: number;
  crashPoint: number;
  placeBet: (amount: number, autoCashoutAt: number | null, slot?: BetSlot) => Promise<void>;
  cashOut: (slot?: BetSlot) => Promise<void>;
  balance: number;
  reset: () => void;
  lastWin: DemoWinEvent | null;
  roundsPlayed: number;
}

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

interface Params { active: boolean; playerName: string; playerColor: string; }

export function useDemoGame({ active, playerName, playerColor }: Params): DemoGame {
  const [gameStatus, setGameStatus] = useState<GameStatus>('idle');
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
  const [currentRound, setCurrentRound] = useState<GameRound | null>(null);
  const [history, setHistory] = useState<GameRound[]>([]);
  const [activeBets, setActiveBets] = useState<ActiveBets>(EMPTY_BETS);
  const [liveBets, setLiveBets] = useState<LiveBetEntry[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [crashPoint, setCrashPoint] = useState(0);
  const [balance, setBalance] = useState<number>(loadBalance);
  const [lastWin, setLastWin] = useState<DemoWinEvent | null>(null);
  const [roundsPlayed, setRoundsPlayed] = useState(0);

  // Engine refs (mutable, read by the RAF loop without stale closures).
  const multRef = useRef(1.0);
  const phaseRef = useRef<'waiting' | 'flying' | 'crashed'>('waiting');
  const phaseStartRef = useRef(0);
  const crashRef = useRef(0);
  const crashAtMsRef = useRef(0);
  const roundRef = useRef<GameRound | null>(null);
  const roundNumRef = useRef(0);
  const botsRef = useRef<DemoBot[]>([]);
  const betsRef = useRef<ActiveBets>(EMPTY_BETS);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const playerBetThisRound = useRef(false);
  const rafRef = useRef(0);
  const lastUiRef = useRef(0);
  const boardDirtyRef = useRef(false);
  const nameRef = useRef(playerName);
  nameRef.current = playerName;
  const colorRef = useRef(playerColor);
  colorRef.current = playerColor;

  // Persist play-money balance per browser.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(balance)); } catch { /* ignore */ }
  }, [balance]);

  const buildLiveBets = useCallback((): LiveBetEntry[] => {
    const out: LiveBetEntry[] = [];
    for (const slot of SLOTS) {
      const b = betsRef.current[slot];
      if (b) out.push({
        id: b.id, username: nameRef.current, avatar_color: colorRef.current,
        amount: b.amount, cashout_multiplier: b.cashout_multiplier,
        winnings: b.winnings, status: b.status, is_bot: false,
      });
    }
    for (const bot of botsRef.current) {
      out.push({
        id: bot.id, username: bot.username, avatar_color: bot.avatar_color,
        amount: bot.betAmount, cashout_multiplier: bot.cashedMult,
        winnings: bot.cashedMult != null ? cashoutCredit(bot.betAmount, bot.cashedMult) : null,
        status: bot.status, is_bot: true,
      });
    }
    return out;
  }, []);

  // Open a fresh waiting round (also called on activation).
  const openRound = useCallback((now: number) => {
    roundNumRef.current += 1;
    const round: GameRound = {
      id: newId(), round_number: roundNumRef.current, crash_multiplier: 0,
      status: 'waiting', started_at: null, crashed_at: null, created_at: new Date().toISOString(),
    };
    roundRef.current = round;
    botsRef.current = (generateBots(Number.POSITIVE_INFINITY) as BotPlayer[])
      .map((b) => ({ ...b, status: 'active' as const, cashedMult: null }));
    betsRef.current = EMPTY_BETS;
    phaseRef.current = 'waiting';
    phaseStartRef.current = now;
    crashRef.current = 0;
    crashAtMsRef.current = 0;
    multRef.current = 1.0;
    playerBetThisRound.current = false;
    setCurrentRound(round);
    setGameStatus('waiting');
    setActiveBets(EMPTY_BETS);
    setCurrentMultiplier(1.0);
    setCrashPoint(0);
    setCountdown(Math.ceil(BETTING_MS / 1000));
    setLiveBets(buildLiveBets());
  }, [buildLiveBets]);

  // waiting -> flying: generate the rigged crash point from the player's target.
  const startFlying = useCallback((now: number) => {
    const targets: number[] = [];
    for (const slot of SLOTS) {
      const b = betsRef.current[slot];
      if (b && b.status === 'active') targets.push(b.autoCashout ?? DEMO_MANUAL_TARGET);
    }
    const crash = targets.length ? riggedCrashPoint(Math.max(...targets)) : generateCrashPoint();
    crashRef.current = crash;
    crashAtMsRef.current = getTimeAtMultiplier(crash);
    phaseRef.current = 'flying';
    phaseStartRef.current = now;
    const round = roundRef.current
      ? { ...roundRef.current, status: 'flying' as const, started_at: new Date().toISOString() }
      : null;
    roundRef.current = round;
    setCurrentRound(round);
    setGameStatus('flying');
  }, []);

  // Settle a player win: credit balance, update bet, signal the conversion nudge.
  const settleWin = useCallback((slot: BetSlot, mult: number) => {
    const b = betsRef.current[slot];
    if (!b || b.status !== 'active') return;
    const win = cashoutCredit(b.amount, mult);
    const updated: ActiveBet = { ...b, status: 'won', cashout_multiplier: mult, winnings: win };
    betsRef.current = { ...betsRef.current, [slot]: updated };
    setActiveBets(betsRef.current);
    setBalance((bal) => bal + win);
    setLastWin({ id: updated.id, amount: win, mult, at: Date.now() });
  }, []);

  const crashRound = useCallback((now: number) => {
    const crash = crashRef.current;
    for (const bot of botsRef.current) if (bot.status === 'active') bot.status = 'lost';
    const nextBets: ActiveBets = { ...betsRef.current };
    for (const slot of SLOTS) {
      const b = nextBets[slot];
      if (b && b.status === 'active') nextBets[slot] = { ...b, status: 'lost' };
    }
    betsRef.current = nextBets;
    phaseRef.current = 'crashed';
    phaseStartRef.current = now;
    multRef.current = crash;
    const round = roundRef.current
      ? { ...roundRef.current, status: 'crashed' as const, crash_multiplier: crash, crashed_at: new Date().toISOString() }
      : null;
    roundRef.current = round;
    setGameStatus('crashed');
    setCurrentMultiplier(crash);
    setCrashPoint(crash);
    setActiveBets(nextBets);
    if (round) { setCurrentRound(round); setHistory((h) => [round, ...h].slice(0, 50)); }
    if (playerBetThisRound.current) setRoundsPlayed((n) => n + 1);
    setLiveBets(buildLiveBets());
  }, [buildLiveBets]);

  // Main RAF loop - runs only while demo is active.
  useEffect(() => {
    if (!active) return;
    openRound(Date.now());
    const loop = () => {
      const now = Date.now();
      const phase = phaseRef.current;

      if (phase === 'waiting') {
        const remaining = BETTING_MS - (now - phaseStartRef.current);
        const cd = Math.max(0, Math.ceil(remaining / 1000));
        setCountdown((prev) => (prev === cd ? prev : cd));
        if (remaining <= 0) startFlying(now);
      } else if (phase === 'flying') {
        const elapsed = now - phaseStartRef.current;
        const m = getMultiplierAtTime(elapsed);
        multRef.current = m;
        let changed = false;
        for (const slot of SLOTS) {
          const b = betsRef.current[slot];
          if (b && b.status === 'active' && b.autoCashout != null
              && m >= b.autoCashout && b.autoCashout < crashRef.current) {
            settleWin(slot, b.autoCashout);
            changed = true;
          }
        }
        for (const bot of botsRef.current) {
          if (bot.status === 'active' && bot.cashoutAt != null
              && m >= bot.cashoutAt && bot.cashoutAt < crashRef.current) {
            bot.status = 'won'; bot.cashedMult = bot.cashoutAt; changed = true;
          }
        }
        if (changed) boardDirtyRef.current = true;
        if (elapsed >= crashAtMsRef.current || m >= crashRef.current) {
          crashRound(now);
        } else if (boardDirtyRef.current && now - lastUiRef.current >= UI_THROTTLE_MS) {
          // Only the bets board re-renders (and only when a bot cashed out); the multiplier is
          // read from the ref by whoever shows it, never pushed through React state per frame.
          lastUiRef.current = now;
          boardDirtyRef.current = false;
          setLiveBets(buildLiveBets());
        }
      } else { // crashed
        if (now - phaseStartRef.current >= POST_CRASH_MS) openRound(now);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [active, openRound, startFlying, crashRound, settleWin, buildLiveBets]);

  const placeBet = useCallback(async (amount: number, autoCashoutAt: number | null, slot: BetSlot = 1) => {
    if (phaseRef.current !== 'waiting') throw new Error('Betting is closed for this round.');
    assertValidAutoCashout(autoCashoutAt);
    const amt = Math.floor(amount);
    if (betsRef.current[slot]) throw new Error('You already have a bet on this slot.');
    assertValidStake(amt, balanceRef.current);
    const bet: ActiveBet = {
      id: newId(), slot, amount: amt, autoCashout: autoCashoutAt,
      status: 'active', cashout_multiplier: null, winnings: null,
    };
    betsRef.current = { ...betsRef.current, [slot]: bet };
    playerBetThisRound.current = true;
    setActiveBets(betsRef.current);
    setBalance((bal) => bal - amt);
    setLiveBets(buildLiveBets());
  }, [buildLiveBets]);

  const cashOut = useCallback(async (slot: BetSlot = 1) => {
    if (phaseRef.current !== 'flying') return;
    const b = betsRef.current[slot];
    if (!b || b.status !== 'active') return;
    settleWin(slot, multRef.current);
    setLiveBets(buildLiveBets());
  }, [settleWin, buildLiveBets]);

  const reset = useCallback(() => setBalance(DEMO_STARTING_BALANCE), []);
  const getMultiplier = useCallback(() => multRef.current, []);

  return {
    active, gameStatus, currentMultiplier, getMultiplier, currentRound, history,
    activeBets, liveBets, countdown, crashPoint, placeBet, cashOut, balance,
    reset, lastWin, roundsPlayed,
  };
}
