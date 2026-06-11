import { useState, useRef } from 'react';
import { Minus, Plus, Zap, Clock } from 'lucide-react';
import type { GameStatus } from '../../types';
import { formatMultiplier } from '../../lib/gameEngine';

interface Props {
  panelIndex: number;
  status: GameStatus;
  multiplier: number;
  balance: number;
  activeBet: { amount: number; cashedOut: boolean; winnings: number | null; cashout_multiplier?: number; cashoutAt: number | null } | null;
  queuedBet: number | null; // NEW: queued bet amount for next round
  onPlaceBet: (amount: number, autoCashoutAt: number | null) => Promise<void>;
  onQueueBet: (amount: number) => void; // NEW: queue bet for next round
  onCancelQueue: () => void; // NEW: cancel queued bet
  onCashOut: () => void;
  onAuthRequired: () => void;
  isAuthenticated: boolean;
}

const MIN_BET = 50;
const QUICK_AMOUNTS = [50, 100, 200, 500];

export default function BettingPanel({
  panelIndex, status, multiplier, balance, activeBet, queuedBet,
  onPlaceBet, onQueueBet, onCancelQueue, onCashOut, onAuthRequired, isAuthenticated,
}: Props) {
  const [rawAmount, setRawAmount] = useState(String(MIN_BET));
  const [autoMode, setAutoMode]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const amount = Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET));

  // Can place bet during waiting OR queue during flight/crashed
  const canBetNow = status === 'waiting' && !activeBet && !queuedBet && amount >= MIN_BET && amount <= balance;
  const canQueueBet = (status === 'flying' || status === 'crashed') && !activeBet && !queuedBet && amount >= MIN_BET && amount <= balance;

  const handleBet = async () => {
    if (!isAuthenticated) { onAuthRequired(); return; }

    // During waiting: place bet immediately
    if (canBetNow) {
      setLoading(true);
      try { await onPlaceBet(amount, null); } finally { setLoading(false); }
      return;
    }

    // During flying/crashed: queue bet for next round
    if (canQueueBet) {
      onQueueBet(amount);
    }
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

  // Determine button state and label
  const getButtonConfig = () => {
    // Queued bet: show "Queued" with cancel option
    if (queuedBet) {
      return {
        label: 'Queued for next',
        sublabel: `KSh ${queuedBet.toLocaleString('en-KE')}`,
        action: onCancelQueue,
        style: 'bg-amber-600/80 text-white cursor-pointer hover:bg-amber-700',
        icon: Clock,
        disabled: false,
      };
    }

    // Active bet flying: show in-flight status
    if (activeBet && !activeBet.cashedOut && status === 'flying' && panelIndex === 0) {
      return {
        label: 'Flying...',
        sublabel: `KSh ${activeBet.amount.toLocaleString('en-KE')}`,
        action: () => {},
        style: 'bg-amber-600/80 text-white cursor-not-allowed',
        disabled: true,
      };
    }

    // Cashed out: show result
    if (activeBet?.cashedOut && panelIndex === 0) {
      return {
        label: 'Cashed Out!',
        sublabel: `+KSh ${(activeBet.winnings ?? 0).toLocaleString('en-KE')}`,
        action: () => {},
        style: 'bg-green-900/40 border border-green-500/40 text-green-400 cursor-not-allowed',
        disabled: true,
      };
    }

    // Can bet now (waiting)
    if (canBetNow) {
      return {
        label: loading ? 'Placing...' : 'Bet',
        sublabel: `KSh ${amount.toLocaleString('en-KE')}`,
        action: handleBet,
        style: 'bg-[#22c55e] hover:bg-[#16a34a] text-white shadow-lg shadow-green-500/30',
        disabled: loading,
      };
    }

    // Can queue (flying/crashed, no active bet)
    if (canQueueBet) {
      return {
        label: 'Bet Next Round',
        sublabel: `KSh ${amount.toLocaleString('en-KE')}`,
        action: handleBet,
        style: 'bg-[#22c55e]/80 hover:bg-[#22c55e] text-white',
        icon: Clock,
        disabled: false,
      };
    }

    // Default: disabled
    return {
      label: status === 'flying' ? 'In flight' : 'Next round',
      sublabel: '',
      action: () => {},
      style: 'bg-[#22c55e]/20 text-white/40 cursor-not-allowed',
      disabled: true,
    };
  };

  const btnConfig = getButtonConfig();

  return (
    <div className="flex flex-col bg-[#0d0d1a] select-none">
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
        ) : (
          <button
            onClick={btnConfig.action}
            disabled={btnConfig.disabled}
            className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl font-black transition-all active:scale-95 ${btnConfig.style}`}
          >
            <div className="flex items-center gap-1 text-sm leading-tight">
              {btnConfig.icon && <btnConfig.icon size={13} />}
              <span>{btnConfig.label}</span>
            </div>
            {btnConfig.sublabel && (
              <div className="text-xs font-semibold opacity-90">{btnConfig.sublabel}</div>
            )}
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

      {/* Queued bet indicator */}
      {queuedBet && (
        <div className="px-3 pb-2 flex items-center justify-center gap-2">
          <Clock size={11} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-semibold">Queued: KSh {queuedBet.toLocaleString('en-KE')} for next round</span>
          <button onClick={onCancelQueue} className="text-[10px] text-slate-400 hover:text-red-400 underline">Cancel</button>
        </div>
      )}

      {/* Cashout confirmation row */}
      {activeBet?.cashedOut && panelIndex === 0 && (
        <div className="px-3 pb-2 text-center text-green-400 text-[11px] font-semibold">
          +KSh {(activeBet.winnings ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} @ {formatMultiplier(activeBet.cashout_multiplier ?? multiplier)}
        </div>
      )}
    </div>
  );
}
