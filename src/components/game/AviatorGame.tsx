import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Users, RotateCcw } from 'lucide-react';
import GameCanvas from './GameCanvas';
import BettingPanel, { type QueuedBet } from './BettingPanel';
import LiveBetsTable from './LiveBetsTable';
import GameHistory from './GameHistory';
import Chat from './Chat';
import { useGame, BET_SLOTS, type BetSlot } from '../../hooks/useGame';
import { useDemoBets, DEMO_STARTING_BALANCE } from '../../hooks/useDemoBets';
import { formatMultiplier } from '../../lib/gameEngine';
import type { Profile, Wallet } from '../../types';

interface Props {
  profile: Profile | null;
  wallet: Wallet | null;
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

export default function AviatorGame({ profile, wallet, onAuthRequired, onRefreshWallet, onDepositOpen }: Props) {
  const [activeTab, setActiveTab] = useState<'allBets' | 'previous' | 'top'>('allBets');
  const [mobileTab, setMobileTab] = useState<MobileTab>('bets');
  const [nudge, setNudge] = useState<{ title: string; sub: string } | null>(null);
  const nudgeShownRef = useRef(false);
  // One queued bet per slot (dual-bet): each panel can independently queue a bet
  // for the next round while the current one is in flight.
  const [queuedBets, setQueuedBets] = useState<Record<BetSlot, QueuedBet | null>>({ 1: null, 2: null });
  // Real vs Demo (free-play) mode. Demo rides the same shared rounds with play
  // money and never touches the server (see useDemoBets).
  const [mode, setMode] = useState<'real' | 'demo'>('real');
  const isDemo = mode === 'demo';
  const balance = wallet?.balance ?? 0;
  // Operators (admin/super_admin) run the platform and must never wager. Marketers
  // and players are unaffected. The DB is the authoritative gate (place_bet +
  // block_operator_bets trigger); this only keeps the UI honest.
  const isOperator = profile?.role === 'admin' || profile?.role === 'super_admin';

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
  } = useGame(profile, balance, onRefreshWallet);

  // Demo sandbox consumes the authoritative round lifecycle and settles play
  // money locally. It is always mounted so its balance persists across mode
  // toggles; it only drives the panels when isDemo is true.
  const demo = useDemoBets({ status: gameStatus, multiplier: currentMultiplier, roundId: currentRound?.id ?? null });

