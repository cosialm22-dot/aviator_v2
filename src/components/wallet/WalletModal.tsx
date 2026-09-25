import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, Smartphone, Eye, EyeOff, Gift, Lock } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';
import { isValidKenyanPhone, localNine, normalizeKenyanPhone } from '../../lib/phone';
import { quickDepositAmounts, validateDepositAmount } from '../../lib/megapayClient';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
import type { DepositStage } from '../../hooks/useWallet';
import RedeemPromoCode from '../promo/RedeemPromoCode';
import type { FirstDepositBonus } from '../../hooks/useBonus';
import Sheet from '../ui/Sheet';
import { Button, Field, Segmented, Spinner, kes } from '../ui/ios';
import { useBrand } from '../../brand/useBrand';

/*
 * Wallet: M-Pesa deposit (Mega Pay prompt, PIN typed on the phone) and withdrawal request.
 * Server-authoritative: limits come from fn_public_payment_config and are re-checked there.
 * A finished deposit does not stop on a "confirmed" page: the sheet closes, the player is back on
 * the game and the amount flies into the balance (onDepositDone).
 */

export interface DepositResult { amount: number; confirmed: boolean; from: DOMRect | null }

interface Props {
  balance: number;
  // returns true if the deposit was confirmed before timeout, false if still pending
  onDeposit: (amount: number, method: 'mpesa', details: Record<string, string>, onStage?: (s: DepositStage) => void) => Promise<boolean>;
  /** Resolves with how the withdrawal will be paid (automatic M-Pesa payout, or reviewed first). */
  onWithdraw: (amount: number, method: 'mpesa', details: Record<string, string>) => Promise<{ status: 'approved' | 'pending'; automatic: boolean } | void>;
  onClose: () => void;
  /** The deposit went through (or is still with M-Pesa): close and return to the game. */
  onDepositDone: (r: DepositResult) => void;
  eligibleForFirstDeposit?: boolean;
  activeBonus?: FirstDepositBonus | null;
  /** The signed-in phone number, used to prefill the M-Pesa number. */
  defaultPhone?: string;
}

type Tab = 'deposit' | 'withdraw';
type Step = 'form' | 'processing' | 'withdrawn';

const WITHDRAW_QUICK = [100, 500, 1000, 2000, 5000, 10000];
const k0 = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 0 });

function prefill(p?: string): string {
  const n = normalizeKenyanPhone(p || '');
  return isValidKenyanPhone(n) ? n.slice(3) : '';
}

