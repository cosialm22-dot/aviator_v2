import { useState, useRef, useEffect } from 'react';
import { shortBetError } from '../../lib/betErrors';
import { Minus, Plus, MinusSquare, PlusSquare, ChevronDown, ChevronUp } from 'lucide-react';
import type { GameStatus } from '../../types';
import type { ActiveBet } from '../../hooks/useGame';
import { useAutoBet, type AutoBetConfig } from '../../hooks/useAutoBet';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';

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
  onCashOut: () => Promise<void> | void;
  onAuthRequired: () => void;
  // Opens the deposit flow when the wallet can't cover the stake.
  onDeposit?: () => void;
  isAuthenticated: boolean;
  // True for admin/super_admin accounts: operators never wager (the DB place_bet
  // guard + block_operator_bets trigger are authoritative; this keeps the UI honest).
  isOperator?: boolean;
  /** Broadcast-safe labels: Bet->Enter, Cash Out->Collect, hide 'x'/KES. */
  streamer?: boolean;
  /** Top-right corner control: add the second panel (⊕) or remove this one (⊖). */
  corner?: { kind: 'add' | 'remove'; onClick: () => void } | null;
}

const QUICK_AMOUNTS = [50, 100, 200, 500];
const STEP = 50;
const MIN_AUTO = 1.01;          // auto-cashout must be strictly above 1.00x (server enforces too)
const DEFAULT_AUTO = '2.00';

// Auto-bet sequencing inputs (0 = "off" for the stop thresholds).
const AUTO_FIELDS: { key: keyof AutoBetConfig; label: string; min: number }[] = [
  { key: 'rounds', label: 'Rounds', min: 1 },
  { key: 'stopLoss', label: 'Stop loss', min: 0 },
  { key: 'stopWin', label: 'Stop win', min: 0 },
];

const money = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 0 });

/**
 * One bet panel, laid out like the owner's mock (Spribe-style): Bet / Auto tabs on top, the stake
 * stepper and 2×2 quick amounts on the left, one big action button on the right that walks through
 * Bet → Cancel ("Waiting for next round") → Cash Out → Bet. Auto adds Auto Play and Auto Cash Out.
 */
