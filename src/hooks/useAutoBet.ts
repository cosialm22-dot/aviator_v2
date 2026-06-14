import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStatus } from '../types';
import type { ActiveBet } from './useGame';

// ============================================================================
// useAutoBet - client-side auto-bet sequencer for one betting panel.
// ----------------------------------------------------------------------------
// Repeats a fixed-stake bet for N rounds, each with the panel's auto-cashout
// target (settled server-side by _settle_flight), and halts on:
//   * rounds exhausted,
//   * cumulative net loss <= -stopLoss   (stopLoss > 0),
//   * cumulative net profit >= stopWin   (stopWin > 0),
//   * insufficient balance for the next stake.
//
// No server changes: every round is a normal place_bet; the server remains the
// sole authority for settlement. This hook only ORCHESTRATES placement and
// tallies results from the authoritative activeBet stream (won/lost), so it can
// never invent money or settle a bet itself.
//
// Correctness relies on the round lifecycle (see useGame.applyRound): activeBet
// is null on each new 'waiting' round and becomes terminal (won/lost) exactly
// once per bet. Counters live in refs to avoid stale-closure bugs in effects.
// ============================================================================

export interface AutoBetConfig { rounds: number; stopLoss: number; stopWin: number }
export interface AutoBetStats { played: number; remaining: number; net: number }

interface Params {
  status: GameStatus;
  activeBet: ActiveBet | null;
  balance: number;
  isOperator: boolean;
  placeBet: (amount: number, autoCashoutAt: number | null) => Promise<void>;
}

const DEFAULT_CONFIG: AutoBetConfig = { rounds: 10, stopLoss: 0, stopWin: 0 };

export function useAutoBet({ status, activeBet, balance, isOperator, placeBet }: Params) {
  const [config, setConfig] = useState<AutoBetConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<AutoBetStats>({ played: 0, remaining: 0, net: 0 });

  // Immutable run snapshot (taken at start) + mutable counters.
  const run = useRef<{ stake: number; auto: number | null; cfg: AutoBetConfig } | null>(null);
  const remainingRef = useRef(0);
  const netRef = useRef(0);
  const playedRef = useRef(0);
  const countedId = useRef<string | null>(null); // last settled bet already tallied
  const placing = useRef(false);                  // guards against double-placing in one window
  const balanceRef = useRef(balance);
  useEffect(() => { balanceRef.current = balance; }, [balance]);

  const stop = useCallback(() => {
    setRunning(false);
    run.current = null;
    placing.current = false;
  }, []);

  // Snapshot the stake + auto target + config so mid-run input edits never alter
  // an in-progress sequence. Any currently-open bet is excluded from the tally.
  const start = useCallback((stake: number, auto: number | null) => {
    if (isOperator || running) return;
    const cfg: AutoBetConfig = {
      rounds: Math.max(1, Math.floor(config.rounds)),
      stopLoss: Math.max(0, Math.floor(config.stopLoss)),
      stopWin: Math.max(0, Math.floor(config.stopWin)),
    };
    run.current = { stake, auto, cfg };
    remainingRef.current = cfg.rounds;
    netRef.current = 0;
    playedRef.current = 0;
    countedId.current = activeBet?.id ?? null;
    setStats({ played: 0, remaining: cfg.rounds, net: 0 });
    setRunning(true);
  }, [config, isOperator, running, activeBet]);

  // Tally each settlement exactly once and apply stop conditions.
  useEffect(() => {
    if (!running || !run.current || !activeBet) return;
    if (activeBet.status !== 'won' && activeBet.status !== 'lost') return;
    if (countedId.current === activeBet.id) return;
    countedId.current = activeBet.id;

    const pnl = activeBet.status === 'won'
      ? Number(activeBet.winnings ?? 0) - activeBet.amount
      : -activeBet.amount;
    netRef.current += pnl;
    playedRef.current += 1;
    remainingRef.current -= 1;
    setStats({ played: playedRef.current, remaining: Math.max(0, remainingRef.current), net: netRef.current });

    const { cfg } = run.current;
    const hitLoss = cfg.stopLoss > 0 && netRef.current <= -cfg.stopLoss;
    const hitWin = cfg.stopWin > 0 && netRef.current >= cfg.stopWin;
    if (remainingRef.current <= 0 || hitLoss || hitWin) stop();
  }, [activeBet, running, stop]);

  // Place the next bet during the waiting window (one bet per round).
  useEffect(() => {
    if (!running || !run.current || isOperator) return;
    if (status !== 'waiting' || activeBet || placing.current) return;
    if (remainingRef.current <= 0) return;
    const { stake, auto } = run.current;
    if (balanceRef.current < stake) { stop(); return; }
    placing.current = true;
    placeBet(stake, auto)
      .catch(() => { stop(); })
      .finally(() => { placing.current = false; });
  }, [status, activeBet, running, isOperator, placeBet, stop]);

  return { config, setConfig, running, stats, start, stop };
}
