import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Wrench, RotateCcw, X } from 'lucide-react';
import GameCanvas from './GameCanvas';
import BettingPanel, { type QueuedBet } from './BettingPanel';
import GameHistory from './GameHistory';
import BetsPanel from './BetsPanel';
import { GamePanels } from './GamePanels';
import { publishFreeBetCount, type GamePanel } from '../../lib/gamePanels';
import { playSound } from '../../lib/sound';
import Chat from './Chat';
import ChatTicker from './ChatTicker';
import { useChatStream } from '../../hooks/useChatStream';
import { useGame, BET_SLOTS, type BetSlot } from '../../hooks/useGame';
import { useMaintenance } from '../../hooks/useMaintenance';
import type { DemoGame } from '../../hooks/useDemoGame';
import { usePromos } from '../../hooks/usePromos';
import { useOnlineCount } from '../../hooks/useOnlineCount';
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

const LOW_BALANCE_NUDGES = [
  { title: 'Your comeback is ONE bet away!', sub: 'Top up KSh 500 and turn the game around.' },
  { title: 'Big winners always reload fast!', sub: 'Don\'t miss the next big multiplier - deposit now.' },
  { title: 'The next round could be 50x!', sub: 'Deposit KSh 200 and stay in the game.' },
  { title: 'Every pilot crashes. The greats fly again.', sub: 'Reload and take back the skies!' },
  { title: '87% of players win on their comeback bet!', sub: 'Don\'t quit when you\'re this close.' },
];


