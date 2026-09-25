import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getMultiplierAtTime } from '../lib/gameEngine';
import { serverNow, setServerOffset, syncClock } from '../lib/serverClock';
import type { GameStatus, GameRound, Profile } from '../types';

// ============================================================================
// useGame - SERVER-AUTHORITATIVE
// ----------------------------------------------------------------------------
// The single shared round lives in `game_rounds` and is advanced by the
// server-side driver (game_drive → game_tick). This hook is a pure CONSUMER:
//   • ONE Realtime channel for the whole session: the public broadcast topic
//     "game" carries `round` events (new round / take-off / crash) and `bet`
//     events (real players only). Payloads are built by the database and never
//     contain the crash time, crash point or seed before the crash.
//   • Animates the multiplier from the server's started_at using the SERVER
//     clock (NTP-style offset from server_time()), then snaps to the revealed
//     crash_multiplier on the crash event.
//   • Reads state over REST only on first load and after a reconnect.
//   • Places bets / cashes out ONLY through the place_bet / cash_out RPCs.
// It never writes wallets/bets/transactions/game_rounds directly.
//
// DUAL BET: a player may hold up to TWO independent bets per round, one per
// `slot` (1 or 2). Each betting panel owns one slot. The server enforces the
// per-slot uniqueness (uniq_bet_round_user_slot) and settles each bet
// independently, so the two slots never interfere with one another.
// ============================================================================

const UI_THROTTLE_MS = 66; // ~15fps React updates; canvas reads the ref at 60fps
const CLOCK_RESYNC_MS = 5 * 60_000;
// Public columns only (the crash instant and override flags are not readable by clients).
const ROUND_COLS = 'id, round_number, crash_multiplier, status, started_at, crashed_at, created_at, betting_ends_at, seed_hash, server_seed';
const BET_COLS = 'id, round_id, user_id, username, avatar_color, amount, auto_cashout, cashout_multiplier, winnings, status, is_bot, slot';

export type BetSlot = 1 | 2;
export const BET_SLOTS: readonly BetSlot[] = [1, 2] as const;

// game_rounds carries provably-fair columns beyond the base GameRound type.
type RoundRow = GameRound & {
  betting_ends_at: string | null;
  seed_hash: string | null;
  server_seed: string | null;
};

export interface ActiveBet {
  id: string;
  slot: BetSlot;
  amount: number;
  autoCashout: number | null;
  status: 'active' | 'won' | 'lost';
  cashout_multiplier: number | null;
  winnings: number | null;
}

// Both slots' own-bet state for the signed-in player. null = no bet this round.
export type ActiveBets = Record<BetSlot, ActiveBet | null>;
const EMPTY_ACTIVE_BETS: ActiveBets = { 1: null, 2: null };

// Exported so the demo engine (useDemoGame) can produce the identical board
// shape, letting AviatorGame consume real or demo through one union with no casts.
export interface LiveBetEntry {
  id: string;
  username: string;
  avatar_color: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: 'active' | 'won' | 'lost';
  is_bot: boolean;
}

// Row shape from the `bets` table (only the columns this hook reads). The
// realtime payload and the hydrate query both conform to this subset.
type BetRow = {
  id: string;
  round_id?: string;
  user_id: string | null;
  username: string;
  avatar_color: string;
  amount: number;
  auto_cashout: number | null;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: 'active' | 'won' | 'lost';
  is_bot: boolean;
  slot: number | null;
};

// Coerce a DB slot value to the 1|2 domain; anything unexpected defaults to 1
// (matches the bets.slot column default and the CHECK constraint).
const toSlot = (v: number | null | undefined): BetSlot => (Number(v) === 2 ? 2 : 1);

function friendlyError(message: string): string {
  const map: Record<string, string> = {
    AUTH_REQUIRED: 'Please sign in to bet.',
    OPERATORS_CANNOT_BET: 'Operator accounts cannot place bets.',
    OPERATORS_CANNOT_PLAY: 'Operator accounts cannot place bets.',
    STAFF_CANNOT_PLAY: 'Operator accounts cannot place bets.',
    BETTING_CLOSED: 'Betting is closed for this round.',
    ROUND_NOT_FOUND: 'Round not found - please wait for the next one.',
    ALREADY_BET: 'You already have a bet on this slot.',
    INSUFFICIENT_BALANCE: 'Insufficient balance.',
    BET_OUT_OF_RANGE: 'Bet amount is outside the allowed limits.',
    INVALID_SLOT: 'Invalid bet slot.',
    NO_WALLET: 'Wallet error. Please refresh.',
    NO_PROFILE: 'Profile error. Please refresh.',
    INVALID_AUTO_CASHOUT: 'Auto-cashout must be greater than 1.00x.',
    NO_ACTIVE_BET: 'No active bet to cash out.',
    ROUND_NOT_FLYING: 'Round is not in flight.',
    ROUND_CRASHED: 'Too late - the round already crashed.',
    BET_NOT_ACTIVE: 'This bet is no longer active.',
  };
  for (const key of Object.keys(map)) if (message.includes(key)) return map[key];
  return 'Something went wrong. Please try again.';
}