  // The betting surface fed to the panels switches with the mode. The round
  // lifecycle, canvas, history and live board ALWAYS come from the real game.
  const panelBalance = isDemo ? demo.balance : balance;
  const panelActiveBets = isDemo ? demo.activeBets : activeBets;
  const panelPlaceBet = isDemo ? demo.placeBet : placeBet;
  const panelCashOut = isDemo ? demo.cashOut : cashOut;
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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d0d1a]">
      {/* History strip */}
      <div className="flex-shrink-0 bg-[#0d0d1a] border-b border-[#2a2a45] overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-1 px-3 py-1.5 min-w-max">
          <GameHistory history={history} />
        </div>
      </div>

      {/* Main body */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: Live Bets (lg+) ──────────────────────────────────── */}
        <div className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-[#0d0d1a] border-r border-[#2a2a45]">
          <div className="flex border-b border-[#2a2a45] flex-shrink-0">
            {(['allBets', 'previous', 'top'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-[11px] font-semibold transition-colors ${
                  activeTab === tab ? 'text-white border-b-2 border-[#c8001c]' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab === 'allBets' ? 'All Bets' : tab === 'previous' ? 'Previous' : 'Top'}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a45] flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {liveBets.slice(0, 3).map((b, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-[#0d0d1a] flex items-center justify-center text-white text-[8px] font-bold" style={{ backgroundColor: b.avatar_color }}>
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

          <div className="grid px-3 py-1 text-[10px] text-slate-500 border-b border-[#2a2a45]/50 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto auto auto' }}>
            <span>Player</span>
            <span className="px-2">Bet</span>
            <span className="px-2 text-center">X</span>
            <span className="text-right">Win</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <LiveBetsTable bets={liveBets} status={gameStatus} />
          </div>
        </div>

        {/* ── Center: Canvas + Betting ───────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">

          {/* Canvas - takes most vertical space */}
          <div className="relative flex-1 min-h-0 bg-[#111118] overflow-hidden">
            <GameCanvas
              status={gameStatus}
              multiplier={currentMultiplier}
              getMultiplier={getMultiplier}
              crashPoint={crashPoint}
            />

            {/* Multiplier / countdown */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              {gameStatus === 'flying' && (
                <div className="text-center" style={{ marginTop: '8%' }}>
                  <div
                    className="font-black tabular-nums"
                    style={{
                      color: '#ffffff',
                      fontSize: 'clamp(2.2rem, 10vw, 5.5rem)',
                      textShadow: '0 0 40px rgba(255,255,255,0.4), 0 2px 8px rgba(0,0,0,0.8)',
                      lineHeight: 1,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {formatMultiplier(currentMultiplier)}
                  </div>
                  {anyActiveInFlight && (
                    <div className="text-green-400 text-sm mt-2 font-black animate-pulse tracking-wide">
                      CASH OUT NOW!
                    </div>
                  )}
                </div>
              )}

              {gameStatus === 'waiting' && (
                <div className="text-center" style={{ marginTop: '8%' }}>
                  <div
                    className="font-black text-white tabular-nums"
                    style={{ fontSize: 'clamp(2.2rem, 10vw, 5rem)', lineHeight: 1 }}
                  >
                    {countdown}
                  </div>
                  <div className="text-slate-400 text-xs mt-1.5 tracking-widest uppercase font-semibold">
                    Starting in...
                  </div>
                  {anyBetThisRound && (
                    <div className="mt-2 px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-amber-400 text-xs font-semibold">
                      Bet in - ready!
                    </div>
                  )}
                </div>
              )}
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
              <span className="text-slate-300 text-[10px] font-semibold">{Math.max(liveBets.length, 107)}</span>
            </div>

            {/* Low-balance psychology nudge */}
            {nudge && profile && (
              <div className="absolute inset-x-3 bottom-12 z-20 md:left-1/2 md:-translate-x-1/2 md:w-80">
                <div className="bg-gradient-to-br from-[#c8001c] to-[#ff2200] rounded-2xl p-4 shadow-2xl shadow-red-900/60 text-white">
                  <div className="font-black text-base leading-tight">{nudge.title}</div>
                  <div className="text-xs mt-1 opacity-90">{nudge.sub}</div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setNudge(null); onDepositOpen(); }}
                      className="flex-1 py-2.5 bg-white text-[#c8001c] rounded-xl text-sm font-black hover:bg-gray-100 transition active:scale-95"
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

          {/* Operator notice: admins/super_admins manage the platform and cannot
              wager with real money. They may still practise in Demo mode. */}
          {panelOperatorLock && (
            <div className="flex-shrink-0 border-t border-[#2a2a45] bg-amber-500/10 px-4 py-2 text-center text-amber-300 text-[11px] font-semibold">
              You are signed in as an operator. Operator accounts cannot place real bets - switch to Demo to practise.
            </div>
          )}

          {/* Real / Demo mode toggle */}
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-[#2a2a45] bg-[#0d0d1a] px-3 py-1.5">
            <div className="flex bg-[#1a1a2e] rounded-full p-0.5" role="tablist" aria-label="Play mode">
              {(['real', 'demo'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-4 py-1 text-xs font-bold rounded-full transition-all ${
                    mode === m
                      ? (m === 'demo' ? 'bg-[#1d4ed8] text-white' : 'bg-[#22c55e] text-white')
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'real' ? 'Real' : 'Demo'}
                </button>
              ))}
            </div>

            {isDemo ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Demo balance</span>
                <span className="text-sm font-bold tabular-nums text-[#60a5fa]">
                  KSh {panelBalance.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
                </span>
                <button
                  onClick={demo.reset}
                  title={`Reset to KSh ${DEMO_STARTING_BALANCE.toLocaleString('en-KE')}`}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#1a1a2e] border border-[#2a2a45] text-slate-300 text-[10px] font-semibold hover:text-white hover:border-[#3a3a55] transition active:scale-95"
                >
                  <RotateCcw size={11} /> Reset
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-slate-500 font-medium hidden sm:block">Practise risk-free in Demo</span>
            )}
          </div>

          {/* Betting panels - two independent dual-bet slots (1 and 2) */}
          <div className="flex flex-shrink-0 border-t border-[#2a2a45] bg-[#0d0d1a]">
            <div className="flex-1 border-r border-[#2a2a45]">
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
            <div className="flex-1">
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

          {/* Mobile bottom tab: Bets / Chat */}
          <div className="lg:hidden flex border-t border-[#2a2a45] bg-[#0d0d1a] flex-shrink-0">
            <button
              onClick={() => setMobileTab('bets')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                mobileTab === 'bets' ? 'text-white border-t-2 border-[#c8001c]' : 'text-slate-500'
              }`}
            >
              <Users size={14} />
              <span>Bets ({liveBets.length})</span>
            </button>
            <button
              onClick={() => setMobileTab('chat')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                mobileTab === 'chat' ? 'text-white border-t-2 border-[#c8001c]' : 'text-slate-500'
              }`}
            >
              <MessageSquare size={14} />
              <span>Chat</span>
            </button>
          </div>

          {/* Mobile panel - 220px high */}
          <div className="lg:hidden flex-shrink-0 bg-[#0d0d1a]" style={{ height: '200px' }}>
            {mobileTab === 'bets' ? (
              <div className="h-full overflow-y-auto scrollbar-thin">
                <LiveBetsTable bets={liveBets} status={gameStatus} />
              </div>
            ) : (
              <div className="h-full">
                <Chat userId={profile?.id} username={profile?.username} avatarColor={profile?.avatar_color} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Live Chat (xl+) ────────────────────────────────── */}
        <div className="hidden xl:flex flex-col w-60 flex-shrink-0 bg-[#0d0d1a] border-l border-[#2a2a45]">
          <Chat userId={profile?.id} username={profile?.username} avatarColor={profile?.avatar_color} />
        </div>
      </div>
    </div>
  );
}