export default function AviatorGame({ profile, wallet, mode, onSetMode, demo, onAuthRequired, onRefreshWallet, onDepositOpen }: Props) {
  const { planeSkin } = useSiteTheme();
  const streamer = useStreamerMode();
  // Chat opens as a slide-over (from the chat ticker or the game menu), as in the mock layout.
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
  const [nudge, setNudge] = useState<{ title: string; sub: string } | null>(null);
  const nudgeShownRef = useRef(false);
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

  // Single shared chat stream (bots + Realtime + own sends). Lifted here so the
  // full chat panel and the mobile ChatTicker render the identical stream.
  const chat = useChatStream({ userId: profile?.id, username: profile?.username, avatarColor: profile?.avatar_color });

  // Simulated "players online" presence (no realtime presence channel exists).
  // Always ≥ the bets visible this round so the headline never under-counts.
  const onlineCount = useOnlineCount(liveBets.length);

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

  // Psychology nudge: low balance after a crash (real mode only - demo can be
  // reset for free, so we never push deposits during free-play).
  useEffect(() => {
    if (!profile || isDemo) return;
    if (balance < 50 && balance >= 0 && !nudgeShownRef.current && gameStatus === 'crashed') {
      nudgeShownRef.current = true;
      const msg = LOW_BALANCE_NUDGES[Math.floor(Math.random() * LOW_BALANCE_NUDGES.length)];
      setNudge(msg);
    }
    if (balance >= 50) {
      nudgeShownRef.current = false;
      setNudge(null);
    }
  }, [balance, profile, gameStatus, isDemo]);

  // Switching modes clears any pending queue and dismisses the nudge so the two
  // money contexts never leak into one another.
  useEffect(() => {
    setQueuedBets({ 1: null, 2: null });
    setNudge(null);
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

  // Sounds: bet accepted, cashed out, and flew away with a bet still riding (per slot).
  const prevBets = useRef(panelActiveBets);
  useEffect(() => {
    for (const slot of BET_SLOTS) {
      const before = prevBets.current[slot];
      const now = panelActiveBets[slot];
      if (!now) continue;
      if (!before || before.id !== now.id) { if (now.status === 'active') playSound('place'); continue; }
      if (before.status === 'active' && now.status === 'won') playSound('win');
      if (before.status === 'active' && now.status === 'lost') playSound('loss');
    }
    prevBets.current = panelActiveBets;
  }, [panelActiveBets]);

  // Aggregate signals across both slots for the shared canvas overlays.
  const anyActiveInFlight = panelActiveBets[1]?.status === 'active' || panelActiveBets[2]?.status === 'active';
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
    onCashOut: () => { void panelCashOut(slot); },
    onAuthRequired,
    onDeposit: onDepositOpen,
    isAuthenticated: panelAuthed,
    isOperator: panelOperatorLock,
    streamer: streamer.enabled,
  });

  return (
    <div className="flex h-full min-h-0 bg-[#0e0e0e] lg:gap-2 lg:p-2">

      {/* ── Left (desktop): All Bets / Previous / Top ─────────────────── */}
      {!streamer.enabled && (
        <BetsPanel bets={liveBets} status={gameStatus} previousRound={history[0] ?? null} me={profile?.username ?? (isDemo ? 'You' : null)}
          className="hidden w-[400px] shrink-0 lg:flex" />
      )}

      {/* ── Main column. Phones: one scrolling page (history, canvas, bet panels, bets list), as in
          the mock. Desktop: history strip, canvas filling the height, bet panels underneath. ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden">

        {/* History strip */}
        <div className="relative z-20 shrink-0 px-2.5 py-1.5 lg:px-1 lg:pb-2 lg:pt-0.5">
          <GameHistory history={history} />
        </div>

        {/* Canvas card (FUN MODE tab on top in demo) */}
        <div className="mx-1.5 flex h-[46vh] min-h-[240px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#2a2b2e] lg:mx-0 lg:h-auto lg:min-h-[260px] lg:flex-1 lg:shrink">
          {isDemo && (
            <div className="shrink-0 bg-funmode py-0.5 text-center text-[11px] font-bold tracking-[0.12em] text-white">FUN MODE</div>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d0d0d]">
            <GameCanvas
              planeSkin={planeSkin}
              streamer={streamer.enabled}
              status={gameStatus}
              multiplier={currentMultiplier}
              getMultiplier={getMultiplier}
              crashPoint={crashPoint}
              countdown={countdown}
            />

            {/* Prompts under the canvas-painted multiplier (fixed fraction of canvas height). */}
            <div className="pointer-events-none absolute inset-x-0 top-[58%] z-10 flex flex-col items-center">
              {gameStatus === 'flying' && anyActiveInFlight && (
                <div className="animate-pulse text-sm font-black tracking-wide text-green-400">CASH OUT NOW!</div>
              )}
              {gameStatus === 'waiting' && anyBetThisRound && (
                <div className="rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-400">Bet in - ready!</div>
              )}
            </div>

            <div className="sr-only" aria-live="polite" role="status">
              {gameStatus === 'flying'  && `Multiplier ${formatMultiplier(currentMultiplier)}`}
              {gameStatus === 'crashed' && `Flew away at ${formatMultiplier(crashPoint)}`}
              {gameStatus === 'waiting' && 'Waiting for next round'}
            </div>

            {lastWon && (
              <div className="absolute left-1/2 top-10 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-green-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-green-500/40">
                +KSh {(lastWon.winnings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} @ {(lastWon.cashout_multiplier ?? currentMultiplier).toFixed(2)}×
              </div>
            )}

            <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              <span className="text-[10px] font-semibold text-slate-300">{onlineCount.toLocaleString('en-KE')}</span>
            </div>

            {nudge && profile && (
              <div className="absolute inset-x-3 bottom-12 z-20 md:left-1/2 md:w-80 md:-translate-x-1/2">
                <div className="rounded-2xl bg-gradient-to-br from-win-dark to-win p-4 text-white shadow-2xl shadow-green-900/60">
                  <div className="text-base font-black leading-tight">{nudge.title}</div>
                  <div className="mt-1 text-xs opacity-90">{nudge.sub}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => { setNudge(null); onDepositOpen(); }} className="flex-1 rounded-xl bg-white py-2.5 text-sm font-black text-win-dark transition hover:bg-gray-100 active:scale-95">Deposit Now</button>
                    <button onClick={() => setNudge(null)} className="rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/30">Later</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!streamer.enabled && <ChatTicker messages={chat.messages} onOpenChat={() => setChatOpen(true)} />}

        {panelOperatorLock && (
          <div className="mx-1.5 mt-1.5 shrink-0 rounded-xl bg-amber-500/10 px-4 py-2 text-center text-[11px] font-semibold text-amber-300 lg:mx-0">
            You are signed in as an operator. Operator accounts cannot place real bets - switch to Demo to practise.
          </div>
        )}
        {maintenance && !isDemo && isOperator && (
          <div className="mx-1.5 mt-1.5 shrink-0 rounded-xl bg-amber-500/15 px-4 py-2 text-center text-[11px] font-semibold text-amber-300 lg:mx-0">
            Maintenance mode is ON - players are blocked from placing bets. You are viewing as staff.
          </div>
        )}
        {maintenanceLock && anyBetThisRound && (
          <div className="mx-1.5 mt-1.5 shrink-0 rounded-xl bg-amber-500/15 px-4 py-2 text-center text-[11px] font-semibold text-amber-300 lg:mx-0">
            New bets are closed for maintenance. You can still cash out your active bet.
          </div>
        )}

        {!isDemo && profile && !isOperator && !streamer.enabled && (
          <PromoBar freeBets={freeBets} rain={openRain} busy={promoBusy} canUseFreeBet={slot1Free && !queuedFreeBet} onClaimRain={claimRain} onUseFreeBet={handleUseFreeBet} />
        )}

        {/* Real / Demo play-mode switch, directly above the bet panels. */}
        <div className="mx-1.5 mt-1.5 flex shrink-0 items-center justify-between gap-2 lg:mx-0">
          <div className="flex rounded-full bg-[#1b1c1d] p-0.5" role="tablist" aria-label="Play mode">
            {(['real', 'demo'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => onSetMode(m)}
                className={`rounded-full px-4 py-1 text-xs font-bold transition-all ${mode === m ? (m === 'demo' ? 'bg-funmode text-white' : 'bg-win text-white') : 'text-slate-400 hover:text-slate-200'}`}>
                {m === 'real' ? 'Real' : 'Demo'}
              </button>
            ))}
          </div>
          {isDemo ? (
            <div className="flex items-center gap-1.5 rounded-full bg-[#1b1c1d] px-2.5 py-1">
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Demo</span>
              <span className="text-xs font-bold tabular-nums text-funmode">KSh {demo.balance.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
              <button onClick={demo.reset} title="Reset demo balance" aria-label="Reset demo balance" className="text-slate-400 transition hover:text-white active:scale-90"><RotateCcw size={12} /></button>
            </div>
          ) : null}
        </div>

        {/* Bet panels */}
        {maintenanceLock && !anyBetThisRound ? (
          <div className="mx-1.5 mt-1.5 shrink-0 rounded-2xl bg-[#1b1c1d] px-4 py-8 lg:mx-0">
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-400"><Wrench size={20} /></div>
              <div className="text-sm font-bold text-white">Game under maintenance</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">Betting is paused while we carry out scheduled maintenance. Your balance is safe - please check back shortly.</p>
            </div>
          </div>
        ) : (
          <div className="mx-1.5 mt-1.5 flex shrink-0 flex-col gap-1.5 lg:mx-0 lg:flex-row lg:justify-center lg:gap-2">
            <div className="lg:w-full lg:max-w-[460px]">
              <BettingPanel {...panelProps(1)} corner={showSecond ? null : { kind: 'add', onClick: () => setDual(true) }} />
            </div>
            {showSecond && (
              <div className="lg:w-full lg:max-w-[460px]">
                <BettingPanel {...panelProps(2)}
                  corner={panelActiveBets[2] || queuedBets[2] ? null : { kind: 'remove', onClick: () => setDual(false) }} />
              </div>
            )}
          </div>
        )}

        {/* Phones: the bets list sits under the panels (page scroll), as in the mock */}
        {!streamer.enabled && (
          <BetsPanel bets={liveBets} status={gameStatus} previousRound={history[0] ?? null} me={profile?.username ?? (isDemo ? 'You' : null)}
            className="mx-1.5 my-1.5 min-h-[420px] shrink-0 lg:hidden" />
        )}
      </div>

      <GamePanels panel={panel} onClose={() => setPanel(null)} userId={profile?.id ?? null}
        freeBets={isDemo ? [] : freeBets} canUseFreeBet={!isDemo && !isOperator && slot1Free && !queuedFreeBet}
        onUseFreeBet={handleUseFreeBet} minBet={50} stakeStep={50} minAuto={1.01} />

      {/* Chat slide-over (opened from the ticker or the game menu) */}
      {chatOpen && !streamer.enabled && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Chat">
          <button type="button" aria-label="Close chat" onClick={() => setChatOpen(false)} className="absolute inset-0 bg-black/50" />
          <div className="relative flex h-full w-full max-w-sm flex-col border-l border-edge bg-panel">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><MessageSquare size={14} />Chat</span>
              <button type="button" onClick={() => setChatOpen(false)} aria-label="Close chat" className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1">
              <Chat messages={chat.messages} sending={chat.sending} onSend={chat.send} userId={profile?.id} username={profile?.username} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
