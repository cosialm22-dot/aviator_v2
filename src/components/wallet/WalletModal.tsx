import { useState } from 'react';
import { X, CheckCircle, Loader, ArrowDownLeft, ArrowUpRight, Smartphone } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

/*
 * WALLET MODAL — M-Pesa cashier (server-authoritative).
 *
 * Deposits go through the mpesa-stk-push Edge Function; the PIN is entered on
 * the user's PHONE (never in this app). Withdrawals create a pending request
 * via the request_withdrawal RPC; payout is processed server-side. No client
 * ever writes wallets/transactions directly.
 *
 * Design tokens preserved from the original: surface #161b2e, inputs #1c2237 /
 * #2a3150, accent #22c55e, high-contrast white-on-dark typography.
 */

interface Props {
  balance: number;
  // returns true if the deposit was confirmed before timeout, false if still pending
  onDeposit: (amount: number, method: 'mpesa', details: Record<string, string>) => Promise<boolean>;
  onWithdraw: (amount: number, method: 'mpesa', details: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type Tab = 'deposit' | 'withdraw';
type Step = 'form' | 'processing' | 'success';

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000, 10000];
const MIN_DEPOSIT = 50;
const MIN_WITHDRAWAL = 100;

export default function WalletModal({ balance, onDeposit, onWithdraw, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('deposit');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [depositConfirmed, setDepositConfirmed] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const minAmount = tab === 'deposit' ? MIN_DEPOSIT : MIN_WITHDRAWAL;

  const reset = () => { setStep('form'); setAmount(''); setPhone(''); setError(''); setDepositConfirmed(false); };
  const switchTab = (t: Tab) => { setTab(t); reset(); };

  const inputBase =
    'w-full bg-[#1c2237] border border-[#2a3150] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/20 transition-all';

  const handleSubmit = async () => {
    setError('');
    if (!Number.isInteger(parsedAmount) || parsedAmount < minAmount) {
      setError(`Enter a whole amount of at least ${formatCurrency(minAmount)}`); return;
    }
    if (phone.replace(/\D/g, '').length < 9) { setError('Enter a valid phone number'); return; }
    if (tab === 'withdraw' && parsedAmount > balance) { setError('Insufficient balance'); return; }

    setStep('processing');
    try {
      if (tab === 'deposit') {
        const confirmed = await onDeposit(parsedAmount, 'mpesa', { phone });
        setDepositConfirmed(confirmed);
      } else {
        await onWithdraw(parsedAmount, 'mpesa', { phone });
      }
      setStep('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setStep('form');
    }
  };

  const successTitle = tab === 'withdraw'
    ? 'Withdrawal Requested'
    : depositConfirmed ? 'Deposit Confirmed' : 'STK Push Sent';
  const successBody = tab === 'withdraw'
    ? `${formatCurrency(parsedAmount)} to +254${phone} — pending approval. You'll receive it shortly.`
    : depositConfirmed
      ? `${formatCurrency(parsedAmount)} added to your wallet.`
      : `Approve the M-Pesa prompt on +254${phone} to add ${formatCurrency(parsedAmount)}. Your balance updates automatically once confirmed.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div
        className="w-full max-w-[400px] overflow-hidden"
        style={{
          background: '#161b2e',
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03) inset',
        }}
      >
        {/* ============ SUCCESS ============ */}
        {step === 'success' && (
          <div className="px-8 py-14 text-center">
            <div className="w-16 h-16 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={28} className="text-[#22c55e]" />
            </div>
            <h3 className="text-white font-bold text-xl">{successTitle}</h3>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed">{successBody}</p>
            <button
              onClick={reset}
              className="mt-8 px-8 py-3 bg-[#22c55e] hover:bg-[#1eab54] rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        )}

        {/* ============ PROCESSING ============ */}
        {step === 'processing' && (
          <div className="px-8 py-16 text-center">
            <Loader size={28} className="text-[#22c55e] animate-spin mx-auto mb-5" />
            <p className="text-white font-medium">
              {tab === 'deposit' ? 'Sending M-Pesa prompt…' : 'Submitting your request…'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              {tab === 'deposit' ? `Enter your PIN on +254${phone} when prompted` : 'This will only take a moment'}
            </p>
          </div>
        )}

        {/* ============ MAIN FORM ============ */}
        {step === 'form' && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-7 pt-6 pb-1">
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest">Wallet Balance</p>
                <p className="text-white font-bold text-xl tabular-nums mt-0.5">{formatCurrency(balance)}</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-[#1c2237] border border-[#2a3150] flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-500 transition-all"
              >
                <X size={15} />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-7 pt-5">
              <div className="flex bg-[#1c2237] border border-[#2a3150] rounded-xl p-1.5 gap-1">
                {(['deposit', 'withdraw'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => switchTab(t)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      tab === t
                        ? 'bg-[#22c55e] text-white shadow-lg shadow-[#22c55e]/20'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {t === 'deposit' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    <span className="capitalize">{t}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="px-7 pt-6 pb-7 space-y-5">
              {/* Method — M-Pesa only */}
              <div className="flex items-center gap-3 bg-[#1e2940] border border-[#22c55e]/30 rounded-xl px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-[#22c55e]/15 flex items-center justify-center">
                  <Smartphone size={18} className="text-[#22c55e]" />
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-semibold">M-Pesa</p>
                  <p className="text-slate-400 text-[11px]">
                    {tab === 'deposit' ? 'Instant STK push to your phone' : 'Sent to your M-Pesa number'}
                  </p>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-3 font-medium">Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">KSh</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    min={minAmount}
                    step={1}
                    className="w-full bg-[#1c2237] border border-[#2a3150] rounded-xl pl-12 pr-4 py-4 text-white text-xl font-bold tabular-nums placeholder:text-[#2a3150] focus:outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/20 transition-all"
                  />
                </div>
                <div className="grid grid-cols-6 gap-1.5 mt-3">
                  {QUICK_AMOUNTS.map((q) => {
                    const isActive = parseFloat(amount) === q;
                    const displayQ = tab === 'withdraw' ? Math.min(q, Math.floor(balance)) : q;
                    return (
                      <button
                        key={q}
                        onClick={() => setAmount(String(displayQ))}
                        className={`py-2 rounded-lg text-[11px] font-semibold transition-all ${
                          isActive
                            ? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30'
                            : 'bg-[#1c2237] border border-[#2a3150] text-slate-400 hover:text-white hover:border-[#3a4160]'
                        }`}
                      >
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    );
                  })}
                </div>
                {tab === 'withdraw' && balance > 0 && (
                  <button
                    onClick={() => setAmount(String(Math.floor(balance)))}
                    className="mt-2 text-[11px] text-[#22c55e] hover:text-[#4ade80] font-medium transition-colors"
                  >
                    Withdraw all ({formatCurrency(balance)})
                  </button>
                )}
              </div>

              {/* Phone */}
              <div>
                <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">
                  {tab === 'deposit' ? 'Pay From' : 'Send To'} — Phone Number
                </label>
                <div className="flex gap-2">
                  <div className="flex items-center bg-[#1c2237] border border-[#2a3150] rounded-xl px-3.5">
                    <span className="text-slate-300 text-sm font-medium">+254</span>
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                    placeholder="7XX XXX XXX"
                    className={inputBase + ' flex-1'}
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs text-center">{error}</p>}

              {/* CTA */}
              <button
                onClick={handleSubmit}
                className="w-full py-4 bg-[#22c55e] hover:bg-[#1eab54] rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.98] shadow-lg shadow-[#22c55e]/20"
              >
                {tab === 'deposit' ? 'Deposit via M-Pesa' : 'Request Withdrawal'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