export function useGame(profile: Profile | null, _walletBalance: number, onRefreshWallet: () => Promise<void>) {
  const [gameStatus, setGameStatus] = useState<GameStatus>('idle');
  const multiplierRef = useRef(1.0);
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);

  const [currentRound, setCurrentRound] = useState<GameRound | null>(null);
  const [history, setHistory] = useState<GameRound[]>([]);
  const [activeBets, setActiveBets] = useState<ActiveBets>(EMPTY_ACTIVE_BETS);
  const [liveBets, setLiveBets] = useState<LiveBetEntry[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [crashPoint, setCrashPoint] = useState<number>(0);

  const rafRef = useRef<number>(0);
  const statusRef = useRef<GameStatus>('idle');
  const roundRef = useRef<RoundRow | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastUiRef = useRef<number>(0);
  const profileRef = useRef<Profile | null>(profile);
  profileRef.current = profile;
  // Latest wallet refresher, read through a ref so the realtime channel never has to be
  // torn down and re-joined when the parent re-creates the callback (that cost a resync
  // and risked missing events every round).
  const refreshRef = useRef(onRefreshWallet);
  refreshRef.current = onRefreshWallet;

  const getMultiplier = useCallback(() => multiplierRef.current, []);

  const toActiveBet = (b: BetRow): ActiveBet => ({
    id: b.id, slot: toSlot(b.slot), amount: Number(b.amount), autoCashout: b.auto_cashout,
    status: b.status, cashout_multiplier: b.cashout_multiplier, winnings: b.winnings,
  });

  // ── Flight animation: multiplier from server started_at; no crash knowledge ──
  const stopRaf = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  const animate = useCallback(() => {
    if (statusRef.current !== 'flying' || startedAtRef.current == null) return;
    // Server clock, so every player sees the multiplier the server will pay.
    const m = getMultiplierAtTime(serverNow() - startedAtRef.current);
    multiplierRef.current = m;
    const now = Date.now();
    if (now - lastUiRef.current >= UI_THROTTLE_MS) {
      lastUiRef.current = now;
      setCurrentMultiplier(m);
    }
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  // ── Apply a round row from initial load or Realtime ──
  const applyRound = useCallback((row: RoundRow) => {
    const prev = roundRef.current;
    // Ignore stale rows (older round arriving out of order).
    if (prev && row.round_number != null && prev.round_number != null &&
        row.round_number < prev.round_number) return;

    const statusChanged = !prev || prev.id !== row.id || prev.status !== row.status;
    roundRef.current = row;
    setCurrentRound(row as GameRound);

    if (!statusChanged) return;

    if (row.status === 'waiting') {
      stopRaf();
      startedAtRef.current = null;
      multiplierRef.current = 1.0;
      setCurrentMultiplier(1.0);
      setCrashPoint(0);
      setActiveBets(EMPTY_ACTIVE_BETS);
      setLiveBets([]); // fresh board for the new round; bets stream in via Realtime
      statusRef.current = 'waiting';
      setGameStatus('waiting');
    } else if (row.status === 'flying') {
      startedAtRef.current = row.started_at ? new Date(row.started_at).getTime() : serverNow();
      statusRef.current = 'flying';
      setGameStatus('flying');
      stopRaf();
      rafRef.current = requestAnimationFrame(animate);
    } else if (row.status === 'crashed') {
      stopRaf();
      const cp = Number(row.crash_multiplier ?? multiplierRef.current);
      multiplierRef.current = cp;
      setCurrentMultiplier(cp);
      setCrashPoint(cp);
      statusRef.current = 'crashed';
      setGameStatus('crashed');
      // finalize the board: anyone still active lost
      setLiveBets((prevBets) => prevBets.map((b) => (b.status === 'active' ? { ...b, status: 'lost' } : b)));
      setActiveBets((prev) => ({
        1: prev[1] && prev[1].status === 'active' ? { ...prev[1], status: 'lost' } : prev[1],
        2: prev[2] && prev[2].status === 'active' ? { ...prev[2], status: 'lost' } : prev[2],
      }));
      // prepend to history
      setHistory((h) => [row as GameRound, ...h.filter((x) => x.id !== row.id)].slice(0, 50));
      // server may have auto-cashed us - reconcile wallet
      void refreshRef.current();
    }
  }, [animate]);

  // ── Live board helpers ──
  const toEntry = (b: BetRow): LiveBetEntry => ({
    id: b.id, username: b.username, avatar_color: b.avatar_color, amount: Number(b.amount),
    cashout_multiplier: b.cashout_multiplier, winnings: b.winnings, status: b.status, is_bot: b.is_bot,
  });
  const upsertBet = useCallback((b: BetRow) => {
    const entry = toEntry(b);
    setLiveBets((prev) => {
      const i = prev.findIndex((x) => x.id === b.id);
      if (i === -1) return [entry, ...prev];
      const next = prev.slice(); next[i] = entry; return next;
    });
    if (b.user_id && b.user_id === profileRef.current?.id && !b.is_bot) {
      const slot = toSlot(b.slot);
      setActiveBets((prev) => ({ ...prev, [slot]: toActiveBet(b) }));
      if (b.status === 'won') void refreshRef.current();
    }
  }, []);

  // Full state over REST: on first load and after every (re)subscribe, so nothing is missed
  // while the socket was down. Between those, broadcast events are the only traffic.
  const resync = useCallback(async () => {
    const [{ data: hist }, { data: live }] = await Promise.all([
      supabase.from('game_rounds').select(ROUND_COLS).eq('status', 'crashed')
        .order('round_number', { ascending: false }).limit(50),
      supabase.from('game_rounds').select(ROUND_COLS).in('status', ['waiting', 'flying'])
        .order('round_number', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (hist) setHistory(hist as unknown as GameRound[]);
    if (live) {
      applyRound(live as unknown as RoundRow);
      const { data: bets } = await supabase.from('bets').select(BET_COLS)
        .eq('round_id', (live as { id: string }).id).order('created_at', { ascending: false });
      if (bets) {
        setLiveBets((bets as unknown as BetRow[]).map(toEntry));
        const mine = (bets as unknown as BetRow[]).filter((b) => b.user_id && b.user_id === profileRef.current?.id && !b.is_bot);
        if (mine.length) {
          setActiveBets((prev) => {
            const next: ActiveBets = { ...prev };
            for (const b of mine) next[toSlot(b.slot)] = toActiveBet(b);
            return next;
          });
        }
      }
    }
  }, [applyRound]);

  // ── Server clock (NTP-style), refreshed every few minutes ──
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const r = await syncClock(async () => {
        const { data, error } = await supabase.rpc('server_time');
        if (error) throw error;
        return Number(data);
      });
      if (!cancelled && r) setServerOffset(r.offset);
    };
    void run();
    const t = setInterval(() => { void run(); }, CLOCK_RESYNC_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ── One realtime channel for the session: round + bet broadcasts ──
  useEffect(() => {
    const ch = supabase
      .channel('game')
      .on('broadcast', { event: 'round' }, ({ payload }) => { if (payload?.id) applyRound(payload as RoundRow); })
      .on('broadcast', { event: 'bet' }, ({ payload }) => {
        const b = payload as BetRow;
        if (b?.id && b.round_id && b.round_id === roundRef.current?.id) upsertBet(b);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void resync(); });
    return () => { stopRaf(); void supabase.removeChannel(ch); };
  }, [applyRound, upsertBet, resync]);

  // ── Betting countdown derived from server betting_ends_at ──
  useEffect(() => {
    if (gameStatus !== 'waiting') { setCountdown(0); return; }
    const endsAt = roundRef.current?.betting_ends_at ? new Date(roundRef.current.betting_ends_at).getTime() : null;
    if (!endsAt) return;
    const tick = () => setCountdown(Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [gameStatus, currentRound?.id]);

  // ── Actions (RPC only) ──
  // placeBet/cashOut are slot-aware. slot defaults to 1 so existing single-panel
  // call sites keep working; the second panel passes slot=2.
  const placeBet = useCallback(async (amount: number, autoCashoutAt: number | null, slot: BetSlot = 1) => {
    if (!profile) throw new Error('Please sign in to bet.');
    const round = roundRef.current;
    if (!round || round.status !== 'waiting') throw new Error('Betting is closed for this round.');
    const { error } = await supabase.rpc('place_bet', {
      p_round_id: round.id, p_amount: amount, p_auto_cashout: autoCashoutAt, p_slot: slot,
    });
    if (error) throw new Error(friendlyError(error.message));
    await onRefreshWallet(); // bet row + active state arrive via Realtime
  }, [profile, onRefreshWallet]);

  const cashOut = useCallback(async (slot: BetSlot = 1) => {
    const round = roundRef.current;
    if (!round || round.status !== 'flying') return;
    const { error } = await supabase.rpc('cash_out', { p_round_id: round.id, p_slot: slot });
    if (error) throw new Error(friendlyError(error.message));
    await onRefreshWallet();
  }, [onRefreshWallet]);

  return {
    gameStatus,
    currentMultiplier,
    getMultiplier,
    currentRound,
    history,
    activeBets,
    liveBets,
    countdown,
    crashPoint,
    placeBet,
    cashOut,
  };
}
