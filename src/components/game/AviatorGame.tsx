import { useState, useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';
import GameCanvas from './GameCanvas';
import BettingPanel, { type QueuedBet } from './BettingPanel';
import GameHistory from './GameHistory';
import BetsPanel from './BetsPanel';
import { GamePanels } from './GamePanels';
import { publishFreeBetCount, type GamePanel } from '../../lib/gamePanels';
import { playSound } from '../../lib/sound';
import ChatSheet from './ChatSheet';
import { useGame, BET_SLOTS, type BetSlot } from '../../hooks/useGame';
import { useMaintenance } from '../../hooks/useMaintenance';
import type { DemoGame } from '../../hooks/useDemoGame';
import { usePromos } from '../../hooks/usePromos';
import PromoBar from './PromoBar';
import { formatMultiplier } from '../../lib/gameEngine';
import type { Profile, Wallet } from '../../types';
import { useSiteTheme } from '../../hooks/useSiteTheme';
import { useStreamerMode } from '../../hooks/useStreamerMode';

interface Props {
  profile: Profile | null;
  wallet: Wallet | null;
  mode: 'real' | 'demo';
  onSetMode: (mode: 'real' | 'demo') => void;
  demo: DemoGame;
  onAuthRequired: () => void;
  onRefreshWallet: () => Promise<void>;
  onDepositOpen: () => void;
}

export default function AviatorGame({ profile, wallet, mode, onSetMode, demo, onAuthRequired, onRefreshWallet, onDepositOpen }: Props) {
  const { planeSkin } = useSiteTheme();
  const streamer = useStreamerMode();
  // Chat opens as a sheet from the game menu.
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    const open = () => setChatOpen(true);
    window.addEventListener('aviator:open-chat', open);
    return () => window.removeEventListener('aviator:open-chat', open);
  }, []);
  // Two bet panels (two Bet buttons) by default on every screen, as in the mock; ⊖ on the second
  // removes it and ⊕ on the first brings it back. A panel with a live or queued bet is never hidden.
  const [dual, setDual] = useState(true);
  // Dialog opened from the ☰ game menu (Free Bets, My Bet History, Game Limits, How To Play).
  const [panel, setPanel] = useState<GamePanel | null>(null);
  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<GamePanel>).detail);
    window.addEventListener('aviator:open-panel', open);
    return () => window.removeEventListener('aviator:open-panel', open);
  }, []);
  // One queued bet per slot (dual-bet): each panel can independently queue a bet
  // for the next round while the current one is in flight.
  const [queuedBets, setQueuedBets] = useState<Record<BetSlot, QueuedBet | null>>({ 1: null, 2: null });
  // Real vs Demo mode is owned by PlayerApp (the header switch). Demo is a fully
  // self-contained, rigged, client-only engine (see useDemoGame) and is passed in.
  const isDemo = mode === 'demo';
  const balance = wallet?.balance ?? 0;
  // Operators (admin/super_admin) run the platform and must never wager. Marketers
  // and players are unaffected. The DB is the authoritative gate (place_bet +
  // block_operator_bets trigger); this only keeps the UI honest.
  const isOperator = profile?.role === 'admin' || profile?.role === 'super_admin';

  // Maintenance mode (real-money only). The DB place_bet RPC is the authoritative
  // gate; this flag locks the UI so players can't tap into a server rejection.
  // Operators retain the live view (they can't wager anyway) and demo is exempt
  // since it's client-only play money.
  const maintenance = useMaintenance();
  const maintenanceLock = maintenance && !isDemo && !isOperator;

  // Real game (server-authoritative). Always mounted so switching back to Real is
  // instant; it simply isn't the active view while in demo.
  const real = useGame(profile, balance, onRefreshWallet);

  // The active game view. In demo the rigged client engine drives the WHOLE
  // surface (canvas, board, history, lifecycle); in real the server game does.
  // Both expose the identical shape, so this one switch covers every consumer.
  const view = isDemo ? demo : real;
  const {
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
  } = view;

  // Player promotions (free bets + rain) - real-money mode only.
  const { freeBets, rain: openRain, busy: promoBusy, placeFreeBet: placeFreeBetRpc, claimRain } = usePromos(profile?.id, onRefreshWallet);
  // A free bet queued to auto-place on the next waiting round (slot 1).
  const [queuedFreeBet, setQueuedFreeBet] = useState<{ id: string; auto: number } | null>(null);

  // Betting surface fed to the panels. In demo every field already comes from the
  // demo engine via `view`; balance is the only value sourced separately.
  const panelBalance = isDemo ? demo.balance : balance;
  const panelActiveBets = activeBets;
  const panelPlaceBet = placeBet;
  const panelCashOut = cashOut;
  // Operators may practise in demo (no real money); the wager lock is real-only.
  const panelOperatorLock = isOperator && !isDemo;
  // Demo never requires authentication.
  const panelAuthed = isDemo ? true : !!profile;

  // Switching modes clears any pending queue so the two money contexts never mix.
  useEffect(() => {
    setQueuedBets({ 1: null, 2: null });
  }, [mode]);

  // Auto-place each slot's queued bet when the waiting phase begins. Uses the
  // active betting surface (real or demo). Slots are independent, so both can
  // fire in the same window.
  useEffect(() => {
    if (panelOperatorLock || gameStatus !== 'waiting') return;
    for (const slot of BET_SLOTS) {
      const q = queuedBets[slot];
      if (q && !panelActiveBets[slot]) {
        panelPlaceBet(q.amount, q.autoCashout, slot)
          .then(() => setQueuedBets((prev) => ({ ...prev, [slot]: null })))
          .catch(() => setQueuedBets((prev) => ({ ...prev, [slot]: null })));
      }
    }
  }, [gameStatus, queuedBets, panelActiveBets, panelPlaceBet, panelOperatorLock]);

  const handleQueueBet = (slot: BetSlot) => (amount: number, autoCashout: number | null) => {
    setQueuedBets((prev) => ({ ...prev, [slot]: { amount, autoCashout } }));
  };

  const handleCancelQueue = (slot: BetSlot) => () => {
    setQueuedBets((prev) => ({ ...prev, [slot]: null }));
  };

  // Menu badge: how many free bets the player holds (real money only).
  useEffect(() => { publishFreeBetCount(isDemo ? 0 : freeBets.length); }, [freeBets.length, isDemo]);

  // Sounds: bet accepted and cashed out (per slot).
  const prevBets = useRef(panelActiveBets);
  useEffect(() => {
    for (const slot of BET_SLOTS) {
      const before = prevBets.current[slot];
      const now = panelActiveBets[slot];
      if (!now) continue;
      if (!before || before.id !== now.id) { if (now.status === 'active') playSound('place'); continue; }
      if (before.status === 'active' && now.status === 'won') playSound('win');
    }
    prevBets.current = panelActiveBets;
  }, [panelActiveBets]);

  // The jet roar when the plane flies away: every round, only on the live flying → crashed
  // change (not when a page opens on an already-crashed round) and only in a visible tab.
  const prevStatus = useRef(gameStatus);
  useEffect(() => {
    if (prevStatus.current === 'flying' && gameStatus === 'crashed' && document.visibilityState === 'visible') playSound('flyaway');
    prevStatus.current = gameStatus;
  }, [gameStatus]);

  // Aggregate signals across both slots for the shared canvas overlays.
  const anyBetThisRound = !!panelActiveBets[1] || !!panelActiveBets[2];
  const lastWon = (panelActiveBets[1]?.status === 'won' && panelActiveBets[1]) || (panelActiveBets[2]?.status === 'won' && panelActiveBets[2]) || null;

  // Free bets stake on slot 1. Place now if waiting & slot 1 is free, else queue
  // for the next waiting round. Real-money mode only (demo has its own balance).
  const slot1Free = !activeBets[1] && !queuedBets[1];
  const handleUseFreeBet = (freeBetId: string, auto: number) => {
    if (isDemo || isOperator) return;
    const round = currentRound;
    if (gameStatus === 'waiting' && round && slot1Free) {
      placeFreeBetRpc(round.id, freeBetId, auto, 1).catch(() => {});
    } else {
      setQueuedFreeBet({ id: freeBetId, auto });
    }
  };
  useEffect(() => {
    if (isDemo || isOperator || gameStatus !== 'waiting' || !queuedFreeBet) return;
    const round = currentRound;
    if (!round || activeBets[1] || queuedBets[1]) return;
    placeFreeBetRpc(round.id, queuedFreeBet.id, queuedFreeBet.auto, 1)
      .then(() => setQueuedFreeBet(null))
      .catch(() => setQueuedFreeBet(null));
  }, [gameStatus, queuedFreeBet, currentRound, activeBets, queuedBets, isDemo, isOperator, placeFreeBetRpc]);

  const showSecond = dual || !!panelActiveBets[2] || !!queuedBets[2];
  const panelProps = (slot: BetSlot) => ({
    panelIndex: slot - 1,
    status: gameStatus,
    multiplier: currentMultiplier,
    balance: panelBalance,
    activeBet: panelActiveBets[slot],
    queuedBet: queuedBets[slot],
    onPlaceBet: (a: number, c: number | null) => panelPlaceBet(a, c, slot),
    onQueueBet: handleQueueBet(slot),
    onCancelQueue: handleCancelQueue(slot),
    onCashOut: () => panelCashOut(slot),
    onAuthRequired,
    onDeposit: onDepositOpen,
    isAuthenticated: panelAuthed,
    isOperator: panelOperatorLock,
    streamer: streamer.enabled,
  });

  const kes = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex h-full min-h-0 bg-[#0e0e0e] lg:gap-2 lg:p-2">

      {/* Desktop: All Bets / Previous / Top on the left */}
      {!streamer.enabled && (
        <BetsPanel bets={liveBets} status={gameStatus} previousRound={history[0] ?? null} me={profile?.username ?? (isDemo ? 'You' : null)}
          className="hidden w-[380px] shrink-0 lg:flex" />
      )}

      {/* Main column. Phones: the first screen is history + plane + both bet panels (the plane takes
          whatever height is left); the bets list follows below. Desktop: everything fits, no scroll. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden">
        <div className="flex min-h-full shrink-0 flex-col gap-1.5 px-1.5 pb-1.5 lg:h-full lg:min-h-0 lg:px-0 lg:pb-0">

          <div className="relative z-20 shrink-0 px-1 pt-1.5 lg:pt-0">
            <GameHistory history={history} />
          </div>

          {/* Plane */}
          <div className={`relative min-h-[190px] flex-1 overflow-hidden rounded-2xl border bg-[#0d0d0d] lg:min-h-[260px] ${isDemo ? 'border-funmode/70' : 'border-[#2a2b2e]'}`}>
            <GameCanvas
              planeSkin={planeSkin}
              streamer={streamer.enabled}
              status={gameStatus}
              multiplier={currentMultiplier}
              getMultiplier={getMultiplier}
              crashPoint={crashPoint}
              countdown={countdown}
            />

            {/* Real / Demo */}
            <div className="absolute left-2 top-2 z-10 flex rounded-full bg-black/55 p-0.5 backdrop-blur" role="tablist" aria-label="Play mode">
              {(['real', 'demo'] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => onSetMode(m)}
                  className={`h-8 rounded-full px-3.5 text-[13px] font-bold transition ${mode === m ? (m === 'demo' ? 'bg-funmode text-white' : 'bg-win text-white') : 'text-slate-300 hover:text-white'}`}>
                  {m === 'real' ? 'Real' : 'Demo'}
                </button>
              ))}
            </div>

            <div className="sr-only" aria-live="polite" role="status">
              {gameStatus === 'flying'  && `Multiplier ${formatMultiplier(currentMultiplier)}`}
              {gameStatus === 'crashed' && `Flew away at ${formatMultiplier(crashPoint)}`}
              {gameStatus === 'waiting' && 'Waiting for next round'}
            </div>

            {/* Result of the player's own cash-out: the only message drawn over the plane */}
            {lastWon && (
              <div role="status" className="absolute left-1/2 top-12 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#28a909] px-4 py-1.5 text-[15px] font-bold tabular-nums text-white shadow-lg shadow-black/40">
                +{kes(lastWon.winnings ?? 0)}{streamer.enabled ? '' : ' KES'} · {(lastWon.cashout_multiplier ?? currentMultiplier).toFixed(2)}{streamer.enabled ? '' : 'x'}
              </div>
            )}
          </div>

          {maintenance && !isDemo && isOperator && (
            <div className="shrink-0 rounded-xl bg-amber-500/15 px-3 py-2 text-center text-[13px] font-semibold text-amber-300">Maintenance on · players can't bet</div>
          )}
          {maintenanceLock && anyBetThisRound && (
            <div className="shrink-0 rounded-xl bg-amber-500/15 px-3 py-2 text-center text-[13px] font-semibold text-amber-300">Maintenance · cash out only</div>
          )}

          {!isDemo && profile && !isOperator && !streamer.enabled && (
            <PromoBar freeBets={freeBets} rain={openRain} busy={promoBusy} canUseFreeBet={slot1Free && !queuedFreeBet} onClaimRain={claimRain} onUseFreeBet={handleUseFreeBet} />
          )}

          {/* Bet panels */}
          {maintenanceLock && !anyBetThisRound ? (
            <div className="flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#1b1c1d] px-4 py-6 text-sm font-semibold text-amber-300">
              <Wrench size={18} />Betting paused for maintenance
            </div>
          ) : (
            <div className="flex shrink-0 flex-col gap-1.5 md:flex-row md:justify-center lg:gap-2">
              <div className="md:w-full md:max-w-[460px]">
                <BettingPanel {...panelProps(1)} corner={showSecond ? null : { kind: 'add', onClick: () => setDual(true) }} />
              </div>
              {showSecond && (
                <div className="md:w-full md:max-w-[460px]">
                  <BettingPanel {...panelProps(2)}
                    corner={panelActiveBets[2] || queuedBets[2] ? null : { kind: 'remove', onClick: () => setDual(false) }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phones and tablets: the bets list under the panels */}
        {!streamer.enabled && (
          <BetsPanel bets={liveBets} status={gameStatus} previousRound={history[0] ?? null} me={profile?.username ?? (isDemo ? 'You' : null)}
            className="mx-1.5 mb-[calc(6px+env(safe-area-inset-bottom))] min-h-[420px] shrink-0 lg:hidden" />
        )}
      </div>

      <GamePanels panel={panel} onClose={() => setPanel(null)} userId={profile?.id ?? null}
        freeBets={isDemo ? [] : freeBets} canUseFreeBet={!isDemo && !isOperator && slot1Free && !queuedFreeBet}
        onUseFreeBet={handleUseFreeBet} minAuto={1.01} />

      {chatOpen && !streamer.enabled && <ChatSheet profile={profile} onClose={() => setChatOpen(false)} />}
    </div>
  );
}
