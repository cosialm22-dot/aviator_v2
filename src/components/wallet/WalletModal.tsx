import { useState } from 'react';
import { X, CheckCircle, Loader, ArrowDownLeft, ArrowUpRight, Building2 } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

/*
 * WALLET MODAL — Redesigned for maximum visibility & clarity.
 *
 * Design decisions:
 * - Modal surface: #161b2e (elevated from page bg #0d0d1a) + border + shadow
 * - Input fields: #1c2237 with visible borders for clear delineation
 * - Accent: #22c55e (green) for primary actions
 * - Method cards: distinct surface lift + brand imagery
 * - Typography: sharp, high-contrast white on dark with muted labels
 * - CTA: full-width, high-saturation green, impossible to miss
 */

interface Props {
  balance: number;
  onDeposit: (amount: number, method: 'mpesa' | 'card', details: Record<string, string>) => Promise<void>;
  onWithdraw: (amount: number, method: 'mpesa' | 'bank', details: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type Tab = 'deposit' | 'withdraw';
type Step = 'form' | 'processing' | 'pin' | 'success';

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000, 10000];

export default function WalletModal({ balance, onDeposit, onWithdraw, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('deposit');
  const [method, setMethod] = useState<'mpesa' | 'card' | 'bank'>('mpesa');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;

  const reset = () => {
    setStep('form'); setAmount(''); setPhone('');
    setCardNumber(''); setCardExpiry(''); setCardCvv(''); setCardName('');
    setBankAccount(''); setBankName(''); setPin(''); setError('');
  };

  const switchTab = (t: Tab) => { setTab(t); setMethod('mpesa'); reset(); };

  const formatCard = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 16);
    return clean.replace(/(.{4})/g, '$1 ').trim();
  };
  const formatExpiry = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    return clean.length >= 2 ? clean.slice(0, 2) + '/' + clean.slice(2) : clean;
  };

  const handleSubmit = async () => {
    setError('');
    if (parsedAmount < 50) { setError('Minimum amount is KSh 50'); return; }
    if (tab === 'deposit') {
      if (method === 'mpesa') {
        if (!phone || phone.length < 9) { setError('Enter a valid phone number'); return; }
        setStep('processing');
        await new Promise(r => setTimeout(r, 1200));
        setStep('pin');
        return;
      }
      if (method === 'card') {
        if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) { setError('Enter valid card number'); return; }
        if (!cardExpiry || cardExpiry.length < 5) { setError('Enter expiry date'); return; }
        if (!cardCvv || cardCvv.length < 3) { setError('Enter CVV'); return; }
        setLoading(true); setStep('processing');
        try { await onDeposit(parsedAmount, 'card', { cardNumber, cardExpiry, cardCvv, cardName }); setStep('success'); }
        catch (e) { setError(e instanceof Error ? e.message : 'Payment failed'); setStep('form'); }
        finally { setLoading(false); }
      }
    } else {
      if (parsedAmount > balance) { setError('Insufficient balance'); return; }
      if (method === 'mpesa' && (!phone || phone.length < 9)) { setError('Enter a valid phone number'); return; }
      if (method === 'bank' && !bankAccount) { setError('Enter account number'); return; }
      setLoading(true); setStep('processing');
      try { await onWithdraw(parsedAmount, method as 'mpesa' | 'bank', { phone, bankAccount, bankName }); setStep('success'); }
      catch (e) { setError(e instanceof Error ? e.message : 'Withdrawal failed'); setStep('form'); }
      finally { setLoading(false); }
    }
  };

  const handlePinConfirm = async () => {
    if (pin.length !== 4) { setError('Enter 4-digit PIN'); return; }
    setLoading(true); setStep('processing');
    try { await onDeposit(parsedAmount, 'mpesa', { phone }); setStep('success'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Payment failed'); setStep('form'); }
    finally { setLoading(false); setPin(''); }
  };

  // Shared input style tokens
  const inputBase = 'w-full bg-[#1c2237] border border-[#2a3150] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/20 transition-all';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">

      {/* Modal card — elevated surface with clear separation from page */}
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
            <h3 className="text-white font-bold text-xl">
              {tab === 'deposit' ? 'Deposit Successful' : 'Withdrawal Sent'}
            </h3>
            <p className="text-slate-400 text-sm mt-2">
              {formatCurrency(parsedAmount)} {tab === 'deposit' ? 'added to wallet' : 'on its way'}
            </p>
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
            <p className="text-white font-medium">Processing…</p>
            <p className="text-slate-500 text-xs mt-1">This will only take a moment</p>
          </div>
        )}

        {/* ============ PIN (M-Pesa STK) ============ */}
        {step === 'pin' && (
          <div className="px-7 py-9">
            <div className="text-center mb-7">
              <img src="/icons/mpesa-logo.jpg" alt="M-Pesa" className="w-14 h-14 object-contain rounded-xl mx-auto mb-4 border border-white/10" />
              <h3 className="text-white font-bold text-lg">Confirm Payment</h3>
              <p className="text-slate-400 text-xs mt-1">Enter M-Pesa PIN for +254{phone}</p>
            </div>

            {/* Summary */}
            <div className="bg-[#1c2237] border border-[#2a3150] rounded-xl px-4 py-3 flex justify-between items-center mb-6">
              <span className="text-slate-400 text-sm">Amount</span>
              <span className="text-white font-bold text-base">{formatCurrency(parsedAmount)}</span>
            </div>

            {/* PIN input */}
            <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 text-center">PIN</label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              maxLength={4}
              autoFocus
              className="w-full bg-[#1c2237] border border-[#2a3150] rounded-xl px-4 py-4 text-white text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/20 transition-all mb-6"
            />

            {error && <p className="text-red-400 text-xs text-center mb-4">{error}</p>}

            <button
              onClick={handlePinConfirm}
              disabled={pin.length !== 4}
              className="w-full py-3.5 bg-[#22c55e] hover:bg-[#1eab54] rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none"
            >
              Confirm Payment
            </button>
          </div>
        )}

        {/* ============ MAIN FORM ============ */}
        {step === 'form' && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-7 pt-6 pb-1">
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest">Wallet Balance</p>
                <p className="text-white font-bold text-xl tabular-nums mt-0.5">
                  {formatCurrency(balance)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-[#1c2237] border border-[#2a3150] flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-500 transition-all"
              >
                <X size={15} />
              </button>
            </div>

            {/* Tabs — Diptych */}
            <div className="px-7 pt-5">
              <div className="flex bg-[#1c2237] border border-[#2a3150] rounded-xl p-1.5 gap-1">
                {(['deposit', 'withdraw'] as Tab[]).map(t => (
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

            {/* Content */}
            <div className="px-7 pt-6 pb-7 space-y-5">

              {/* Payment method */}
              <div>
                <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-3 font-medium">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* M-Pesa */}
                  <button
                    onClick={() => setMethod('mpesa')}
                    className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all ${
                      method === 'mpesa'
                        ? 'bg-[#1e2940] border-[#22c55e]/40 shadow-md shadow-[#22c55e]/5'
                        : 'bg-[#1c2237] border-[#2a3150] hover:border-[#3a4160] hover:bg-[#1e2540]'
                    }`}
                  >
                    {method === 'mpesa' && (
                      <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-sm shadow-[#22c55e]/50" />
                    )}
                    <img
                      src="/icons/mpesa-logo.jpg"
                      alt="M-Pesa"
                      className="w-10 h-10 object-contain rounded-lg"
                    />
                    <span className={`text-xs font-semibold ${method === 'mpesa' ? 'text-white' : 'text-slate-400'}`}>
                      M-Pesa
                    </span>
                  </button>

                  {/* Card (deposit) / Bank (withdraw) */}
                  {tab === 'deposit' ? (
                    <button
                      onClick={() => setMethod('card')}
                      className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all ${
                        method === 'card'
                          ? 'bg-[#1e2940] border-[#8b5cf6]/40 shadow-md shadow-[#8b5cf6]/5'
                          : 'bg-[#1c2237] border-[#2a3150] hover:border-[#3a4160] hover:bg-[#1e2540]'
                      }`}
                    >
                      {method === 'card' && (
                        <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#8b5cf6] shadow-sm shadow-[#8b5cf6]/50" />
                      )}
                      <img
                        src="/icons/card-logo.png"
                        alt="Card"
                        className="w-10 h-10 object-contain"
                      />
                      <span className={`text-xs font-semibold ${method === 'card' ? 'text-white' : 'text-slate-400'}`}>
                        Debit/Credit
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setMethod('bank')}
                      className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all ${
                        method === 'bank'
                          ? 'bg-[#1e2940] border-[#3b82f6]/40 shadow-md shadow-[#3b82f6]/5'
                          : 'bg-[#1c2237] border-[#2a3150] hover:border-[#3a4160] hover:bg-[#1e2540]'
                      }`}
                    >
                      {method === 'bank' && (
                        <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#3b82f6] shadow-sm shadow-[#3b82f6]/50" />
                      )}
                      <div className="w-10 h-10 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center">
                        <Building2 size={20} className="text-[#3b82f6]" />
                      </div>
                      <span className={`text-xs font-semibold ${method === 'bank' ? 'text-white' : 'text-slate-400'}`}>
                        Bank Transfer
                      </span>
                    </button>
                  )}
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
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0"
                    min="50"
                    className="w-full bg-[#1c2237] border border-[#2a3150] rounded-xl pl-12 pr-4 py-4 text-white text-xl font-bold tabular-nums placeholder:text-[#2a3150] focus:outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/20 transition-all"
                  />
                </div>
                {/* Quick amounts */}
                <div className="grid grid-cols-6 gap-1.5 mt-3">
                  {QUICK_AMOUNTS.map(q => {
                    const isActive = parseFloat(amount) === q;
                    const displayQ = tab === 'withdraw' ? Math.min(q, balance) : q;
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

              {/* M-Pesa phone field */}
              {method === 'mpesa' && (
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
                      onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="7XX XXX XXX"
                      className={inputBase + ' flex-1'}
                    />
                  </div>
                </div>
              )}

              {/* Bank fields */}
              {method === 'bank' && tab === 'withdraw' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Bank Name</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. Equity, KCB, Co-op"
                      className={inputBase}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Account Number</label>
                    <input
                      type="text"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      placeholder="Enter account number"
                      className={inputBase}
                    />
                  </div>
                </div>
              )}

              {/* Card fields */}
              {method === 'card' && tab === 'deposit' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Card Number</label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={e => setCardNumber(formatCard(e.target.value))}
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      className={inputBase + ' tracking-widest font-mono'}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Expiry</label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                        placeholder="MM/YY"
                        maxLength={5}
                        className={inputBase}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">CVV</label>
                      <input
                        type="password"
                        value={cardCvv}
                        onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="•••"
                        maxLength={3}
                        className={inputBase}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Name on Card</label>
                    <input
                      type="text"
                      value={cardName}
                      onChange={e => setCardName(e.target.value)}
                      placeholder="JOHN DOE"
                      className={inputBase + ' uppercase'}
                    />
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                  <p className="text-red-400 text-xs text-center font-medium">{error}</p>
                </div>
              )}

              {/* CTA — unmistakably prominent */}
              <button
                onClick={handleSubmit}
                disabled={loading || parsedAmount < 50}
                className="w-full py-4 rounded-xl font-bold text-[15px] text-white transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-25 disabled:pointer-events-none shadow-lg shadow-[#22c55e]/20"
                style={{ backgroundColor: '#22c55e' }}
              >
                {tab === 'deposit'
                  ? `Deposit${parsedAmount >= 50 ? ' ' + formatCurrency(parsedAmount) : ''}`
                  : `Withdraw${parsedAmount >= 50 ? ' ' + formatCurrency(parsedAmount) : ''}`
                }
              </button>

              {/* Footer note */}
              <p className="text-[10px] text-slate-600 text-center pt-1">
                {tab === 'deposit' ? 'Funds credited instantly' : 'Processed within 1–5 minutes'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
