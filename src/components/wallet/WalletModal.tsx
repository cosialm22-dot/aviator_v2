import { useState, useRef, useEffect } from 'react';
import { X, CheckCircle, Loader, Smartphone, Eye, EyeOff, Gift, Clock, Lock } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';
import { isValidKenyanPhone, localNine, normalizeKenyanPhone } from '../../lib/phone';
import { quickDepositAmounts, validateDepositAmount } from '../../lib/megapayClient';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
import type { DepositStage } from '../../hooks/useWallet';
import { useModalA11y } from '../../hooks/useModalA11y';
import RedeemPromoCode from '../promo/RedeemPromoCode';
import type { FirstDepositBonus } from '../../hooks/useBonus';

/*
 * Wallet: M-Pesa deposit (Mega Pay prompt, PIN typed on the phone) and withdrawal request.
 * Server-authoritative: limits come from fn_public_payment_config and are re-checked there.
 * Phones get a bottom sheet; larger screens a centred card.
 */

interface Props {
  balance: number;
  // returns true if the deposit was confirmed before timeout, false if still pending
  onDeposit: (amount: number, method: 'mpesa', details: Record<string, string>, onStage?: (s: DepositStage) => void) => Promise<boolean>;
  onWithdraw: (amount: number, method: 'mpesa', details: Record<string, string>) => Promise<void>;
  onClose: () => void;
  eligibleForFirstDeposit?: boolean;
  activeBonus?: FirstDepositBonus | null;
  /** The signed-in phone number, used to prefill the M-Pesa number. */
  defaultPhone?: string;
}

type Tab = 'deposit' | 'withdraw';
type Step = 'form' | 'processing' | 'success';

const WITHDRAW_QUICK = [100, 500, 1000, 2000, 5000, 10000];
const k = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 0 });

function prefill(p?: string): string {
  const n = normalizeKenyanPhone(p || '');
  return isValidKenyanPhone(n) ? n.slice(3) : '';
}

