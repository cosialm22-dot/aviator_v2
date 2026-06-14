import { useState, useRef } from 'react';
import { Minus, Plus, Zap, Clock, Play, Square } from 'lucide-react';
import type { GameStatus } from '../../types';
import { formatMultiplier } from '../../lib/gameEngine';
import type { ActiveBet } from '../../hooks/useGame';
import { useAutoBet, type AutoBetConfig } from '../../hooks/useAutoBet';

// A bet queued for the next round. Carries the auto-cashout target (if any) so a
// bet queued in Auto mode is placed next round with the same target the player
// configured (the server settles it via _settle_flight). null = manual cashout.
export interface QueuedBet {
  amount: number;
  autoCashout: number | null;
}

interface Props {
  // 0-based panel index used only for keys/labels. Both panels are fully
  // functional and symmetric; the parent binds each to a distinct server bet
  // slot via onPlaceBet / onCashOut, so dual-bet is real on both sides.
  panelIndex: number;
  status: GameStatus;
  multiplier: number;
  balance: number;
  activeBet: ActiveBet | null;
  queuedBet: QueuedBet | null;
  onPlaceBet: (amount: number, autoCashoutAt: number | null) => Promise<void>;
  onQueueBet: (amount: number, autoCashoutAt: number | null) => void;
  onCancelQueue: () => void;
  onCashOut: () => void;
  onAuthRequired: () => void;
  isAuthenticated: boolean;
  // True for admin/super_admin accounts. Operators run the platform and must
  // never wager (enforced authoritatively by the DB place_bet guard + the
  // block_operator_bets trigger); this disables the controls so they never hit
  // a server rejection. Marketers and players are NOT operators and play freely.
  isOperator?: boolean;
}

const MIN_BET = 50;
const QUICK_AMOUNTS = [50, 100, 200, 500];
const MIN_AUTO = 1.01;          // auto-cashout must be strictly above 1.00x (server enforces too)
const DEFAULT_AUTO = '2.00';

// Auto-bet sequencing inputs (0 = "off" for the stop thresholds).
const AUTO_FIELDS: { key: keyof AutoBetConfig; label: string; min: number; hint: string }[] = [
  { key: 'rounds', label: 'Rounds', min: 1, hint: 'Number of bets to place automatically' },
  { key: 'stopLoss', label: 'Stop loss', min: 0, hint: 'Stop when net loss reaches this (KSh, 0 = off)' },
  { key: 'stopWin', label: 'Stop win', min: 0, hint: 'Stop when net profit reaches this (KSh, 0 = off)' },
];

