import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { generateCrashPoint, getMultiplierAtTime } from '../lib/gameEngine';
import { generateBots } from '../lib/botSimulator';
import type { GameStatus, GameRound, BotPlayer, Profile } from '../types';

const WAITING_DURATION = 5000;
const POST_CRASH_DURATION = 3000;

interface ActiveBet {
  id: string;
  amount: number;
  cashoutAt: number | null;
  cashedOut: boolean;
  winnings: number | null;
  cashout_multiplier?: number;
}

interface QueuedBet {
  amount: number;
  autoCashoutAt: number | null;
}

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

export function useGame(profile: Profile | null, walletBalance: number, onRefreshWallet: () => Promise<void>) {
  const [gameStatus, setGameStatus] = useState<GameStatus>('idle');
  const multiplierRef = useRef(1.0);
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);

  const [currentRound, setCurrentRound] = useState<GameRound | null>(null);
  const [history, setHistory] = useState<GameRound[]>([]);
  const [activeBet, setActiveBet] = useState<ActiveBet | null>(null);
  const [liveBets, setLiveBets] = useState<LiveBetEntry[]>([]);
  const [countdown, setCountdown] = useState(5);
  const [crashPoint, setCrashPoint] = useState<number>(2);
  const [bots, setBots] = useState<BotPlayer[]>([]);
  const [queuedBet, setQueuedBet] = useState<QueuedBet | null>(null);
  const [nextRoundNotification, setNextRoundNotification] = useState<string | null>(null);

  const rafRef = useRef<number>(0);
  const gameStatusRef = useRef<GameStatus>('idle');
  const flyingStartRef = useRef<number | null>(null);
  const crashPointRef = useRef<number>(2);
  const activeBetRef = useRef<ActiveBet | null>(null);
  const botsRef = useRef<BotPlayer[]>([]);
  const liveBetsRef = useRef<LiveBetEntry[]>([]);
  const lastUiUpdateRef = useRef<number>(0);
  const queuedBetRef = useRef<QueuedBet | null>(null);

  gameStatusRef.current = gameStatus;
  crashPointRef.current = crashPoint;
  activeBetRef.current = activeBet;
  botsRef.current = bots;
  liveBetsRef.current = liveBets;
  queuedBetRef.current = queuedBet;

  const getMultiplier = useCallback(() => multiplierRef.current, []);

  // Load history on mount
  useEffect(() => {
    supabase
      .from('game_rounds')
      .select('*')
      .eq('status', 'crashed')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setHistory(data as GameRound[]);
      });
  }, []);

  // Clear notification after 3 seconds
  useEffect(() => {
    if (nextRoundNotification) {
      const timer = setTimeout(() => setNextRoundNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [nextRoundNotification]);

  const startWaiting = useCallback(() => {
    const cp = generateCrashPoint();
    const newBots = generateBots(cp);
    setCrashPoint(cp);
    crashPointRef.current = cp;
    setBots(newBots);
    botsRef.current = newBots;

    const botEntries: LiveBetEntry[] = newBots.map(bot => ({
      id: bot.id,
      username: bot.username,
      avatar_color: bot.avatar_color,
      amount: bot.betAmount,
      cashout_multiplier: null,
      winnings: null,
      status: 'active',
      is_bot: true,
    }));

    setLiveBets(botEntries);
    liveBetsRef.current = botEntries;

    multiplierRef.current = 1.0;
    setCurrentMultiplier(1.0);

    const end = Date.now() + WAITING_DURATION;
    setCountdown(5);
    setGameStatus('waiting');
    gameStatusRef.current = 'waiting';

    // Auto-place queued bet from previous round
    const queued = queuedBetRef.current;
    if (queued && profile) {
      setQueuedBet(null);
      queuedBetRef.current = null;
      // Place the queued bet after a short delay to ensure state is ready
      setTimeout(() => {
        placeQueuedBetNow(queued.amount, queued.autoCashoutAt);
      }, 300);
    }

    const tick = () => {
      const remaining = Math.ceil((end - Date.now()) / 1000);
      if (remaining > 0) {
        setCountdown(remaining);
        setTimeout(tick, 200);
      } else {
        startFlying();
      }
    };
    setTimeout(tick, 200);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const placeQueuedBetNow = useCallback(async (amount: number, autoCashoutAt: number | null) => {
    if (!profile) return;
    if (activeBetRef.current) return;

    const { data: walletData } = await supabase
      .from('wallets').select('balance').eq('user_id', profile.id).maybeSingle();
    if (!walletData || Number(walletData.balance) < amount) return;

    await supabase.from('wallets').update({
      balance: Number(walletData.balance) - amount,
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.id);

    const { data: betData } = await supabase
      .from('bets')
      .insert({
        round_id: currentRound?.id ?? '00000000-0000-0000-0000-000000000000',
        user_id: profile.id,
        username: profile.username,
        avatar_color: profile.avatar_color,
        amount,
        status: 'active',
        is_bot: false,
      })
      .select()
      .maybeSingle();

    const newBet: ActiveBet = {
      id: betData?.id ?? `bet-${Date.now()}`,
      amount,
      cashoutAt: autoCashoutAt,
      cashedOut: false,
      winnings: null,
    };

    setActiveBet(newBet);
    activeBetRef.current = newBet;

    setLiveBets(prev => [{
      id: newBet.id,
      username: profile.username,
      avatar_color: profile.avatar_color,
      amount,
      cashout_multiplier: null,
      winnings: null,
      status: 'active',
      is_bot: false,
    }, ...prev]);

    await onRefreshWallet();
  }, [profile, currentRound, onRefreshWallet]);

  const startFlying = useCallback(async () => {
    const now = Date.now();
    flyingStartRef.current = now;
    multiplierRef.current = 1.0;
    setCurrentMultiplier(1.0);
    setGameStatus('flying');
    gameStatusRef.current = 'flying';

    supabase
      .from('game_rounds')
      .insert({
        crash_multiplier: crashPointRef.current,
        status: 'flying',
        started_at: new Date(now).toISOString(),
      })
      .select()
      .maybeSingle()
      .then(({ data: round }) => {
        if (!round) return;
        setCurrentRound(round as GameRound);
        const botBetInserts = botsRef.current.map(bot => ({
          round_id: round.id,
          username: bot.username,
          avatar_color: bot.avatar_color,
          amount: bot.betAmount,
          status: 'active',
          is_bot: true,
        }));
        if (botBetInserts.length > 0) {
          supabase.from('bets').insert(botBetInserts);
        }
      });

    botsRef.current = botsRef.current.map(b => ({ ...b, hasBet: true }));
    setBots(botsRef.current);

    const animate = () => {
      if (gameStatusRef.current !== 'flying') return;
      const elapsed = Date.now() - (flyingStartRef.current ?? Date.now());
      const mult = getMultiplierAtTime(elapsed);
      multiplierRef.current = mult;

      const now2 = Date.now();
      if (now2 - lastUiUpdateRef.current >= 66) {
        lastUiUpdateRef.current = now2;
        setCurrentMultiplier(mult);

        let anyNewCashout = false;
        const updatedBots = botsRef.current.map(bot => {
          if (!bot.hasBet || bot.hasCashedOut) return bot;
          if (bot.cashoutAt !== null && mult >= bot.cashoutAt) {
            anyNewCashout = true;
            return { ...bot, hasCashedOut: true };
          }
          return bot;
        });

        if (anyNewCashout) {
          botsRef.current = updatedBots;
          setBots(updatedBots);
          setLiveBets(prev => prev.map(b => {
            const bot = updatedBots.find(bt => bt.id === b.id && bt.hasCashedOut && b.status === 'active');
            if (!bot) return b;
            return {
              ...b,
              cashout_multiplier: bot.cashoutAt,
              winnings: Math.floor(bot.betAmount * (bot.cashoutAt ?? 1) * 100) / 100,
              status: 'won',
            };
          }));
        }
      }

      const ab = activeBetRef.current;
      if (ab && !ab.cashedOut && ab.cashoutAt !== null && mult >= ab.cashoutAt) {
        performCashout(mult);
        return;
      }

      if (mult >= crashPointRef.current) {
        handleCrash(crashPointRef.current);
        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCrash = useCallback(async (finalMultiplier: number) => {
    cancelAnimationFrame(rafRef.current);
    multiplierRef.current = finalMultiplier;
    setGameStatus('crashed');
    gameStatusRef.current = 'crashed';
    setCurrentMultiplier(finalMultiplier);

    setLiveBets(prev => prev.map(b =>
      b.status === 'active' ? { ...b, status: 'lost' } : b
    ));

    const ab = activeBetRef.current;
    if (ab && !ab.cashedOut && profile) {
      await supabase.from('bets').update({ status: 'lost' }).eq('id', ab.id);
      await supabase.from('transactions').insert({
        user_id: profile.id,
        type: 'bet',
        amount: -ab.amount,
        description: `Lost - crashed at ${finalMultiplier.toFixed(2)}x`,
        status: 'completed',
      });
    }
    setActiveBet(null);
    activeBetRef.current = null;

    if (currentRound) {
      supabase.from('game_rounds').update({
        status: 'crashed',
        crashed_at: new Date().toISOString(),
      }).eq('id', currentRound.id);
    }

    setHistory(prev => [
      { id: currentRound?.id ?? '', round_number: null, crash_multiplier: finalMultiplier, status: 'crashed', started_at: null, crashed_at: null, created_at: new Date().toISOString() },
      ...prev.slice(0, 49),
    ]);

    setTimeout(() => startWaiting(), POST_CRASH_DURATION);
  }, [currentRound, profile, startWaiting]);

  const performCashout = useCallback(async (mult: number) => {
    const ab = activeBetRef.current;
    if (!ab || ab.cashedOut || !profile) return;
    const winnings = Math.floor(ab.amount * mult * 100) / 100;
    const updatedBet: ActiveBet = { ...ab, cashedOut: true, cashout_multiplier: mult, winnings };
    setActiveBet(updatedBet);
    activeBetRef.current = updatedBet;

    setLiveBets(prev => prev.map(b =>
      b.id === ab.id
        ? { ...b, cashout_multiplier: mult, winnings, status: 'won' }
        : b
    ));

    await supabase.from('bets').update({ cashout_multiplier: mult, winnings, status: 'won' }).eq('id', ab.id);

    const { data: walletData } = await supabase
      .from('wallets').select('balance').eq('user_id', profile.id).maybeSingle();
    if (walletData) {
      await supabase.from('wallets').update({
        balance: Number(walletData.balance) + winnings,
        updated_at: new Date().toISOString(),
      }).eq('user_id', profile.id);
    }

    await supabase.from('transactions').insert({
      user_id: profile.id,
      type: 'win',
      amount: winnings,
      description: `Cashed out at ${mult.toFixed(2)}x`,
      status: 'completed',
    });

    await onRefreshWallet();
  }, [profile, onRefreshWallet]);

  const cashOut = useCallback(() => {
    if (gameStatusRef.current !== 'flying') return;
    performCashout(multiplierRef.current);
  }, [performCashout]);

  const placeBet = useCallback(async (amount: number, autoCashoutAt: number | null) => {
    if (!profile) return;
    if (activeBetRef.current) return;

    // Allow betting during flying or crashed — queue for next round
    if (gameStatusRef.current === 'flying' || gameStatusRef.current === 'crashed') {
      // Validate balance
      if (walletBalance < amount) throw new Error('Insufficient balance');
      setQueuedBet({ amount, autoCashoutAt });
      queuedBetRef.current = { amount, autoCashoutAt };
      setNextRoundNotification(`Placed bet of KSh ${amount.toLocaleString('en-KE')} for next round ✈️`);
      return;
    }

    if (gameStatusRef.current !== 'waiting') return;
    if (walletBalance < amount) throw new Error('Insufficient balance');

    const { data: walletData } = await supabase
      .from('wallets').select('balance').eq('user_id', profile.id).maybeSingle();
    if (!walletData || Number(walletData.balance) < amount) throw new Error('Insufficient balance');

    await supabase.from('wallets').update({
      balance: Number(walletData.balance) - amount,
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.id);

    const { data: betData } = await supabase
      .from('bets')
      .insert({
        round_id: currentRound?.id ?? '00000000-0000-0000-0000-000000000000',
        user_id: profile.id,
        username: profile.username,
        avatar_color: profile.avatar_color,
        amount,
        status: 'active',
        is_bot: false,
      })
      .select()
      .maybeSingle();

    const newBet: ActiveBet = {
      id: betData?.id ?? `bet-${Date.now()}`,
      amount,
      cashoutAt: autoCashoutAt,
      cashedOut: false,
      winnings: null,
    };

    setActiveBet(newBet);
    activeBetRef.current = newBet;

    setLiveBets(prev => [{
      id: newBet.id,
      username: profile.username,
      avatar_color: profile.avatar_color,
      amount,
      cashout_multiplier: null,
      winnings: null,
      status: 'active',
      is_bot: false,
    }, ...prev]);

    await onRefreshWallet();
  }, [profile, walletBalance, currentRound, onRefreshWallet]);

  const cancelQueuedBet = useCallback(() => {
    setQueuedBet(null);
    queuedBetRef.current = null;
    setNextRoundNotification(null);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => startWaiting(), 500);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    gameStatus,
    currentMultiplier,
    getMultiplier,
    currentRound,
    history,
    activeBet,
    liveBets,
    countdown,
    crashPoint,
    placeBet,
    cashOut,
    queuedBet,
    cancelQueuedBet,
    nextRoundNotification,
  };
}