export default function BettingPanel({
  panelIndex, status, multiplier, balance, activeBet, queuedBet,
  onPlaceBet, onQueueBet, onCancelQueue, onCashOut, onAuthRequired, onDeposit, isAuthenticated,
  isOperator = false, streamer = false, corner = null,
}: Props) {
  const XS = streamer ? '' : 'x';
  const CUR = streamer ? '' : ' KES';
  const MIN_BET = usePaymentConfig().minBet;
  const [rawAmount, setRawAmount] = useState(String(MIN_BET));
  const [autoMode, setAutoMode]   = useState(false);
  const [autoCashOn, setAutoCashOn] = useState(false);
  const [autoStr, setAutoStr]     = useState(DEFAULT_AUTO);
  const [showLimits, setShowLimits] = useState(false);
  const [loading, setLoading]     = useState(false);
  // A refused bet or cash-out shows in the button itself for a moment (no toast, no pop-up).
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 2500); return () => clearTimeout(t); }, [err]);
  const inputRef = useRef<HTMLInputElement>(null);

  const amount = Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET));

  // Auto-cashout target (2dp). Applies when the Auto Cash Out switch is on; must be > 1.00x.
  const parsedAuto = Math.round((parseFloat(autoStr) || 0) * 100) / 100;
  const autoOn = autoMode && autoCashOn;
  const autoValid = !autoOn || parsedAuto > 1.0;
  const autoTarget = autoOn ? parsedAuto : null;

  // Auto-bet sequencer for THIS panel/slot (settlement stays server-authoritative).
  const autoBet = useAutoBet({ status, activeBet, balance, isOperator, placeBet: onPlaceBet });

  // amount/target are immutable once a bet is committed, queued, or a sequence runs
  const locked = !!activeBet && activeBet.status === 'active' || !!queuedBet || autoBet.running;

  const adjust = (delta: number) => setRawAmount(String(Math.max(MIN_BET, amount + delta)));
  const handleRawChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '');
    setRawAmount(clean === '' ? '' : String(parseInt(clean, 10) || ''));
  };
  const handleBlur = () => setRawAmount(String(Math.max(MIN_BET, Math.floor(parseFloat(rawAmount) || MIN_BET))));
  const adjustAuto = (delta: number) => setAutoStr(Math.max(MIN_AUTO, Math.round((parsedAuto + delta) * 100) / 100).toFixed(2));
  const handleAutoBlur = () => {
    const n = parseFloat(autoStr);
    setAutoStr((Number.isFinite(n) && n > 1.0 ? n : Number(DEFAULT_AUTO)).toFixed(2));
  };

  const inFlight = activeBet?.status === 'active';
  const cashable = !isOperator && status === 'flying' && inFlight;

  const bet = async () => {
    if (isOperator) return;
    if (!isAuthenticated) { onAuthRequired(); return; }
    if (amount > balance) { onDeposit?.(); return; }
    if (!autoValid) return;
    if (status === 'waiting' && !activeBet) {
      setLoading(true);
      try { await onPlaceBet(amount, autoTarget); setErr(null); }
      catch (e) { setErr(shortBetError(e)); }
      finally { setLoading(false); }
      return;
    }
    // Round in flight or just crashed: queue for the next round (Spribe "Waiting for next round").
    onQueueBet(amount, autoTarget);
  };

  // ── The one action button: a verb and at most one number ──
  type Btn = { tone: 'green' | 'red' | 'orange' | 'muted'; title: string; sub: string; onClick?: () => void; disabled?: boolean };
  const button: Btn = (() => {
    if (isOperator) return { tone: 'muted', title: 'Bet', sub: 'Staff account', disabled: true };
    if (cashable) {
      const value = activeBet!.amount * multiplier;
      return { tone: 'orange', title: streamer ? 'Collect' : 'Cash Out', sub: `${money(value)}${CUR}`, onClick: () => { void Promise.resolve(onCashOut()).catch((e) => setErr(shortBetError(e))); } };
    }
    if (queuedBet) return { tone: 'red', title: 'Cancel', sub: 'Next round', onClick: onCancelQueue };
    if (inFlight && status === 'waiting') return { tone: 'muted', title: 'Bet placed', sub: `${whole(activeBet!.amount)}${CUR}`, disabled: true };
    if (autoBet.running) return { tone: 'muted', title: 'Auto', sub: `${autoBet.stats.remaining} left`, disabled: true };
    if (isAuthenticated && amount > balance && onDeposit) return { tone: 'green', title: 'Deposit', sub: `${whole(amount)}${CUR}`, onClick: onDeposit };
    if (!autoValid) return { tone: 'muted', title: 'Bet', sub: `Min ${MIN_AUTO.toFixed(2)}${XS}`, disabled: true };
    return { tone: 'green', title: loading ? '…' : (streamer ? 'Enter' : 'Bet'), sub: `${whole(amount)}${CUR}`, onClick: () => { void bet(); }, disabled: loading };
  })();
  const shown: Btn = err ? { ...button, sub: err } : button;
  const toneCls: Record<Btn['tone'], string> = {
    green: 'bg-[#28a909] border-[#b2f2a3] hover:bg-[#2fbd0b] shadow-[0_0_14px_-4px_rgba(40,169,9,0.8)]',
    red: 'bg-[#cb011a] border-[#ff7d8f] hover:bg-[#df0620]',
    orange: 'bg-[#d07206] border-[#ffbd71] hover:bg-[#e17d08]',
    muted: 'bg-[#2c2d30] border-[#3a3b3e] text-white/50 cursor-not-allowed',
  };

  const autoFieldId = (key: string) => `autobet-${panelIndex}-${key}`;
  const dim = locked ? 'opacity-50' : '';

  return (
    <div className="relative flex select-none flex-col rounded-2xl border border-[#2a2b2e] bg-[#1b1c1d] p-2">
      {/* Top row: Bet / Auto + add/remove the second panel */}
      <div className="mb-2 flex items-center justify-center">
        <div className="flex w-40 rounded-full bg-[#141516] p-0.5" role="tablist" aria-label={`Bet ${panelIndex + 1} mode`}>
          {(['Bet', 'Auto'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={(tab === 'Auto') === autoMode}
              onClick={() => setAutoMode(tab === 'Auto')} disabled={isOperator || autoBet.running}
              className={`h-7 flex-1 rounded-full text-[13px] font-medium transition disabled:opacity-50 ${(tab === 'Auto') === autoMode ? 'bg-[#2c2d30] text-white' : 'text-[#9ea0a3] hover:text-white'}`}>
              {streamer && tab === 'Bet' ? 'Manual' : tab}
            </button>
          ))}
        </div>
        {corner ? (
          <button type="button" onClick={corner.onClick}
            aria-label={corner.kind === 'add' ? 'Add a second bet' : 'Remove this bet panel'}
            className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-full text-[#9ea0a3] hover:text-white">
            {corner.kind === 'add' ? <PlusSquare size={18} /> : <MinusSquare size={18} />}
          </button>
        ) : null}
      </div>

      <div className="flex items-stretch gap-2">
        {/* Stake: stepper + 2×2 quick amounts */}
        <div className={`flex w-[47%] max-w-[200px] shrink-0 flex-col gap-1.5 ${dim}`}>
          <div className="flex h-11 items-center justify-between rounded-full bg-[#141516] px-1">
            <button type="button" onClick={() => adjust(-STEP)} disabled={isOperator || locked || amount <= MIN_BET}
              aria-label={`Decrease bet by ${STEP}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#5c5d60] text-[#c9cacc] transition hover:text-white disabled:opacity-40 active:scale-95">
              <Minus size={16} />
            </button>
            <input ref={inputRef} type="text" inputMode="numeric" value={rawAmount}
              onChange={(e) => handleRawChange(e.target.value)} onBlur={handleBlur} disabled={isOperator || locked}
              aria-label={`Bet ${panelIndex + 1} amount in KES`}
              className="w-full min-w-0 bg-transparent text-center text-[18px] font-bold tabular-nums text-white focus:outline-none disabled:opacity-80" />
            <button type="button" onClick={() => adjust(STEP)} disabled={isOperator || locked}
              aria-label={`Increase bet by ${STEP}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#5c5d60] text-[#c9cacc] transition hover:text-white disabled:opacity-40 active:scale-95">
              <Plus size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_AMOUNTS.map((q) => (
              <button key={q} type="button" onClick={() => setRawAmount(String(q))} disabled={isOperator || locked}
                className={`h-9 rounded-full text-[14px] tabular-nums transition disabled:opacity-40 active:scale-95 ${amount === q ? 'bg-[#2c2d30] text-white' : 'bg-[#141516] text-[#9ea0a3] hover:text-white'}`}>
                {q >= 1000 ? `${q / 1000}K` : q}
              </button>
            ))}
          </div>
        </div>

        {/* The action button */}
        <button type="button" onClick={shown.onClick} disabled={shown.disabled}
          className={`flex min-h-[92px] flex-1 flex-col items-center justify-center rounded-[20px] border px-2 text-white transition active:scale-[0.98] ${toneCls[shown.tone]}`}>
          <span className="text-[22px] font-medium leading-tight">{shown.title}</span>
          {shown.sub ? <span role={err ? 'alert' : undefined}
            className={`${err ? 'rounded-full bg-black/35 px-2 text-[14px] font-semibold' : shown.tone === 'red' || shown.tone === 'muted' ? 'text-[13px]' : 'text-[19px]'} leading-tight tabular-nums`}>{shown.sub}</span> : null}
        </button>
      </div>

      {autoMode && !isOperator && (
        <>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#2a2b2e] pt-2">
            <button type="button"
              onClick={() => {
                if (autoBet.running) { autoBet.stop(); return; }
                if (!isAuthenticated) { onAuthRequired(); return; }
                if (amount > balance && onDeposit) { onDeposit(); return; }
                if (autoValid) autoBet.start(amount, autoTarget);
              }}
              className={`h-9 rounded-full px-4 text-[13px] font-bold text-white transition ${autoBet.running ? 'bg-[#cb011a]' : 'bg-[#2c73d2] hover:bg-[#3480e6]'}`}>
              {autoBet.running ? `Stop (${autoBet.stats.remaining})` : 'Auto play'}
            </button>
            <div className="flex items-center gap-1.5">
              <button type="button" role="switch" aria-checked={autoCashOn} aria-label="Auto cash out"
                onClick={() => !locked && setAutoCashOn((v) => !v)} disabled={locked}
                className="flex h-9 items-center gap-1.5 text-[13px] text-[#9ea0a3] disabled:opacity-50">
                <span className={`relative h-5 w-9 rounded-full transition ${autoCashOn ? 'bg-[#28a909]' : 'bg-[#3a3b3e]'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${autoCashOn ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
                Cash out
              </button>
              <div className={`flex h-9 items-center rounded-full bg-[#141516] pl-1 pr-1 ${autoCashOn ? '' : 'opacity-40'}`}>
                <button type="button" onClick={() => adjustAuto(-0.1)} disabled={!autoCashOn || locked || parsedAuto <= MIN_AUTO} aria-label="Lower auto cash out" className="grid h-8 w-7 place-items-center text-[#9ea0a3] hover:text-white disabled:opacity-40"><Minus size={13} /></button>
                <input type="text" inputMode="decimal" value={autoStr} onChange={(e) => setAutoStr(e.target.value)} onBlur={handleAutoBlur}
                  disabled={!autoCashOn || locked} aria-label="Auto cash out multiplier"
                  className={`w-12 bg-transparent text-center text-[14px] font-bold tabular-nums focus:outline-none ${autoValid ? 'text-white' : 'text-red-400'}`} />
                <span className="text-[13px] text-[#9ea0a3]">{XS}</span>
                <button type="button" onClick={() => adjustAuto(0.1)} disabled={!autoCashOn || locked} aria-label="Raise auto cash out" className="grid h-8 w-7 place-items-center text-[#9ea0a3] hover:text-white disabled:opacity-40"><Plus size={13} /></button>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setShowLimits((v) => !v)} disabled={autoBet.running} aria-expanded={showLimits}
            className="mt-1 flex h-8 items-center gap-1 self-start text-[12px] font-semibold text-[#9ea0a3] transition hover:text-white disabled:opacity-40">
            {showLimits ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Limits
          </button>
          {showLimits && (
            <div className="grid grid-cols-3 gap-2">
              {AUTO_FIELDS.map((f) => (
                <label key={f.key} htmlFor={autoFieldId(f.key)} className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#9ea0a3]">{f.label}</span>
                  <input id={autoFieldId(f.key)} type="number" inputMode="numeric" min={f.min} step={1} value={autoBet.config[f.key]} disabled={autoBet.running}
                    onChange={(e) => autoBet.setConfig((c) => ({ ...c, [f.key]: Math.max(f.min, Math.floor(Number(e.target.value) || 0)) }))}
                    className="h-10 w-full rounded-lg border border-[#2a2b2e] bg-[#141516] px-2 text-center text-sm font-semibold tabular-nums text-white focus:outline-none disabled:opacity-50" />
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