export default function BettingPanel({
  panelIndex, status, multiplier, balance, activeBet, queuedBet,
  onPlaceBet, onQueueBet, onCancelQueue, onCashOut, onAuthRequired, isAuthenticated,
  isOperator = false,
}: Props) {
  const [rawAmount, setRawAmount] = useState(String(MIN_BET));
  const [autoMode, setAutoMode]   = useState(false);
  const [autoStr, setAutoStr]     = useState(DEFAULT_AUTO);
  const [loading, setLoading]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const amount = Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET));

  // Auto-cashout target (2dp). Only meaningful in Auto mode; must be > 1.00x.
  const parsedAuto = Math.round((parseFloat(autoStr) || 0) * 100) / 100;
  const autoValid = !autoMode || parsedAuto > 1.0;
  const autoTarget = autoMode ? parsedAuto : null;

  // Auto-bet sequencer for THIS panel/slot (settlement stays server-authoritative).
  const autoBet = useAutoBet({ status, activeBet, balance, isOperator, placeBet: onPlaceBet });
  const showAutoBet = autoMode && !isOperator;

  // amount/target are immutable once a bet is committed, queued, or a sequence runs
  const locked = !!activeBet || !!queuedBet || autoBet.running;

  // Can place bet during waiting OR queue during flight/crashed
  const canBetNow = status === 'waiting' && !locked && autoValid && amount >= MIN_BET && amount <= balance;
  const canQueueBet = (status === 'flying' || status === 'crashed') && !locked && autoValid && amount >= MIN_BET && amount <= balance;

  const handleBet = async () => {
    if (isOperator) return; // operators cannot wager (see Props.isOperator)
    if (!isAuthenticated) { onAuthRequired(); return; }

    // During waiting: place bet immediately
    if (canBetNow) {
      setLoading(true);
      try { await onPlaceBet(amount, autoTarget); } finally { setLoading(false); }
      return;
    }

    // During flying/crashed: queue bet (with its auto target) for next round
    if (canQueueBet) {
      onQueueBet(amount, autoTarget);
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

  const adjustAuto = (delta: number) => {
    const next = Math.max(MIN_AUTO, Math.round((parsedAuto + delta) * 100) / 100);
    setAutoStr(next.toFixed(2));
  };
  const handleAutoBlur = () => {
    const n = parseFloat(autoStr);
    setAutoStr((Number.isFinite(n) && n > 1.0 ? n : Number(DEFAULT_AUTO)).toFixed(2));
  };

  const winnings = activeBet && activeBet.status === 'active'
    ? Math.floor(activeBet.amount * multiplier * 100) / 100
    : activeBet?.winnings ?? 0;

  const isCashable = !isOperator && status === 'flying' && activeBet?.status === 'active';

  // Determine button state and label
  const getButtonConfig = () => {
    // Operator accounts (admin/super_admin) may never wager.
    if (isOperator) {
      return {
        label: 'Operators can\u2019t bet',
        sublabel: '',
        action: () => {},
        style: 'bg-[#1a1a2e] border border-[#2a2a45] text-white/40 cursor-not-allowed',
        disabled: true,
      };
    }

    // Queued bet: show "Queued" with cancel option
    if (queuedBet) {
      return {
        label: 'Queued for next',
        sublabel: `KSh ${queuedBet.amount.toLocaleString('en-KE')}${queuedBet.autoCashout ? ` @ ${queuedBet.autoCashout.toFixed(2)}x` : ''}`,
        action: onCancelQueue,
        style: 'bg-amber-600/80 text-white cursor-pointer hover:bg-amber-700',
        icon: Clock,
        disabled: false,
      };
    }

    // Active bet flying: panel shows the Cash Out button separately (isCashable)
    if (activeBet?.status === 'active' && status === 'flying') {
      return {
        label: 'Flying...',
        sublabel: `KSh ${activeBet.amount.toLocaleString('en-KE')}`,
        action: () => {},
        style: 'bg-amber-600/80 text-white cursor-not-allowed',
        disabled: true,
      };
    }

    // Cashed out: show result
    if (activeBet?.status === 'won') {
      return {
        label: 'Cashed Out!',
        sublabel: `+KSh ${(activeBet.winnings ?? 0).toLocaleString('en-KE')}`,
        action: () => {},
        style: 'bg-green-900/40 border border-green-500/40 text-green-400 cursor-not-allowed',
        disabled: true,
      };
    }

    // Invalid auto target while in Auto mode
    if (autoMode && !autoValid && (status === 'waiting' || status === 'flying' || status === 'crashed') && !locked) {
      return {
        label: 'Set auto \u2265 1.01x',
        sublabel: '',
        action: () => {},
        style: 'bg-[#22c55e]/20 text-white/40 cursor-not-allowed',
        disabled: true,
      };
    }

    // Can bet now (waiting)
    if (canBetNow) {
      return {
        label: loading ? 'Placing...' : 'Bet',
        sublabel: `KSh ${amount.toLocaleString('en-KE')}${autoTarget ? ` @ ${autoTarget.toFixed(2)}x` : ''}`,
        action: handleBet,
        style: 'bg-[#22c55e] hover:bg-[#16a34a] text-white shadow-lg shadow-green-500/30',
        disabled: loading,
      };
    }

    // Can queue (flying/crashed, no active bet)
    if (canQueueBet) {
      return {
        label: 'Bet Next Round',
        sublabel: `KSh ${amount.toLocaleString('en-KE')}${autoTarget ? ` @ ${autoTarget.toFixed(2)}x` : ''}`,
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
  const autoFieldId = (key: string) => `autobet-${panelIndex}-${key}`;

  return (
    <div className="flex flex-col bg-[#0d0d1a] select-none">
      {/* Bet / Auto tabs */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className="flex bg-[#1a1a2e] rounded-full p-0.5">
          {(['Bet', 'Auto'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setAutoMode(tab === 'Auto')}
              disabled={isOperator || locked}
              className={`px-4 py-1 text-xs font-semibold rounded-full transition-all disabled:opacity-50 ${
                (tab === 'Auto') === autoMode
                  ? 'bg-[#2a2a45] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        {autoMode && (
          <span className="text-[10px] text-slate-500 font-medium">Auto cashes out at your target</span>
        )}
      </div>

      {/* Auto-cashout target row (Auto mode only) */}
      {autoMode && (
        <div className="flex items-center gap-2 px-3 pb-1.5">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide w-[88px]">Auto cashout</span>
          <div className="flex items-center bg-[#1a1a2e] rounded-lg border border-[#2a2a45] flex-1">
            <button
              onClick={() => adjustAuto(-0.1)}
              disabled={isOperator || locked || parsedAuto <= MIN_AUTO}
              className="w-8 h-9 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#2a2a45] rounded-l-lg transition disabled:opacity-40 active:scale-95"
            >
              <Minus size={13} />
            </button>
            <div className="flex items-center justify-center flex-1 h-9">
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={MIN_AUTO}
                value={autoStr}
                onChange={e => setAutoStr(e.target.value)}
                onBlur={handleAutoBlur}
                disabled={isOperator || locked}
                aria-label="Auto cashout multiplier"
                className={`w-full bg-transparent font-bold text-sm tabular-nums text-center leading-none focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${autoValid ? 'text-white' : 'text-red-400'}`}
              />
              <span className="text-slate-500 text-xs font-bold pr-1">x</span>
            </div>
            <button
              onClick={() => adjustAuto(0.1)}
              disabled={isOperator || locked}
              className="w-8 h-9 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#2a2a45] rounded-r-lg transition disabled:opacity-40 active:scale-95"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Amount stepper + action button */}
      <div className="flex items-stretch gap-2 px-3 pb-2">
        {/* Editable amount field with +/- */}
        <div className="flex items-center bg-[#1a1a2e] rounded-lg border border-[#2a2a45] flex-shrink-0">
          <button
            onClick={() => adjust(-50)}
            disabled={isOperator || locked || amount <= MIN_BET}
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
              disabled={isOperator || locked}
              className="w-full bg-transparent text-white font-bold text-sm tabular-nums text-center leading-none focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-slate-500 text-[9px] leading-none mt-0.5">KShs</span>
          </div>

          <button
            onClick={() => adjust(50)}
            disabled={isOperator || locked}
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
            disabled={isOperator || locked}
            className="flex-1 py-1 text-[11px] font-semibold bg-[#1a1a2e] border border-[#2a2a45] rounded text-slate-400 hover:text-white hover:bg-[#2a2a45] transition disabled:opacity-40 active:scale-95"
          >
            {q >= 1000 ? `${q / 1000}K` : q}
          </button>
        ))}
      </div>

      {/* Auto-bet sequencer (Auto mode) */}
      {showAutoBet && (
        <div className="px-3 pb-2.5 pt-2 border-t border-[#1a1a2e] space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {AUTO_FIELDS.map(f => (
              <label key={f.key} htmlFor={autoFieldId(f.key)} className="flex flex-col gap-1" title={f.hint}>
                <span className="text-[9px] text-slate-500 uppercase tracking-wide">{f.label}</span>
                <input
                  id={autoFieldId(f.key)}
                  type="number"
                  min={f.min}
                  step={1}
                  value={autoBet.config[f.key]}
                  disabled={autoBet.running}
                  onChange={e => autoBet.setConfig(c => ({ ...c, [f.key]: Math.max(f.min, Math.floor(Number(e.target.value) || 0)) }))}
                  aria-label={f.label}
                  className="w-full bg-[#1a1a2e] border border-[#2a2a45] rounded-md px-2 py-1.5 text-white text-xs font-semibold tabular-nums text-center focus:outline-none focus:border-[#22c55e]/50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </label>
            ))}
          </div>

          {!autoBet.running ? (
            <button
              onClick={() => autoBet.start(amount, autoTarget)}
              disabled={!autoValid || amount < MIN_BET || amount > balance}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs font-bold transition disabled:opacity-40 active:scale-[0.98]"
            >
              <Play size={12} className="fill-current" />
              Start auto-bet{autoTarget ? ` @ ${autoTarget.toFixed(2)}x` : ''}
            </button>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={autoBet.stop}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#c8001c] hover:bg-[#a50018] text-white text-xs font-bold transition active:scale-[0.98]"
              >
                <Square size={11} className="fill-current" />
                Stop ({autoBet.stats.remaining} left)
              </button>
              <div className="flex items-center justify-center gap-3 text-[10px] text-slate-400">
                <span>Played <span className="text-white font-semibold tabular-nums">{autoBet.stats.played}</span></span>
                <span>Net{' '}
                  <span className={'font-semibold tabular-nums ' + (autoBet.stats.net >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {autoBet.stats.net >= 0 ? '+' : '\u2212'}KSh {Math.abs(autoBet.stats.net).toLocaleString('en-KE', { maximumFractionDigits: 0 })}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active auto-cashout target indicator (while the bet is in flight) */}
      {activeBet?.status === 'active' && activeBet.autoCashout && (
        <div className="px-3 pb-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <Zap size={11} className="text-[#22c55e]" />
          <span>Auto cashout at <span className="text-white font-semibold">{activeBet.autoCashout.toFixed(2)}x</span></span>
        </div>
      )}

      {/* Queued bet indicator */}
      {queuedBet && (
        <div className="px-3 pb-2 flex items-center justify-center gap-2">
          <Clock size={11} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-semibold">
            Queued: KSh {queuedBet.amount.toLocaleString('en-KE')}{queuedBet.autoCashout ? ` @ ${queuedBet.autoCashout.toFixed(2)}x` : ''} for next round
          </span>
          <button onClick={onCancelQueue} className="text-[10px] text-slate-400 hover:text-red-400 underline">Cancel</button>
        </div>
      )}

      {/* Cashout confirmation row */}
      {activeBet?.status === 'won' && (
        <div className="px-3 pb-2 text-center text-green-400 text-[11px] font-semibold">
          +KSh {(activeBet.winnings ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} @ {formatMultiplier(activeBet.cashout_multiplier ?? multiplier)}
        </div>
      )}
    </div>
  );
}
