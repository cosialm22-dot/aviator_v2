import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Users, Plus, X, Wrench } from 'lucide-react';
import GameCanvas from './GameCanvas';
import BettingPanel, { type QueuedBet } from './BettingPanel';
import LiveBetsTable from './LiveBetsTable';
import GameHistory from './GameHistory';
import Leaderboard from './Leaderboard';
import PreviousRoundBets from './PreviousRoundBets';
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

interface Props {
  profile: Profile | null;
  wallet: Wallet | null;
  mode: 'real' | 'demo';
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

type MobileTab = 'bets' | 'chat';

export default function AviatorGame({ profile, wallet, mode, demo, onAuthRequired, onRefreshWallet, onDepositOpen }: Props) {
  const [activeTab, setActiveTab] = useState<'allBets' | 'previous' | 'top'>('allBets');
  // Mobile Bets/Chat sheet. Closed by default (null) so the canvas + betting
  // controls own the small-screen viewport and the primary bet action is always
  // reachable. Tapping a tab opens that sheet; tapping the open tab closes it.
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null);
  // Second simultaneous bet (dual-bet) is a power-user feature. On mobile it is
  // hidden by default so the primary bet stays the single, obvious action; one
  // tap reveals it. On desktop both panels are always shown side by side.
  const [showSecondBet, setShowSecondBet] = useState(false);
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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-night">
      {/* History strip */}
      <div className="flex-shrink-0 bg-night border-b border-edge overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-1 px-3 py-1.5 min-w-max">
          <GameHistory history={history} />
        </div>
      </div>

      {/* Main body */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: Live Bets (lg+) ──────────────────────────────────── */}
        <div className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-night border-r border-edge">
          <div className="flex border-b border-edge flex-shrink-0">
            {(['allBets', 'previous', 'top'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-[11px] font-semibold transition-colors ${
                  activeTab === tab ? 'text-white border-b-2 border-danger' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab === 'allBets' ? 'All Bets' : tab === 'previous' ? 'Previous' : 'Top'}
              </button>
            ))}
          </div>

