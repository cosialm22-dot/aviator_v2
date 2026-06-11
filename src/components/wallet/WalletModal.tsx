import { useState } from 'react';
import { X, CheckCircle, Loader, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

/* ─────────────────────────────────────────────────────────────────────────────
 * DESIGN SYSTEM
 *
 * Accent:        Green (#22c55e) for M-Pesa / success, Blue (#3b82f6) for bank
 * Isolation:     Key elements (amount, CTA) surrounded by generous whitespace
 * Grouping:      Related fields in bordered cards; methods in a row
 * Framing:       Outer modal → inner sections → field groups
 * Negative Space: 24-32px padding, spacious gaps between sections
 * Golden Ratio:  Content area ~61.8% vs info area ~38.2%
 * Movement:      Top→bottom flow: balance → method → amount → details → action
 * Diptych:       Deposit | Withdraw as two contrasting halves
 * Tension:       Dark muted bg vs vibrant CTA button
 * Symmetry:      Centered modal, balanced method cards, symmetric quick amounts
 * ───────────────────────────────────────────────────────────────────────────── */

// ─── Brand Icons ──────────────────────────────────────────────────────────────

function MpesaIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="12" fill="#4CAF50" fillOpacity="0.15" />
      <path d="M24 12c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12z" fill="#4CAF50" fillOpacity="0.2" />
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#4CAF50" fontSize="11" fontWeight="800" fontFamily="sans-serif">M</text>
      <path d="M14 34l2-4M34 34l-2-4" stroke="#4CAF50" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BankIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="12" fill="#3b82f6" fillOpacity="0.15" />
      <path d="M24 14l10 5v2H14v-2l10-5z" fill="#3b82f6" fillOpacity="0.8" />
      <rect x="16" y="22" width="2.5" height="8" rx="0.5" fill="#3b82f6" fillOpacity="0.6" />
      <rect x="21" y="22" width="2.5" height="8" rx="0.5" fill="#3b82f6" fillOpacity="0.6" />
      <rect x="26" y="22" width="2.5" height="8" rx="0.5" fill="#3b82f6" fillOpacity="0.6" />
      <rect x="31" y="22" width="2.5" height="8" rx="0.5" fill="#3b82f6" fillOpacity="0.6" />
      <rect x="14" y="31" width="20" height="3" rx="1" fill="#3b82f6" fillOpacity="0.8" />
    </svg>
  );
}

function CardIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="12" fill="#8b5cf6" fillOpacity="0.15" />
      <rect x="12" y="16" width="24" height="16" rx="3" fill="none" stroke="#8b5cf6" strokeWidth="1.5" />
      <rect x="12" y="20" width="24" height="4" fill="#8b5cf6" fillOpacity="0.3" />
      <rect x="15" y="27" width="8" height="2" rx="1" fill="#8b5cf6" fillOpacity="0.5" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  balance: number;
  onDeposit: (amount: number, method: 'mpesa' | 'card', details: Record<string, string>) => Promise<void>;
  onWithdraw: (amount: number, method: 'mpesa' | 'bank', details: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type Tab = 'deposit' | 'withdraw';
type Step = 'form' | 'processing' | 'pin' | 'success';

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000, 10000];

