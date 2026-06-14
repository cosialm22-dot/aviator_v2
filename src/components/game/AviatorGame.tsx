import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Users } from 'lucide-react';
import GameCanvas from './GameCanvas';
import BettingPanel, { type QueuedBet } from './BettingPanel';
import LiveBetsTable from './LiveBetsTable';
import GameHistory from './GameHistory';
import Chat from './Chat';
import { useGame } from '../../hooks/useGame';
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
  const [queuedBet, setQueuedBet] = useState<QueuedBet | null>(null);
  const balance = wallet?.balance ?? 0;
  // Operators (admin/super_admin) run the platform and must never wager. Marketers
  // and players are unaffected. The DB is the authoritative gate (place_bet +
  // block_operator_bets trigger); this only keeps the UI honest.
  const isOperator = profile?.role === 'admin' || profile?.role === 'super_admin';

  const {
    gameStatus,
    currentMultiplier,
    getMultiplier,
    history,
    activeBet,
    liveBets,
    countdown,
    crashPoint,
    placeBet,
    cashOut,
  } = useGame(profile, balance, onRefreshWallet);

  // Psychology nudge: low balance after a crash
  useEffect(() => {
    if (!profile) return;
    if (balance < 50 && balance >= 0 && !nudgeShownRef.current && gameStatus === 'crashed') {
      nudgeShownRef.current = true;
      const msg = LOW_BALANCE_NUDGES[Math.floor(Math.random() * LOW_BALANCE_NUDGES.length)];
      setNudge(msg);
    }
    if (balance >= 50) {
      nudgeShownRef.current = false;
      setNudge(null);
    }
  }, [balance, profile, gameStatus]);

  // Auto-place queued bet when waiting phase begins (never for operators).
  useEffect(() => {
    if (!isOperator && gameStatus === 'waiting' && queuedBet && !activeBet) {
      placeBet(queuedBet.amount, queuedBet.autoCashout).then(() => setQueuedBet(null)).catch(() => setQueuedBet(null));
    }
  }, [gameStatus, queuedBet, activeBet, placeBet, isOperator]);

  const handleQueueBet = (amount: number, autoCashout: number | null) => {
    setQueuedBet({ amount, autoCashout });
  };

  const handleCancelQueue = () => {
    setQueuedBet(null);
  };

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
                  {activeBet && activeBet.status === 'active' && (
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
                  {activeBet && (
                    <div className="mt-2 px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-amber-400 text-xs font-semibold">
                      Bet in - ready!
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Cashout toast */}
            {activeBet?.status === 'won' && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-green-500 text-white font-bold px-4 py-2 rounded-full text-sm shadow-lg shadow-green-500/40 z-20 whitespace-nowrap">
                +KSh {(activeBet.winnings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} @ {(activeBet.cashout_multiplier ?? currentMultiplier).toFixed(2)}×
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

          {/* Operator notice: admins/super_admins manage the platform and cannot wager. */}
          {isOperator && (
            <div className="flex-shrink-0 border-t border-[#2a2a45] bg-amber-500/10 px-4 py-2 text-center text-amber-300 text-[11px] font-semibold">
              You are signed in as an operator. Operator accounts cannot place bets.
            </div>
          )}

          {/* Betting panels */}
          <div className="flex flex-shrink-0 border-t border-[#2a2a45] bg-[#0d0d1a]">
            <div className="flex-1 border-r border-[#2a2a45]">
              <BettingPanel
                panelIndex={0}
                status={gameStatus}
                multiplier={currentMultiplier}
                balance={balance}
                activeBet={activeBet}
                queuedBet={queuedBet}
                onPlaceBet={placeBet}
                onQueueBet={handleQueueBet}
                onCancelQueue={handleCancelQueue}
                onCashOut={cashOut}
                onAuthRequired={onAuthRequired}
                isAuthenticated={!!profile}
                isOperator={isOperator}
              />
            </div>
            <div className="flex-1">
              <BettingPanel
                panelIndex={1}
                status={gameStatus}
                multiplier={currentMultiplier}
                balance={balance}
                activeBet={null}
                queuedBet={null}
                onPlaceBet={async () => {}}
                onQueueBet={() => {}}
                onCancelQueue={() => {}}
                onCashOut={() => {}}
                onAuthRequired={onAuthRequired}
                isAuthenticated={!!profile}
                isOperator={isOperator}
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