          {activeTab === 'top' ? (
            <Leaderboard />
          ) : (
            <>
              {activeTab === 'allBets' && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-edge flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <div className="flex -space-x-1">
                      {liveBets.slice(0, 3).map((b, i) => (
                        <div key={i} className="w-5 h-5 rounded-full border border-night flex items-center justify-center text-white text-[8px] font-bold" style={{ backgroundColor: b.avatar_color }}>
                          {b.username[0]?.toUpperCase()}
                        </div>
                      ))}
                    </div>
                    <span className="text-[11px] text-white font-semibold">{liveBets.length}</span>
                    <span className="text-[10px] text-slate-600">bets</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white text-sm font-bold">{(liveBets.reduce((s, b) => s + b.amount, 0) / 1000).toFixed(1)}K</div>
                    <div className="text-slate-500 text-[9px]">KShs total</div>
                  </div>
                </div>
              )}

              <div className="grid px-3 py-1 text-[10px] text-slate-500 border-b border-edge/50 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto auto auto' }}>
                <span>Player</span>
                <span className="px-2">Bet</span>
                <span className="px-2 text-center">X</span>
                <span className="text-right">Win</span>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {activeTab === 'allBets'
                  ? <LiveBetsTable bets={liveBets} status={gameStatus} />
                  : <PreviousRoundBets roundId={history[0]?.id ?? null} />}
              </div>
            </>
          )}
        </div>

        {/* ── Center: Canvas + Betting ───────────────────────────────── */}
        {/* min-h-0 is essential: without it the column's default min-height:auto
            stops its flex children from shrinking, so on short viewports the
            stack overflows and the (bottom-anchored) betting controls get clipped
            out of reach. With min-h-0 the canvas absorbs the shrink and the bet
            controls stay visible on every device. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">

          {/* Canvas - takes most vertical space */}
          <div className="relative flex-1 min-h-0 bg-[#111118] overflow-hidden">
            <GameCanvas
              status={gameStatus}
              multiplier={currentMultiplier}
              getMultiplier={getMultiplier}
              crashPoint={crashPoint}
              countdown={countdown}
            />

            {/* The multiplier, countdown, loader and crash text are rendered on
                the canvas itself (60fps, perfectly synced with the plane/trail).
                This layer only adds the contextual prompts that sit below them.
                Positioned at a fixed fraction of canvas HEIGHT (top-[58%]) so the
                prompt stays just under the multiplier on every screen width — a
                percentage margin-top would resolve against width and drift. */}
            <div className="absolute inset-x-0 top-[58%] flex flex-col items-center pointer-events-none z-10">
              {gameStatus === 'flying' && anyActiveInFlight && (
                <div className="text-green-400 text-sm font-black animate-pulse tracking-wide">
                  CASH OUT NOW!
                </div>
              )}
              {gameStatus === 'waiting' && anyBetThisRound && (
                <div className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-amber-400 text-xs font-semibold">
                  Bet in - ready!
                </div>
              )}
            </div>

            {/* Accessibility: expose the live game state to assistive tech, since
                the visual multiplier is painted on the canvas (not in the DOM). */}
            <div className="sr-only" aria-live="polite" role="status">
              {gameStatus === 'flying'  && `Multiplier ${formatMultiplier(currentMultiplier)}`}
              {gameStatus === 'crashed' && `Flew away at ${formatMultiplier(crashPoint)}`}
              {gameStatus === 'waiting' && 'Waiting for next round'}
            </div>

            {/* Cashout toast */}
            {lastWon && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-green-500 text-white font-bold px-4 py-2 rounded-full text-sm shadow-lg shadow-green-500/40 z-20 whitespace-nowrap">
                +KSh {(lastWon.winnings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} @ {(lastWon.cashout_multiplier ?? currentMultiplier).toFixed(2)}×
              </div>
            )}

            {/* Online count */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10 bg-black/40 rounded-full px-2 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-slate-300 text-[10px] font-semibold">{onlineCount.toLocaleString('en-KE')}</span>
            </div>

            {/* Low-balance psychology nudge */}
            {nudge && profile && (
              <div className="absolute inset-x-3 bottom-12 z-20 md:left-1/2 md:-translate-x-1/2 md:w-80">
                <div className="bg-gradient-to-br from-win-dark to-win rounded-2xl p-4 shadow-2xl shadow-green-900/60 text-white">
                  <div className="font-black text-base leading-tight">{nudge.title}</div>
                  <div className="text-xs mt-1 opacity-90">{nudge.sub}</div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setNudge(null); onDepositOpen(); }}
                      className="flex-1 py-2.5 bg-white text-win-dark rounded-xl text-sm font-black hover:bg-gray-100 transition active:scale-95"
                    >
                      Deposit Now
                    </button>
                    <button
                      onClick={() => setNudge(null)}
                      className="px-4 py-2.5 bg-white/20 rounded-xl text-sm font-semibold hover:bg-white/30 transition"
                    >
                      Later
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile/tablet chat ticker: one rotating line of live chat just below
              the canvas, so players see what others say without switching tabs.
              Hidden on xl where the full chat panel is always visible. */}
          <ChatTicker messages={chat.messages} onOpenChat={() => setMobileTab('chat')} />

          {/* Operator notice: admins/super_admins manage the platform and cannot
              wager with real money. They may still practise in Demo mode. */}
          {panelOperatorLock && (
            <div className="flex-shrink-0 border-t border-edge bg-amber-500/10 px-4 py-2 text-center text-amber-300 text-[11px] font-semibold">
              You are signed in as an operator. Operator accounts cannot place real bets - switch to Demo to practise.
            </div>
          )}

          {/* Maintenance: staff keep the live view (they can't wager anyway) but
              are told players are locked out. */}
          {maintenance && !isDemo && isOperator && (
            <div className="flex-shrink-0 border-t border-edge bg-amber-500/15 px-4 py-2 text-center text-amber-300 text-[11px] font-semibold">
              Maintenance mode is ON - players are blocked from placing bets. You are viewing as staff.
            </div>
          )}

          {/* Maintenance: a player with a bet already in flight keeps the panels
              so they can cash out, but new bets are closed. */}
          {maintenanceLock && anyBetThisRound && (
            <div className="flex-shrink-0 border-t border-edge bg-amber-500/15 px-4 py-2 text-center text-amber-300 text-[11px] font-semibold">
              New bets are closed for maintenance. You can still cash out your active bet.
            </div>
          )}

          {/* Player promotions: free bets + rain (real-money mode only) */}
          {!isDemo && profile && !isOperator && (
            <PromoBar
              freeBets={freeBets}
              rain={openRain}
              busy={promoBusy}
              canUseFreeBet={slot1Free && !queuedFreeBet}
              onClaimRain={claimRain}
              onUseFreeBet={handleUseFreeBet}
            />
          )}

          {/* Real / Demo switch lives in the header (left of Sign In); demo
              balance + reset are shown there too. */}

          {/* Betting panels. Mobile (default): a single full-width panel so the
              bet action is the one obvious thing on screen. The second dual-bet
              slot is opt-in via the toggle below. Desktop (lg+): both side by
              side. flex-col -> lg:flex-row gives full width on phones. */}
          {maintenanceLock && !anyBetThisRound ? (
            <div className="flex-shrink-0 border-t border-edge bg-night px-4 py-8">
              <div className="mx-auto max-w-sm text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                  <Wrench size={20} />
                </div>
                <div className="text-white font-bold text-sm">Game under maintenance</div>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  Betting is paused while we carry out scheduled maintenance. Your balance is safe - please check back shortly.
                </p>
              </div>
            </div>
          ) : (
          <div className="flex flex-col lg:flex-row flex-shrink-0 border-t border-edge bg-night">
            <div className="flex-1 lg:border-r border-edge">
              <BettingPanel
                panelIndex={0}
                status={gameStatus}
                multiplier={currentMultiplier}
                balance={panelBalance}
                activeBet={panelActiveBets[1]}
                queuedBet={queuedBets[1]}
                onPlaceBet={(a, c) => panelPlaceBet(a, c, 1)}
                onQueueBet={handleQueueBet(1)}
                onCancelQueue={handleCancelQueue(1)}
                onCashOut={() => { void panelCashOut(1); }}
                onAuthRequired={onAuthRequired}
                isAuthenticated={panelAuthed}
                isOperator={panelOperatorLock}
              />
            </div>
            <div className={`flex-1 border-t border-edge lg:border-t-0 ${showSecondBet ? 'block' : 'hidden'} lg:block`}>
              <BettingPanel
                panelIndex={1}
                status={gameStatus}
                multiplier={currentMultiplier}
                balance={panelBalance}
                activeBet={panelActiveBets[2]}
                queuedBet={queuedBets[2]}
                onPlaceBet={(a, c) => panelPlaceBet(a, c, 2)}
                onQueueBet={handleQueueBet(2)}
                onCancelQueue={handleCancelQueue(2)}
                onCashOut={() => { void panelCashOut(2); }}
                onAuthRequired={onAuthRequired}
                isAuthenticated={panelAuthed}
                isOperator={panelOperatorLock}
              />
            </div>
          </div>
          )}

          {/* Mobile-only: opt in / out of the second simultaneous bet. */}
          <button
            onClick={() => setShowSecondBet(v => !v)}
            className="lg:hidden flex-shrink-0 flex items-center justify-center gap-1.5 py-2 border-t border-edge bg-night text-[11px] font-semibold text-slate-400 hover:text-white transition-colors active:scale-[0.99]"
          >
            {showSecondBet ? <X size={13} /> : <Plus size={13} />}
            <span>{showSecondBet ? 'Remove second bet' : 'Add a second bet'}</span>
          </button>

          {/* Mobile bottom tab: Bets / Chat. Each tab toggles its sheet open or
              closed, so the default view stays focused on the canvas + bet
              controls and players opt in to secondary content one tap at a time. */}
          <div className="lg:hidden flex border-t border-edge bg-night flex-shrink-0">
            <button
              onClick={() => setMobileTab(t => (t === 'bets' ? null : 'bets'))}
              aria-expanded={mobileTab === 'bets'}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                mobileTab === 'bets' ? 'text-white border-t-2 border-danger' : 'text-slate-500'
              }`}
            >
              <Users size={14} />
              <span>Bets ({liveBets.length})</span>
            </button>
            <button
              onClick={() => setMobileTab(t => (t === 'chat' ? null : 'chat'))}
              aria-expanded={mobileTab === 'chat'}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                mobileTab === 'chat' ? 'text-white border-t-2 border-danger' : 'text-slate-500'
              }`}
            >
              <MessageSquare size={14} />
              <span>Chat</span>
            </button>
          </div>

          {/* Mobile sheet: rendered only when a tab is open, and bounded by a
              fraction of the viewport (max-h-[38vh]) so it never pushes the bet
              controls off-screen. Closed by default. */}
          {mobileTab !== null && (
            <div className="lg:hidden flex-shrink-0 bg-night max-h-[38vh] h-[38vh] border-t border-edge">
              {mobileTab === 'bets' ? (
                <div className="h-full overflow-y-auto scrollbar-thin">
                  <LiveBetsTable bets={liveBets} status={gameStatus} />
                </div>
              ) : (
                <div className="h-full">
                  <Chat messages={chat.messages} sending={chat.sending} onSend={chat.send} userId={profile?.id} username={profile?.username} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Live Chat (xl+) ────────────────────────────────── */}
        <div className="hidden xl:flex flex-col w-60 flex-shrink-0 bg-night border-l border-edge">
          <Chat messages={chat.messages} sending={chat.sending} onSend={chat.send} userId={profile?.id} username={profile?.username} />
        </div>
      </div>
    </div>
  );
}
