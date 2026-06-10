import { useState, useRef } from 'react';
import { Minus, Plus, Zap, Clock, X } from 'lucide-react';
import type { GameStatus } from '../../types';
import { formatMultiplier } from '../../lib/gameEngine';

interface Props {
  panelIndex: number;
  status: GameStatus;
  multiplier: number;
  balance: number;
  activeBet: { amount: number; cashedOut: boolean; winnings: number | null; cashout_multiplier?: number; cashoutAt: number | null } | null;
  onPlaceBet: (amount: number, autoCashoutAt: number | null) => Promise<void>;
  onCashOut: () => void;
  onAuthRequired: () => void;
  isAuthenticated: boolean;
  queuedBet?: { amount: number; autoCashoutAt: number | null } | null;
  onCancelQueuedBet?: () => void;
}

const MIN_BET = 50;
const QUICK_AMOUNTS = [50, 100, 200, 500];

export default function BettingPanel({
  panelIndex, status, multiplier, balance, activeBet,
  onPlaceBet, onCashOut, onAuthRequired, isAuthenticated,
  queuedBet, onCancelQueuedBet,
}: Props) {
  const [rawAmount, setRawAmount] = useState(String(MIN_BET));
  const [autoMode, setAutoMode]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const amount = Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET));
  // Allow betting during waiting, flying, or crashed (queued for next round)
  const canBetWaiting = status === 'waiting' && !activeBet && amount >= MIN_BET && amount <= balance;
  const canBetQueued = (status === 'flying' || status === 'crashed') && !activeBet && !queuedBet && amount >= MIN_BET && amount <= balance;
  const canBet = canBetWaiting || canBetQueued;

  const handleBet = async () => {
    if (!isAuthenticated) { onAuthRequired(); return; }
    if (!canBet) return;
    setLoading(true);
    try { await onPlaceBet(amount, null); } finally { setLoading(false); }
  };

  const adjust = (delta: number) => {
    const next = Math.max(MIN_BET, amount + delta);
    setRawAmount(String(next));
  };

  const handleRawChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '');
    setRawAmount(clean === '' ? '' : String(parseInt(clean, 10) || ''));
  };

  const handleBlur = () => {
    const n = parseFloat(rawAmount) || MIN_BET;
    setRawAmount(String(Math.max(MIN_BET, Math.floor(n))));
  };

  const winnings = activeBet && !activeBet.cashedOut
    ? Math.floor(activeBet.amount * multiplier * 100) / 100
    : activeBet?.winnings ?? 0;

  const isCashable = status === 'flying' && activeBet && !activeBet.cashedOut && panelIndex === 0;

  const betLabel = () => {
    if (queuedBet) return 'Queued';
    if (status === 'flying' && !activeBet && !queuedBet)  return 'Bet Next';
    if (status === 'flying' && activeBet)  return panelIndex === 0 ? 'In flight' : 'Watching';
    if (status === 'crashed' && !queuedBet) return 'Bet Next';
    if (status === 'crashed') return 'Next round';
    return loading ? 'Placing...' : 'Bet';
  };

  return (
    <div className="flex flex-col bg-[#0d0d1a] select-none">
      {/* Queued bet notification banner */}
      {queuedBet && panelIndex === 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-amber-400" />
            <span className="text-[11px] text-amber-300 font-medium">
              KSh {queuedBet.amount.toLocaleString('en-KE')} queued for next round
            </span>
          </div>
          <button
            onClick={onCancelQueuedBet}
            className="text-amber-400 hover:text-white transition p-0.5 rounded hover:bg-amber-500/20"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Bet / Auto tabs */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className="flex bg-[#1a1a2e] rounded-full p-0.5">
          {(['Bet', 'Auto'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setAutoMode(tab === 'Auto')}
              className={`px-4 py-1 text-xs font-semibold rounded-full transition-all ${
                (tab === 'Auto') === autoMode
                  ? 'bg-[#2a2a45] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Amount stepper + action button */}
      <div className="flex items-stretch gap-2 px-3 pb-2">
        {/* Editable amount field with +/- */}
        <div className="flex items-center bg-[#1a1a2e] rounded-lg border border-[#2a2a45] flex-shrink-0">
          <button
            onClick={() => adjust(-50)}
            disabled={!!activeBet || !!queuedBet || amount <= MIN_BET}
            className="w-9 h-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#2a2a45] rounded-l-lg transition disabled:opacity-40 active:scale-95"
          >
            <Minus size={14} />
          </button>

          <div
            className="flex flex-col items-center justify-center px-1 h-11 min-w-[62px] cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              value={rawAmount}
              onChange={e => handleRawChange(e.target.value)}
              onBlur={handleBlur}
              disabled={!!activeBet || !!queuedBet}
              className="w-full bg-transparent text-white font-bold text-sm tabular-nums text-center leading-none focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-slate-500 text-[9px] leading-none mt-0.5">KShs</span>
          </div>

          <button
            onClick={() => adjust(50)}
            disabled={!!activeBet || !!queuedBet}
            className="w-9 h-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#2a2a45] rounded-r-lg transition disabled:opacity-40 active:scale-95"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Action button */}
        {isCashable ? (
          <button
            onClick={onCashOut}
            className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-white font-black transition-all active:scale-95 shadow-lg shadow-green-500/30"
          >
            <div className="flex items-center gap-1 text-sm leading-tight">
              <Zap size={14} className="fill-current" />
              <span>Cash Out</span>
            </div>
            <div className="text-xs font-semibold opacity-90">
              KSh {winnings.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
            </div>
          </button>
        ) : activeBet && !activeBet.cashedOut && panelIndex === 0 ? (
          <button disabled className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-amber-600/80 text-white font-black cursor-not-allowed">
            <span className="text-sm leading-tight">Flying...</span>
            <span className="text-xs opacity-90">KSh {activeBet.amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
          </button>
        ) : activeBet?.cashedOut && panelIndex === 0 ? (
          <button disabled className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-green-900/40 border border-green-500/40 text-green-400 font-black cursor-not-allowed">
            <span className="text-sm">Cashed Out!</span>
            <span className="text-xs">+KSh {(activeBet.winnings ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
          </button>
        ) : queuedBet && panelIndex === 0 ? (
          <button
            onClick={onCancelQueuedBet}
            className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-amber-600/30 border border-amber-500/40 text-amber-300 font-black transition-all active:scale-95 hover:bg-amber-600/40"
          >
            <div className="flex items-center gap-1 text-sm leading-tight">
              <Clock size={14} />
              <span>Queued</span>
            </div>
            <span className="text-[10px] font-medium opacity-80">Tap to cancel</span>
          </button>
        ) : (
          <button
            onClick={handleBet}
            disabled={!canBet || loading || (panelIndex === 0 && !!activeBet)}
            className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl font-black transition-all active:scale-95 ${
              canBet && !loading && !(panelIndex === 0 && !!activeBet)
                ? (status === 'flying' || status === 'crashed')
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30'
                  : 'bg-[#22c55e] hover:bg-[#16a34a] text-white shadow-lg shadow-green-500/30'
                : 'bg-[#22c55e]/20 text-white/40 cursor-not-allowed'
            }`}
          >
            <span className="text-sm leading-tight">{betLabel()}</span>
            <span className="text-xs font-semibold opacity-90">
              {canBet ? `KSh ${amount.toLocaleString('en-KE')}` : ''}
            </span>
          </button>
        )}
      </div>

      {/* Quick amounts */}
      <div className="flex gap-1.5 px-3 pb-2.5">
        {QUICK_AMOUNTS.map(q => (
          <button
            key={q}
            onClick={() => setRawAmount(String(q))}
            disabled={!!activeBet || !!queuedBet}
            className="flex-1 py-1 text-[11px] font-semibold bg-[#1a1a2e] border border-[#2a2a45] rounded text-slate-400 hover:text-white hover:bg-[#2a2a45] transition disabled:opacity-40 active:scale-95"
          >
            {q >= 1000 ? `${q / 1000}K` : q}
          </button>
        ))}
      </div>

      {/* Cashout confirmation row */}
      {activeBet?.cashedOut && panelIndex === 0 && (
        <div className="px-3 pb-2 text-center text-green-400 text-[11px] font-semibold">
          +KSh {(activeBet.winnings ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} @ {formatMultiplier(activeBet.cashout_multiplier ?? multiplier)}
        </div>
      )}
    </div>
  );
}
