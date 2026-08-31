import { useState, useRef } from 'react';
import { Minus, Plus, Zap, Clock, ChevronDown, ChevronUp } from 'lucide-react';
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
  // Opens the deposit flow. Used to turn the otherwise-dead "can't bet, no funds"
  // state into the actual money action (Deposit) for signed-in players.
  onDeposit?: () => void;
  isAuthenticated: boolean;
  // True for admin/super_admin accounts. Operators run the platform and must
  // never wager (enforced authoritatively by the DB place_bet guard + the
  // block_operator_bets trigger); this disables the controls so they never hit
  // a server rejection. Marketers and players are NOT operators and play freely.
  isOperator?: boolean;
  /** Broadcast-safe labels: Bet->Enter, Cash Out->Collect, hide 'x'/KES. */
  streamer?: boolean;
}

const MIN_BET = 50;
const QUICK_AMOUNTS = [50, 100, 200, 500];
const MIN_AUTO = 1.01;          // auto-cashout must be strictly above 1.00x (server enforces too)
const DEFAULT_AUTO = '2.00';

// Auto-bet sequencing inputs (0 = "off" for the stop thresholds).
const AUTO_FIELDS: { key: keyof AutoBetConfig; label: string; min: number; hint: string }[] = [
  { key: 'rounds', label: 'Rounds', min: 1, hint: 'Number of bets to place automatically' },
  { key: 'stopLoss', label: 'Stop loss', min: 0, hint: 'Stop when net loss reaches this (KES, 0 = off)' },
  { key: 'stopWin', label: 'Stop win', min: 0, hint: 'Stop when net profit reaches this (KES, 0 = off)' },
];