// ─── Component ────────────────────────────────────────────────────────────────

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

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const reset = () => {
    setStep('form');
    setAmount('');
    setPhone('');
    setCardNumber(''); setCardExpiry(''); setCardCvv(''); setCardName('');
    setBankAccount(''); setBankName('');
    setPin('');
    setError('');
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setMethod('mpesa');
    reset();
  };

  const formatCard = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 16);
    return clean.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    if (clean.length >= 2) return clean.slice(0, 2) + '/' + clean.slice(2);
    return clean;
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
        if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) { setError('Enter a valid card number'); return; }
        if (!cardExpiry || cardExpiry.length < 5) { setError('Enter expiry date'); return; }
        if (!cardCvv || cardCvv.length < 3) { setError('Enter CVV'); return; }
        setLoading(true);
        setStep('processing');
        try {
          await onDeposit(parsedAmount, 'card', { cardNumber, cardExpiry, cardCvv, cardName });
          setStep('success');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Payment failed');
          setStep('form');
        } finally { setLoading(false); }
      }
    } else {
      if (parsedAmount > balance) { setError('Insufficient balance'); return; }
      if (method === 'mpesa' && (!phone || phone.length < 9)) { setError('Enter a valid phone number'); return; }
      if (method === 'bank' && !bankAccount) { setError('Enter account number'); return; }
      setLoading(true);
      setStep('processing');
      try {
        await onWithdraw(parsedAmount, method as 'mpesa' | 'bank', { phone, bankAccount, bankName });
        setStep('success');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Withdrawal failed');
        setStep('form');
      } finally { setLoading(false); }
    }
  };

  const handlePinConfirm = async () => {
    if (pin.length !== 4) { setError('Enter 4-digit PIN'); return; }
    setLoading(true);
    setStep('processing');
    try {
      await onDeposit(parsedAmount, 'mpesa', { phone });
      setStep('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
      setStep('form');
    } finally { setLoading(false); setPin(''); }
  };

  // ─── Deposit methods available ──────────────────────────────────────────────
  const depositMethods = [
    { id: 'mpesa' as const, label: 'M-Pesa', icon: <MpesaIcon size={36} />, accent: '#22c55e' },
    { id: 'card' as const, label: 'Card', icon: <CardIcon size={36} />, accent: '#8b5cf6' },
  ];

  const withdrawMethods = [
    { id: 'mpesa' as const, label: 'M-Pesa', icon: <MpesaIcon size={36} />, accent: '#22c55e' },
    { id: 'bank' as const, label: 'Bank', icon: <BankIcon size={36} />, accent: '#3b82f6' },
  ];

  const methods = tab === 'deposit' ? depositMethods : withdrawMethods;
  const activeAccent = methods.find(m => m.id === method)?.accent ?? '#22c55e';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div
        className="bg-[#0a0e1a] border border-white/[0.06] w-full max-w-[420px] shadow-2xl shadow-black/60 overflow-hidden"
        style={{ borderRadius: '24px' }}
      >
        {/* ═══════════════ SUCCESS STATE ═══════════════ */}
        {step === 'success' && (
          <div className="px-8 py-14 text-center">
            {/* Isolation: icon floats in space */}
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ backgroundColor: `${activeAccent}15` }}
            >
              <CheckCircle size={30} style={{ color: activeAccent }} />
            </div>
            <h3 className="text-white font-bold text-xl tracking-tight">
              {tab === 'deposit' ? 'Deposit Successful' : 'Withdrawal Sent'}
            </h3>
            <p className="text-slate-500 text-sm mt-2">
              {formatCurrency(parsedAmount)} {tab === 'deposit' ? 'added to your wallet' : 'is on its way'}
            </p>
            {/* Tension: calm text vs bold CTA */}
            <button
              onClick={() => { reset(); }}
              className="mt-8 px-8 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ backgroundColor: activeAccent }}
            >
              Done
            </button>
          </div>
        )}

        {/* ═══════════════ PROCESSING STATE ═══════════════ */}
        {step === 'processing' && (
          <div className="px-8 py-16 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5 bg-white/[0.04]">
              <Loader size={22} className="text-slate-400 animate-spin" />
            </div>
            <p className="text-white font-medium">Processing</p>
            <p className="text-slate-600 text-xs mt-1">Please wait...</p>
          </div>
        )}

        {/* ═══════════════ PIN STATE (M-Pesa) ═══════════════ */}
        {step === 'pin' && (
          <div className="px-8 py-10">
            {/* Movement: icon → text → input → button (vertical flow) */}
            <div className="text-center mb-8">
              <div className="mx-auto mb-4"><MpesaIcon size={48} /></div>
              <h3 className="text-white font-bold text-lg">Confirm Payment</h3>
              <p className="text-slate-500 text-xs mt-1">
                STK push sent to +254{phone}
              </p>
            </div>

            {/* Framing: amount summary card */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-sm">Amount</span>
                <span className="text-white font-bold">{formatCurrency(parsedAmount)}</span>
              </div>
            </div>

            {/* Isolation: PIN input centered with space */}
            <div className="mb-6">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider block mb-2 text-center">M-Pesa PIN</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="• • • •"
                maxLength={4}
                autoFocus
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-4 text-white text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:border-[#22c55e]/50 transition-colors"
              />
            </div>

            {error && <p className="text-red-400 text-xs text-center mb-4">{error}</p>}

            <button
              onClick={handlePinConfirm}
              disabled={pin.length !== 4}
              className="w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none"
              style={{ backgroundColor: '#22c55e' }}
            >
              Confirm
            </button>
          </div>
        )}

        {/* ═══════════════ MAIN FORM ═══════════════ */}
        {step === 'form' && (
          <>
            {/* ─── Header: Balance + Close ─── */}
            {/* Symmetry: balance left, close right */}
            <div className="flex items-center justify-between px-7 pt-7 pb-0">
              <div>
                <p className="text-[11px] text-slate-600 uppercase tracking-wider">Balance</p>
                <p className="text-white font-bold text-lg tabular-nums mt-0.5">{formatCurrency(balance)}</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-slate-500 hover:text-white transition-all"
              >
                <X size={14} />
              </button>
            </div>

            {/* ─── Diptych: Deposit | Withdraw tabs ─── */}
            {/* Tension: active tab = solid, inactive = ghost */}
            <div className="px-7 pt-6 pb-0">
              <div className="flex bg-white/[0.03] border border-white/[0.06] rounded-xl p-1 gap-1">
                {(['deposit', 'withdraw'] as Tab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => switchTab(t)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      tab === t
                        ? 'bg-white/[0.08] text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t === 'deposit' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    <span className="capitalize">{t}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Content Area ─── */}
            <div className="px-7 pt-6 pb-7 space-y-6">

              {/* ─── Method Selection ─── */}
              {/* Grouping: methods in a symmetric row */}
              {/* Golden Ratio: icon area 38% vs text 62% within each card */}
              <div>
                <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-3">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  {methods.map(m => {
                    const isActive = method === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMethod(m.id)}
                        className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                          isActive
                            ? 'bg-white/[0.04] shadow-sm'
                            : 'bg-transparent border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]'
                        }`}
                        style={{
                          borderColor: isActive ? `${m.accent}40` : undefined,
                        }}
                      >
                        {/* Accent: active indicator dot */}
                        {isActive && (
                          <div
                            className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full"
                            style={{ backgroundColor: m.accent }}
                          />
                        )}
                        {m.icon}
                        <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-slate-500'}`}>
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ─── Amount Input ─── */}
              {/* Isolation: the amount field is the hero — extra space around it */}
              <div>
                <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-3">Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 text-sm font-medium">KSh</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0"
                    min="50"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-12 pr-4 py-4 text-white text-lg font-semibold tabular-nums placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                  />
                </div>
                {/* Symmetry: quick amounts in balanced grid */}
                <div className="grid grid-cols-6 gap-1.5 mt-3">
                  {QUICK_AMOUNTS.map(q => (
                    <button
                      key={q}
                      onClick={() => setAmount(String(tab === 'withdraw' ? Math.min(q, balance) : q))}
                      className={`py-2 rounded-lg text-[11px] font-medium transition-all ${
                        parseFloat(amount) === q
                          ? 'bg-white/[0.1] text-white'
                          : 'bg-white/[0.03] text-slate-500 hover:bg-white/[0.06] hover:text-slate-300'
                      }`}
                    >
                      {q >= 1000 ? `${q / 1000}K` : q}
                    </button>
                  ))}
                </div>
                {tab === 'withdraw' && (
                  <button
                    onClick={() => setAmount(String(Math.floor(balance)))}
                    className="mt-2 text-[11px] text-slate-600 hover:text-white transition-colors"
                  >
                    Withdraw all →
                  </button>
                )}
              </div>

              {/* ─── Details Fields ─── */}
              {/* Framing: fields grouped in a subtle bordered section */}
              {(method === 'mpesa') && (
                <div>
                  <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-3">
                    {tab === 'deposit' ? 'Pay from' : 'Send to'}
                  </label>
                  <div className="flex gap-2">
                    <div className="flex items-center bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5">
                      <span className="text-slate-500 text-sm">+254</span>
                    </div>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="7XX XXX XXX"
                      className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                    />
                  </div>
                </div>
              )}

              {(method === 'bank' && tab === 'withdraw') && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">Bank Name</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. Equity, KCB, Co-op"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">Account Number</label>
                    <input
                      type="text"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      placeholder="Enter account number"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                    />
                  </div>
                </div>
              )}

              {(method === 'card' && tab === 'deposit') && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">Card Number</label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={e => setCardNumber(formatCard(e.target.value))}
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm tracking-widest font-mono placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                    />
                  </div>
                  {/* Symmetry: expiry + CVV side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">Expiry</label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                        placeholder="MM/YY"
                        maxLength={5}
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">CVV</label>
                      <input
                        type="password"
                        value={cardCvv}
                        onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="•••"
                        maxLength={3}
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600 uppercase tracking-wider block mb-2">Cardholder</label>
                    <input
                      type="text"
                      value={cardName}
                      onChange={e => setCardName(e.target.value)}
                      placeholder="Name on card"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-slate-700 focus:outline-none focus:border-white/[0.16] transition-colors uppercase"
                    />
                  </div>
                </div>
              )}

              {/* ─── Error ─── */}
              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-500/[0.06] border border-red-500/[0.15]">
                  <p className="text-red-400 text-xs text-center">{error}</p>
                </div>
              )}

              {/* ─── Submit CTA ─── */}
              {/* Accent + Tension: bold colored button against muted background */}
              {/* Movement: the eye naturally arrives here last (bottom of flow) */}
              <button
                onClick={handleSubmit}
                disabled={loading || parsedAmount < 50}
                className="w-full py-4 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none"
                style={{ backgroundColor: activeAccent }}
              >
                {tab === 'deposit'
                  ? `Deposit ${parsedAmount >= 50 ? formatCurrency(parsedAmount) : ''}`
                  : `Withdraw ${parsedAmount >= 50 ? formatCurrency(parsedAmount) : ''}`
                }
              </button>

              {/* Negative Space: subtle footer text, lots of air above */}
              <p className="text-[10px] text-slate-700 text-center">
                {tab === 'deposit'
                  ? 'Funds are credited instantly'
                  : 'Processing takes 1-5 minutes'
                }
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
