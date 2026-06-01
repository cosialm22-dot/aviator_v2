import { useState } from 'react';
import { Minus, Plus, Zap } from 'lucide-react';
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
}

const MIN_BET = 50;
const QUICK_AMOUNTS = [50, 100, 200, 500];

export default function BettingPanel({
  panelIndex,
  status, multiplier, balance, activeBet,
  onPlaceBet, onCashOut, onAuthRequired, isAuthenticated,
}: Props) {
  const [amount, setAmount] = useState(MIN_BET);
  const [autoMode, setAutoMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const canBet = status === 'waiting' && !activeBet && amount >= MIN_BET && amount <= balance;
  const canCashOut = status === 'flying' && activeBet && !activeBet.cashedOut;

  const handleBet = async () => {
    if (!isAuthenticated) { onAuthRequired(); return; }
    if (!canBet) return;
    setLoading(true);
    try {
      await onPlaceBet(amount, null);
    } finally {
      setLoading(false);
    }
  };

  const decrement = () => setAmount(v => Math.max(MIN_BET, v - 50));
  const increment = () => setAmount(v => v + 50);

  const winnings = activeBet && !activeBet.cashedOut
    ? Math.floor(activeBet.amount * multiplier * 100) / 100
    : activeBet?.winnings ?? 0;

  const isCashable = canCashOut && panelIndex === 0;

  const betLabel = () => {
    if (status === 'flying') return panelIndex === 0 ? 'Round in progress' : 'Watching...';
    if (status === 'crashed') return 'Crashed — next round soon';
    return loading ? 'Placing...' : 'Bet';
  };

  return (
    <div className="flex flex-col bg-[#0d0d1a] select-none">
      {/* Bet / Auto tabs */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className="flex bg-[#1a1a2e] rounded-full p-0.5">
          <button
            onClick={() => setAutoMode(false)}
            className={`px-4 py-1 text-xs font-semibold rounded-full transition-all ${
              !autoMode ? 'bg-[#2a2a45] text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Bet
          </button>
          <button
            onClick={() => setAutoMode(true)}
            className={`px-4 py-1 text-xs font-semibold rounded-full transition-all ${
              autoMode ? 'bg-[#2a2a45] text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Auto
          </button>
        </div>
        {panelIndex === 1 && (
          <div className="ml-auto w-5 h-5 rounded bg-[#1a1a2e] flex items-center justify-center text-slate-500 text-xs">—</div>
        )}
      </div>

      {/* Amount stepper + action button */}
      <div className="flex items-stretch gap-2 px-3 pb-2">
        <div className="flex items-center bg-[#1a1a2e] rounded-lg border border-[#2a2a45] flex-shrink-0">
          <button
            onClick={decrement}
            disabled={!!activeBet || amount <= MIN_BET}
            className="w-9 h-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#2a2a45] rounded-l-lg transition disabled:opacity-40 active:scale-95"
          >
            <Minus size={14} />
          </button>
          <div className="px-2 h-11 flex flex-col items-center justify-center min-w-[60px]">
            <span className="text-white font-bold text-sm tabular-nums leading-none">
              {amount.toLocaleString()}
            </span>
            <span className="text-slate-500 text-[9px] leading-none mt-0.5">KShs</span>
          </div>
          <button
            onClick={increment}
            disabled={!!activeBet}
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
              KSh {winnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </button>
        ) : activeBet && !activeBet.cashedOut && panelIndex === 0 ? (
          <button disabled className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-amber-600 text-white font-black cursor-not-allowed">
            <span className="text-sm leading-tight">Flying...</span>
            <span className="text-xs opacity-90">KSh {activeBet.amount.toLocaleString()}</span>
          </button>
        ) : activeBet?.cashedOut && panelIndex === 0 ? (
          <button disabled className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-green-900/40 border border-green-500/40 text-green-400 font-black cursor-not-allowed">
            <span className="text-sm">Cashed Out!</span>
            <span className="text-xs">+KSh {(activeBet.winnings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </button>
        ) : (
          <button
            onClick={handleBet}
            disabled={status !== 'waiting' || loading || (panelIndex === 0 && !!activeBet)}
            className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl font-black transition-all active:scale-95 ${
              status === 'waiting' && !loading && !(panelIndex === 0 && !!activeBet)
                ? 'bg-[#22c55e] hover:bg-[#16a34a] text-white shadow-lg shadow-green-500/30'
                : 'bg-[#22c55e]/30 text-white/40 cursor-not-allowed'
            }`}
          >
            <span className="text-sm leading-tight">{betLabel()}</span>
            <span className="text-xs font-semibold opacity-90">KSh {amount.toLocaleString()}</span>
          </button>
        )}
      </div>

      {/* Quick amounts */}
      <div className="flex gap-1.5 px-3 pb-2.5">
        {QUICK_AMOUNTS.map(q => (
          <button
            key={q}
            onClick={() => setAmount(q)}
            disabled={!!activeBet}
            className="flex-1 py-1 text-[11px] font-semibold bg-[#1a1a2e] border border-[#2a2a45] rounded text-slate-400 hover:text-white hover:bg-[#2a2a45] transition disabled:opacity-40 active:scale-95"
          >
            {q >= 1000 ? `${q / 1000}K` : q}
          </button>
        ))}
      </div>

      {/* Cashout details (panel 0 only) */}
      {activeBet?.cashedOut && panelIndex === 0 && (
        <div className="px-3 pb-2 text-center text-green-400 text-[11px] font-semibold">
          Won KSh {(activeBet.winnings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} @ {formatMultiplier(activeBet.cashout_multiplier ?? multiplier)}
        </div>
      )}
    </div>
  );
}
