import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getMultiplierAtTime } from '../lib/gameEngine';
import type { GameStatus, GameRound, Profile } from '../types';

// ============================================================================
// useGame - SERVER-AUTHORITATIVE (Phase 5)
// ----------------------------------------------------------------------------
// The single shared round lives in `game_rounds` and is advanced by the
// server-side driver (game_tick). This hook is a pure CONSUMER:
//   • Subscribes to game_rounds via Realtime for the live round lifecycle.
//   • Animates the multiplier locally from the server's started_at, then SNAPS
//     to the server-revealed crash_multiplier on the 'crashed' event. The crash
//     point is hidden server-side until then (provably fair).
//   • Places bets / cashes out ONLY through the place_bet / cash_out RPCs.
//   • Reads its own bets + the live board from `bets` via Realtime.
// It never writes wallets/bets/transactions/game_rounds directly.
//
// DUAL BET: a player may hold up to TWO independent bets per round, one per
// `slot` (1 or 2). Each betting panel owns one slot. The server enforces the
// per-slot uniqueness (uniq_bet_round_user_slot) and settles each bet
// independently, so the two slots never interfere with one another.
// ============================================================================

const UI_THROTTLE_MS = 66; // ~15fps React updates; canvas reads the ref at 60fps

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

interface LiveBetEntry {
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

  const getMultiplier = useCallback(() => multiplierRef.current, []);

  const toActiveBet = (b: BetRow): ActiveBet => ({
    id: b.id, slot: toSlot(b.slot), amount: Number(b.amount), autoCashout: b.auto_cashout,
    status: b.status, cashout_multiplier: b.cashout_multiplier, winnings: b.winnings,
  });

  // ── Flight animation: multiplier from server started_at; no crash knowledge ──
  const stopRaf = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  const animate = useCallback(() => {
    if (statusRef.current !== 'flying' || startedAtRef.current == null) return;
    const elapsed = Date.now() - startedAtRef.current;
    const m = getMultiplierAtTime(elapsed);
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
      startedAtRef.current = row.started_at ? new Date(row.started_at).getTime() : Date.now();
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
      void onRefreshWallet();
    }
  }, [animate, onRefreshWallet]);

  // ── Initial load: history + whatever round is currently live ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: hist } = await supabase
        .from('game_rounds').select('*').eq('status', 'crashed')
        .order('round_number', { ascending: false }).limit(50);
      if (!cancelled && hist) setHistory(hist as GameRound[]);

      const { data: live } = await supabase
        .from('game_rounds').select('*').in('status', ['waiting', 'flying'])
        .order('round_number', { ascending: false }).limit(1).maybeSingle();
      if (!cancelled && live) applyRound(live as RoundRow);
    })();
    return () => { cancelled = true; stopRaf(); };
  }, [applyRound]);

  // ── Realtime: round lifecycle ──
  useEffect(() => {
    const ch = supabase
      .channel('rt-game-rounds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rounds' },
        (payload) => { if (payload.new) applyRound(payload.new as RoundRow); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [applyRound]);

  // ── Realtime: live board + own bets (both slots), scoped to the current round ──
  const roundId = currentRound?.id ?? null;
  useEffect(() => {
    if (!roundId) return;
    // hydrate existing bets for this round (covers reconnects mid-round)
    (async () => {
      const { data } = await supabase
        .from('bets').select('*').eq('round_id', roundId).order('created_at', { ascending: false });
      if (data) {
        setLiveBets(data.map((b: BetRow) => ({
          id: b.id, username: b.username, avatar_color: b.avatar_color, amount: Number(b.amount),
          cashout_multiplier: b.cashout_multiplier, winnings: b.winnings, status: b.status, is_bot: b.is_bot,
        })));
        const mineRows = data.filter((b: BetRow) => b.user_id && b.user_id === profileRef.current?.id && !b.is_bot);
        if (mineRows.length) {
          setActiveBets((prev) => {
            const next: ActiveBets = { ...prev };
            for (const b of mineRows) next[toSlot(b.slot)] = toActiveBet(b);
            return next;
          });
        }
      }
    })();

    const upsert = (b: BetRow) => {
      const entry: LiveBetEntry = {
        id: b.id, username: b.username, avatar_color: b.avatar_color, amount: Number(b.amount),
        cashout_multiplier: b.cashout_multiplier, winnings: b.winnings, status: b.status, is_bot: b.is_bot,
      };
      setLiveBets((prev) => {
        const i = prev.findIndex((x) => x.id === b.id);
        if (i === -1) return [entry, ...prev];
        const next = prev.slice(); next[i] = entry; return next;
      });
      if (b.user_id && b.user_id === profileRef.current?.id && !b.is_bot) {
        const slot = toSlot(b.slot);
        setActiveBets((prev) => ({ ...prev, [slot]: toActiveBet(b) }));
        if (b.status === 'won') void onRefreshWallet();
      }
    };

    const ch = supabase
      .channel(`rt-bets-${roundId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `round_id=eq.${roundId}` },
        (payload) => { if (payload.new) upsert(payload.new as BetRow); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [roundId, onRefreshWallet]);

  // ── Betting countdown derived from server betting_ends_at ──
  useEffect(() => {
    if (gameStatus !== 'waiting') { setCountdown(0); return; }
    const endsAt = roundRef.current?.betting_ends_at ? new Date(roundRef.current.betting_ends_at).getTime() : null;
    if (!endsAt) return;
    const tick = () => setCountdown(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
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