export default function WalletModal({ balance, onDeposit, onWithdraw, onClose, eligibleForFirstDeposit = false, activeBonus = null, defaultPhone }: Props) {
  const cfg = usePaymentConfig();
  const [tab, setTab] = useState<Tab>('deposit');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(() => prefill(defaultPhone));
  const [stage, setStage] = useState<DepositStage | null>(null);
  const [waited, setWaited] = useState(0);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [depositConfirmed, setDepositConfirmed] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalA11y(onClose, amountRef);

  const parsedAmount = parseFloat(amount) || 0;
  const minAmount = tab === 'deposit' ? cfg.minDeposit : cfg.minWithdrawal;
  const quick = tab === 'deposit' ? quickDepositAmounts(cfg) : WITHDRAW_QUICK;
  const offer = cfg.offer && cfg.offer.matchPct > 0 && cfg.offer.matchCap > 0 ? cfg.offer : null;

  useEffect(() => {
    if (step !== 'processing' || stage !== 'awaiting_pin') { setWaited(0); return; }
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(t);
  }, [step, stage]);

  const reset = () => { setStep('form'); setAmount(''); setPhone(prefill(defaultPhone)); setPassword(''); setShowPassword(false); setError(''); setDepositConfirmed(false); setStage(null); };
  const switchTab = (t: Tab) => { setTab(t); reset(); };

  const field = 'h-12 w-full rounded-xl border border-[#2f3033] bg-[#141516] px-4 text-white placeholder:text-[#5c5d60] focus:border-win/60 focus:outline-none';

  const handleSubmit = async () => {
    setError('');
    if (tab === 'deposit') {
      const bad = validateDepositAmount(parsedAmount, cfg);
      if (bad) { setError(bad); return; }
    } else if (!Number.isInteger(parsedAmount) || parsedAmount < minAmount) {
      setError(`Enter a whole amount of at least ${formatCurrency(minAmount)}`); return;
    }
    if (!isValidKenyanPhone('254' + phone)) { setError('Enter a valid M-Pesa number'); return; }
    if (tab === 'withdraw' && parsedAmount > balance) { setError('Insufficient balance'); return; }
    if (tab === 'withdraw' && !password.trim()) { setError('Enter your password'); return; }

    setStep('processing');
    try {
      if (tab === 'deposit') {
        const confirmed = await onDeposit(parsedAmount, 'mpesa', { phone }, setStage);
        setDepositConfirmed(confirmed);
      } else {
        await onWithdraw(parsedAmount, 'mpesa', { phone, password });
      }
      setStep('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setStep('form');
    }
  };

  const pending = tab === 'deposit' && !depositConfirmed;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Wallet"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-2xl border border-[#2a2b2e] bg-[#1b1c1d] pb-[env(safe-area-inset-bottom)] shadow-2xl animate-[sheetUp_0.2s_ease-out] sm:max-w-[400px] sm:rounded-2xl">

        {step === 'success' && (
          <div className="px-6 py-10 text-center">
            <div className={`mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full ${pending ? 'bg-amber-400/10' : 'bg-win/10'}`}>
              {pending ? <Clock size={26} className="text-amber-400" /> : <CheckCircle size={26} className="text-win" />}
            </div>
            <h3 className="text-lg font-bold text-white">
              {tab === 'withdraw' ? 'Withdrawal requested' : depositConfirmed ? 'Deposit Confirmed' : 'Not confirmed yet'}
            </h3>
            <p className="mt-1 text-sm text-[#9ea0a3]">
              {tab === 'withdraw' ? `${formatCurrency(parsedAmount)} to +254${phone}`
                : depositConfirmed ? `+${formatCurrency(parsedAmount)}`
                : 'It will show up by itself once M-Pesa confirms.'}
            </p>
            <button onClick={reset} className="mt-6 h-12 w-full rounded-xl bg-win text-sm font-semibold text-white active:scale-[0.98]">Done</button>
          </div>
        )}

        {step === 'processing' && (
          <div className="px-6 py-10 text-center">
            {tab === 'deposit' && stage === 'awaiting_pin' ? (
              <div data-testid="deposit-awaiting-pin">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-win/10"><Smartphone size={26} className="text-win" /></div>
                <p className="text-lg font-bold text-white">Enter your M-Pesa PIN</p>
                <p className="mt-1 text-sm text-[#9ea0a3]">{formatCurrency(parsedAmount)} · +254{phone}</p>
                <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#7b7b7b]" aria-live="polite"><Loader size={12} className="animate-spin" />{waited}s</p>
                <button onClick={onClose} className="mt-6 h-12 w-full rounded-xl border border-[#2f3033] text-sm font-semibold text-[#d7d7d7]">Keep playing</button>
              </div>
            ) : (
              <>
                <Loader size={26} className="mx-auto mb-4 animate-spin text-win" />
                <p className="font-medium text-white">{tab === 'deposit' ? 'Sending prompt…' : 'Sending…'}</p>
              </>
            )}
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="flex items-center justify-between py-2 pl-4 pr-1">
              <p className="text-xl font-bold tabular-nums text-white">{formatCurrency(balance)}</p>
              <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[#9ea0a3] hover:text-white"><X size={20} /></button>
            </div>

            <div className="px-4">
              <div className="flex rounded-full bg-[#141516] p-1" role="tablist" aria-label="Wallet action">
                {(['deposit', 'withdraw'] as Tab[]).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}
                    className={`h-10 flex-1 rounded-full text-sm font-semibold capitalize transition ${tab === t ? 'bg-win text-white' : 'text-[#9ea0a3] hover:text-white'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4 px-4 pb-4 pt-4">
              {tab === 'deposit' && eligibleForFirstDeposit && offer && (
                <p className="flex items-center gap-2 rounded-xl bg-win/10 px-3 py-2.5 text-[13px] font-semibold text-[#5cd334]">
                  <Gift size={16} className="shrink-0" />+{offer.matchPct}% on your first deposit, up to {k(offer.matchCap)} KES
                </p>
              )}
              {activeBonus && activeBonus.status === 'active' && activeBonus.wageringRequired > 0 && (
                <div className="rounded-xl bg-[#141516] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex items-center gap-1.5 font-semibold text-white"><Lock size={12} className="text-amber-400" />Bonus {k(activeBonus.amount)}</span>
                    <span className="tabular-nums text-[#9ea0a3]">{k(Math.min(activeBonus.wageringProgress, activeBonus.wageringRequired))} / {k(activeBonus.wageringRequired)} bet</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2c2d30]">
                    <div className="h-full rounded-full bg-win" style={{ width: `${Math.min(100, Math.round((activeBonus.wageringProgress / activeBonus.wageringRequired) * 100))}%` }} />
                  </div>
                </div>
              )}

              <div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#7b7b7b]">KES</span>
                  <input ref={amountRef} type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="0" min={minAmount} max={tab === 'deposit' ? cfg.maxDeposit : undefined} step={1}
                    aria-label="Amount in Kenyan shillings"
                    className={`${field} h-14 pl-14 text-xl font-bold tabular-nums`} />
                </div>
                <p className="mt-1.5 text-[12px] text-[#7b7b7b]" data-testid={tab === 'deposit' ? 'deposit-limits' : undefined}>
                  {tab === 'deposit' ? `Min ${k(cfg.minDeposit)} · Max ${k(cfg.maxDeposit)}` : `Min ${k(cfg.minWithdrawal)}`}
                </p>
                <div className="mt-2 grid grid-cols-6 gap-1.5">
                  {quick.map((q) => {
                    const v = tab === 'withdraw' ? Math.min(q, Math.floor(balance)) : q;
                    const on = parseFloat(amount) === v && v > 0;
                    return (
                      <button key={q} onClick={() => setAmount(String(v))}
                        className={`h-10 rounded-lg text-[13px] font-semibold tabular-nums transition ${on ? 'bg-win/15 text-[#5cd334]' : 'bg-[#141516] text-[#9ea0a3] hover:text-white'}`}>
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex overflow-hidden rounded-xl border border-[#2f3033] bg-[#141516] focus-within:border-win/60">
                <span className="grid place-items-center pl-4 pr-2 text-[#9ea0a3]">+254</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(localNine(e.target.value))} aria-label="M-Pesa phone number"
                  inputMode="numeric" autoComplete="tel-national" placeholder="7XX XXX XXX"
                  className="h-12 min-w-0 flex-1 bg-transparent pr-4 text-white placeholder:text-[#5c5d60] focus:outline-none" />
              </div>

              {tab === 'withdraw' && (
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password" placeholder="Password" aria-label="Password" className={`${field} pr-12`} />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center text-[#7b7b7b] hover:text-white">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              )}

              {error && <p role="alert" className="text-center text-[13px] text-red-400">{error}</p>}

              <button onClick={handleSubmit} className="h-12 w-full rounded-xl bg-win text-[15px] font-bold text-white transition active:scale-[0.98]">
                {tab === 'deposit' ? 'Deposit' : 'Withdraw'}{parsedAmount > 0 ? ` ${k(parsedAmount)} KES` : ''}
              </button>

              {tab === 'deposit' && (promoOpen ? <RedeemPromoCode /> : (
                <button onClick={() => setPromoOpen(true)} className="h-9 w-full text-[13px] text-[#9ea0a3] hover:text-white">Promo code</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
