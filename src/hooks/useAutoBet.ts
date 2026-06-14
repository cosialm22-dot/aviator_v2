import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStatus } from '../types';
import type { ActiveBet } from './useGame';
import {
  type AutoBetConfig,
  type AutoBetStats,
  DEFAULT_AUTO_BET_CONFIG,
  normalizeConfig,
  settlementPnl,
  applySettlement,
  shouldStop,
  canPlaceNext,
} from './autoBetEngine';

// Re-export the shared types so existing import sites (e.g. BettingPanel) are unaffected.
export type { AutoBetConfig, AutoBetStats } from './autoBetEngine';

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
// never invent money or settle a bet itself. All run decisions are delegated to
// the pure autoBetEngine module (unit-tested); this hook owns only side effects.
//
// Correctness relies on the round lifecycle (see useGame.applyRound): activeBet
// is null on each new 'waiting' round and becomes terminal (won/lost) exactly
// once per bet. Counters live in refs to avoid stale-closure bugs in effects.
// ============================================================================

interface Params {
  status: GameStatus;
  activeBet: ActiveBet | null;
  balance: number;
  isOperator: boolean;
  placeBet: (amount: number, autoCashoutAt: number | null) => Promise<void>;
}

export function useAutoBet({ status, activeBet, balance, isOperator, placeBet }: Params) {
  const [config, setConfig] = useState<AutoBetConfig>(DEFAULT_AUTO_BET_CONFIG);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<AutoBetStats>({ played: 0, remaining: 0, net: 0 });

  // Immutable run snapshot (taken at start) + mutable counters.
  const run = useRef<{ stake: number; auto: number | null; cfg: AutoBetConfig } | null>(null);
  const statsRef = useRef<AutoBetStats>(stats);
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
    const cfg = normalizeConfig(config);
    run.current = { stake, auto, cfg };
    const initial: AutoBetStats = { played: 0, remaining: cfg.rounds, net: 0 };
    statsRef.current = initial;
    countedId.current = activeBet?.id ?? null;
    setStats(initial);
    setRunning(true);
  }, [config, isOperator, running, activeBet]);

  // Tally each settlement exactly once and apply stop conditions.
  useEffect(() => {
    if (!running || !run.current || !activeBet) return;
    if (activeBet.status !== 'won' && activeBet.status !== 'lost') return;
    if (countedId.current === activeBet.id) return;
    countedId.current = activeBet.id;

    const pnl = settlementPnl(activeBet.status, activeBet.amount, activeBet.winnings);
    const next = applySettlement(statsRef.current, pnl);
    statsRef.current = next;
    setStats({ ...next, remaining: Math.max(0, next.remaining) });

    if (shouldStop(next, run.current.cfg)) stop();
  }, [activeBet, running, stop]);

  // Place the next bet during the waiting window (one bet per round).
  useEffect(() => {
    if (!running || !run.current || isOperator) return;
    if (status !== 'waiting' || activeBet || placing.current) return;
    const { stake, auto } = run.current;
    if (!canPlaceNext(statsRef.current.remaining, stake, balanceRef.current)) { stop(); return; }
    placing.current = true;
    placeBet(stake, auto)
      .catch(() => { stop(); })
      .finally(() => { placing.current = false; });
  }, [status, activeBet, running, isOperator, placeBet, stop]);

  return { config, setConfig, running, stats, start, stop };
}