export default function BettingPanel({
  panelIndex, status, multiplier, balance, activeBet, queuedBet,
  onPlaceBet, onQueueBet, onCancelQueue, onCashOut, onAuthRequired, onDeposit, isAuthenticated,
  isOperator = false, streamer = false,
}: Props) {
  const XS = streamer ? '' : 'x';
  const [rawAmount, setRawAmount] = useState(String(MIN_BET));
  const [autoMode, setAutoMode]   = useState(false);
  const [autoStr, setAutoStr]     = useState(DEFAULT_AUTO);
  const [showLimits, setShowLimits] = useState(false); // optional auto-bet limits, collapsed by default
  const inputRef = useRef<HTMLInputElement>(null);

  const amount = Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET));

  // Auto-cashout target (2dp). Only meaningful in Auto mode; must be > 1.00x.
  const parsedAuto = Math.round((parseFloat(autoStr) || 0) * 100) / 100;
  const autoValid = !autoMode || parsedAuto > 1.0;
  const autoTarget = autoMode ? parsedAuto : null;

  // Auto-bet sequencer for THIS panel/slot (settlement stays server-authoritative).
  const autoBet = useAutoBet({ status, activeBet, balance, isOperator, placeBet: onPlaceBet });

  // amount/target are immutable once a bet is committed, queued, or a sequence runs
  const locked = !!activeBet || !!queuedBet || autoBet.running;


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

  const autoFieldId = (key: string) => `autobet-${panelIndex}-${key}`;

  return (
    <div className="flex flex-col bg-panel select-none rounded-2xl lg:rounded-none border border-edge/60 lg:border-0 mx-2 mb-2 lg:m-0">
      {/* Bet / Auto mode toggle (desktop; mobile keeps the minimal Spribe layout) */}
      <div className="hidden lg:block px-3 pt-2 pb-2">
        <div className="flex bg-panel-high rounded-full p-0.5 w-full max-w-[200px]">
          {(['Bet', 'Auto'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setAutoMode(tab === 'Auto')}
              disabled={isOperator || locked}
              className={`flex-1 px-4 py-1.5 text-xs font-semibold rounded-full transition-all disabled:opacity-50 ${
                (tab === 'Auto') === autoMode
                  ? 'bg-[#3a3a3a] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {streamer && tab === 'Bet' ? 'Manual' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Amount stepper — compact pill with circular +/- (Spribe mobile) */}
      <div className="px-3 pt-2 lg:pt-0 pb-1.5">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => adjust(-50)}
            disabled={isOperator || locked || amount <= MIN_BET}
            aria-label="Decrease bet by 50"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-panel-high border border-edge text-slate-300 hover:text-white hover:bg-[#3a3a3a] transition disabled:opacity-40 active:scale-95"
          >
            <Minus size={15} />
          </button>

          <div
            className="flex items-baseline justify-center min-w-[72px] cursor-text"
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
              aria-label="Bet amount in KES"
              className="w-16 bg-transparent text-white font-bold text-base tabular-nums text-center leading-none focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          <button
            onClick={() => adjust(50)}
            disabled={isOperator || locked}
            aria-label="Increase bet by 50"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-panel-high border border-edge text-slate-300 hover:text-white hover:bg-[#3a3a3a] transition disabled:opacity-40 active:scale-95"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Quick amounts — 2x2 pill grid (Spribe mobile) */}
      <div className="grid grid-cols-2 gap-1 px-3 pb-2 max-w-[170px] mx-auto w-full lg:max-w-none lg:flex lg:gap-1.5">
        {QUICK_AMOUNTS.map(q => (
          <button
            key={q}
            onClick={() => setRawAmount(String(q))}
            disabled={isOperator || locked}
            className="py-1 text-[11px] font-semibold bg-panel-high border border-edge rounded-full text-slate-300 hover:text-white hover:bg-[#3a3a3a] transition disabled:opacity-40 active:scale-95 lg:flex-1"
          >
            {q >= 1000 ? `${q / 1000}K` : q}
          </button>
        ))}
      </div>

      {/* Auto cash-out target (Auto mode) — the single extra control auto needs */}
      {autoMode && !isOperator && (
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between bg-panel-high rounded-full border border-edge pl-3 pr-1">
            <span className="text-[11px] font-semibold text-slate-400">Auto Cash Out</span>
            <div className="flex items-center">
              <button
                onClick={() => adjustAuto(-0.1)}
                disabled={locked || parsedAuto <= MIN_AUTO}
                aria-label="Lower auto cashout"
                className="w-10 h-11 flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#3a3a3a] rounded-full transition disabled:opacity-40 active:scale-95"
              >
                <Minus size={16} />
              </button>
              <div className="flex items-baseline justify-center min-w-[58px]">
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={MIN_AUTO}
                  value={autoStr}
                  onChange={e => setAutoStr(e.target.value)}
                  onBlur={handleAutoBlur}
                  disabled={locked}
                  aria-label="Auto cashout multiplier"
                  className={`w-11 bg-transparent font-bold text-lg tabular-nums text-right leading-none focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${autoValid ? 'text-white' : 'text-red-400'}`}
                />
                <span className="text-slate-400 text-sm font-bold pl-0.5">x</span>
              </div>
              <button
                onClick={() => adjustAuto(0.1)}
                disabled={locked}
                aria-label="Raise auto cashout"
                className="w-10 h-11 flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#3a3a3a] rounded-full transition disabled:opacity-40 active:scale-95"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto: optional limits (rounds / stop loss / stop win) — collapsed by default */}
      {autoMode && !isOperator && (
        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={() => setShowLimits(v => !v)}
            disabled={autoBet.running}
            aria-expanded={showLimits}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition disabled:opacity-40"
          >
            {showLimits ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>{showLimits ? 'Hide limits' : 'Set limits (optional)'}</span>
          </button>
          {showLimits && (
            <div className="grid grid-cols-3 gap-2 mt-2">
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
                    className="w-full bg-panel-raised border border-edge rounded-md px-2 py-1.5 text-white text-xs font-semibold tabular-nums text-center focus:outline-none focus:border-win/50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active auto-cashout target indicator (while the bet is in flight) */}
      {activeBet?.status === 'active' && activeBet.autoCashout && (
        <div className="px-3 pb-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <Zap size={11} className="text-win" />
          <span>Auto cashout at <span className="text-white font-semibold">{activeBet.autoCashout.toFixed(2)}{XS}</span></span>
        </div>
      )}

      {/* Queued bet indicator */}
      {queuedBet && (
        <div className="px-3 pb-2 flex items-center justify-center gap-2">
          <Clock size={11} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-semibold">
            Queued: KES {queuedBet.amount.toLocaleString('en-KE')}{queuedBet.autoCashout ? ` @ ${queuedBet.autoCashout.toFixed(2)}${XS}` : ''} for next round
          </span>
          <button onClick={onCancelQueue} className="text-[10px] text-slate-400 hover:text-red-400 underline">Cancel</button>
        </div>
      )}

      {/* Cashout confirmation row */}
      {activeBet?.status === 'won' && (
        <div className="px-3 pb-2 text-center text-green-400 text-[11px] font-semibold">
          +KES {(activeBet.winnings ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} @ {streamer ? (activeBet.cashout_multiplier ?? multiplier).toFixed(2) : formatMultiplier(activeBet.cashout_multiplier ?? multiplier)}
        </div>
      )}
    </div>
  );
}