export default function WalletModal({ balance, onDeposit, onWithdraw, onClose, onDepositDone, eligibleForFirstDeposit = false, activeBonus = null, defaultPhone }: Props) {
  const cfg = usePaymentConfig();
  const [payout, setPayout] = useState<{ status: 'approved' | 'pending'; automatic: boolean } | null>(null);
  const promoCodes = useBrand().config['features.promo_codes'];
  // The brand's switches decide which halves of the wallet exist (the server enforces them too).
  const tabs = ([['deposit', 'Deposit'], ['withdraw', 'Withdraw']] as [Tab, string][])
    .filter(([t]) => (t === 'deposit' ? cfg.depositsOpen : cfg.withdrawalsOpen));
  const [tab, setTab] = useState<Tab>(cfg.depositsOpen || !cfg.withdrawalsOpen ? 'deposit' : 'withdraw');
  useEffect(() => { if (tabs.length && !tabs.some(([t]) => t === tab)) setTab(tabs[0][0]); }, [tabs, tab]);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(() => prefill(defaultPhone));
  const [stage, setStage] = useState<DepositStage | null>(null);
  const [waited, setWaited] = useState(0);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const ctaRect = useRef<DOMRect | null>(null);

  const parsedAmount = parseFloat(amount) || 0;
  const minAmount = tab === 'deposit' ? cfg.minDeposit : cfg.minWithdrawal;
  const quick = tab === 'deposit' ? quickDepositAmounts(cfg) : WITHDRAW_QUICK;
  const offer = cfg.offer && cfg.offer.matchPct > 0 && cfg.offer.matchCap > 0 ? cfg.offer : null;

  useEffect(() => {
    if (step !== 'processing' || stage !== 'awaiting_pin') { setWaited(0); return; }
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(t);
  }, [step, stage]);

  const reset = () => { setStep('form'); setAmount(''); setPhone(prefill(defaultPhone)); setPassword(''); setShowPassword(false); setError(''); setStage(null); };
  const switchTab = (t: Tab) => { setTab(t); reset(); };

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

    ctaRect.current = ctaRef.current?.getBoundingClientRect() ?? null;
    setStep('processing');
    try {
      if (tab === 'deposit') {
        const confirmed = await onDeposit(parsedAmount, 'mpesa', { phone }, setStage);
        onDepositDone({ amount: parsedAmount, confirmed, from: ctaRect.current });
        return;
      }
      const r = await onWithdraw(parsedAmount, 'mpesa', { phone, password });
      setPayout(r ?? null);
      setStep('withdrawn');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setStep('form');
    }
  };

  return (
    <Sheet title="Wallet" onClose={onClose} initialFocus={amountRef}>
      {step === 'withdrawn' && (
        <div className="px-4 pb-2 pt-6 text-center">
          <CheckCircle2 size={56} strokeWidth={1.75} className="mx-auto text-ios-green" />
          <h3 className="mt-4 text-title3 text-white" data-testid="withdraw-done-title">{payout?.automatic ? 'On its way' : 'Withdrawal requested'}</h3>
          <p className="mt-1 text-subhead text-ios-label2">{formatCurrency(parsedAmount)} to +254 {phone}</p>
          <p className="mt-3 text-footnote text-ios-label2" data-testid="withdraw-done-note">
            {payout?.automatic
              ? 'It is being sent to your M-Pesa now and usually arrives within a few minutes.'
              : payout?.status === 'approved'
                ? 'Approved. It will be sent to your M-Pesa shortly.'
                : 'We check every withdrawal before paying it. The amount is set aside from your balance; you can follow it, or cancel it, in Profile → Payments.'}
          </p>
          <Button className="mt-8" onClick={onClose}>Done</Button>
        </div>
      )}

      {step === 'processing' && (
        <div className="px-4 pb-2 pt-6 text-center">
          {tab === 'deposit' && stage === 'awaiting_pin' ? (
            <div data-testid="deposit-awaiting-pin">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[rgba(48,209,88,0.15)] text-ios-green"><Smartphone size={30} strokeWidth={1.75} /></span>
              <h3 className="mt-4 text-title3 text-white">Enter your M-Pesa PIN</h3>
              <p className="mt-1 text-subhead tabular-nums text-ios-label2">{formatCurrency(parsedAmount)} · +254{phone}</p>
              <p className="mt-5 flex items-center justify-center gap-2 text-footnote tabular-nums text-ios-label3" aria-live="polite"><Spinner size={14} />{waited}s</p>
              <Button variant="gray" className="mt-8" onClick={onClose}>Keep playing</Button>
            </div>
          ) : (
            <div className="py-8">
              <Spinner size={28} />
              <p className="mt-4 text-subhead text-ios-label2">{tab === 'deposit' ? 'Sending prompt…' : 'Sending…'}</p>
            </div>
          )}
        </div>
      )}

      {step === 'form' && (
        <div className="px-4">
          <div className="pb-5 pt-1 text-center">
            <p className="text-footnote text-ios-label2">Balance</p>
            <p className="text-large-title tabular-nums text-white"><span className="mr-1.5 align-[0.35em] text-subhead font-semibold text-ios-label2">KES</span>{kes(balance)}</p>
          </div>

          {tabs.length > 1 && <Segmented label="Wallet action" value={tab} onChange={switchTab} items={tabs} />}
          {tabs.length === 0 && <p className="py-6 text-center text-subhead text-ios-label2" data-testid="wallet-closed">Payments are paused. Please check back soon.</p>}

          {tabs.length > 0 && <>
          <div className="mt-5 space-y-3">
            {tab === 'deposit' && eligibleForFirstDeposit && offer && (
              <p className="flex items-center gap-2.5 rounded-xl bg-[rgba(48,209,88,0.12)] px-4 py-3 text-subhead font-medium text-ios-green">
                <Gift size={18} className="shrink-0" />+{offer.matchPct}% first deposit, up to {k0(offer.matchCap)} KES
              </p>
            )}
            {activeBonus && activeBonus.status === 'active' && activeBonus.wageringRequired > 0 && (
              <div className="rounded-xl bg-ios-elev2 px-4 py-3">
                <div className="flex items-center justify-between text-subhead">
                  <span className="flex items-center gap-1.5 font-medium text-white"><Lock size={13} className="text-ios-orange" />Bonus {k0(activeBonus.amount)}</span>
                  <span className="tabular-nums text-ios-label2">{k0(Math.min(activeBonus.wageringProgress, activeBonus.wageringRequired))} / {k0(activeBonus.wageringRequired)}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ios-fill">
                  <div className="h-full rounded-full bg-ios-green" style={{ width: `${Math.min(100, Math.round((activeBonus.wageringProgress / activeBonus.wageringRequired) * 100))}%` }} />
                </div>
              </div>
            )}

            <div>
              <Field ref={amountRef} type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0" min={minAmount} max={tab === 'deposit' ? cfg.maxDeposit : undefined} step={1}
                aria-label="Amount in Kenyan shillings" leading="KES" className="h-14 [&_input]:text-title2 [&_input]:tabular-nums" />
              <p className="px-4 pt-1.5 text-footnote tabular-nums text-ios-label2" data-testid={tab === 'deposit' ? 'deposit-limits' : undefined}>
                {tab === 'deposit' ? `Min ${k0(cfg.minDeposit)} · Max ${k0(cfg.maxDeposit)}`
                  : `Min ${k0(cfg.minWithdrawal)}${cfg.maxWithdrawal ? ` · Max ${k0(cfg.maxWithdrawal)}` : ''}${cfg.dailyWithdrawal ? ` · ${k0(cfg.dailyWithdrawal)}/day` : ''} · Available ${kes(balance)}`}
              </p>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {quick.map((q) => {
                const v = tab === 'withdraw' ? Math.min(q, Math.floor(balance)) : q;
                const on = parseFloat(amount) === v && v > 0;
                return (
                  <button key={q} type="button" onClick={() => setAmount(String(v))}
                    className={`h-9 rounded-[9px] text-subhead font-semibold tabular-nums transition-colors ${on ? 'bg-white text-black' : 'bg-ios-fill text-white active:bg-ios-elev3'}`}>
                    {q >= 1000 ? `${q / 1000}K` : q}
                  </button>
                );
              })}
            </div>

            <Field type="tel" value={phone} onChange={(e) => setPhone(localNine(e.target.value))} aria-label="M-Pesa phone number"
              inputMode="numeric" autoComplete="tel-national" placeholder="7XX XXX XXX" leading="+254" />

            {tab === 'withdraw' && (
              <Field type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="Password" aria-label="Password"
                trailing={<button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="-mr-2 grid h-11 w-11 place-items-center text-ios-label2">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>} />
            )}

            {error && <p role="alert" className="px-2 text-center text-footnote text-ios-red">{error}</p>}
          </div>

          <Button ref={ctaRef} className="mt-5" onClick={handleSubmit}>
            {tab === 'deposit' ? 'Deposit' : 'Withdraw'}{parsedAmount > 0 ? ` ${k0(parsedAmount)} KES` : ''}
          </Button>

          {tab === 'deposit' && promoCodes && (promoOpen ? <div className="mt-4"><RedeemPromoCode /></div> : (
            <Button variant="plain" size="md" className="mt-2 w-full" onClick={() => setPromoOpen(true)}>Add promo code</Button>
          ))}
          </>}
        </div>
      )}
    </Sheet>
  );
}
