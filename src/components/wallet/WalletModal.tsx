import { useState } from 'react';
import { X, Smartphone, CreditCard, ArrowDownLeft, ArrowUpRight, CheckCircle, Loader } from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

interface Props {
  balance: number;
  onDeposit: (amount: number, method: 'mpesa' | 'card', details: Record<string, string>) => Promise<void>;
  onWithdraw: (amount: number, method: 'mpesa' | 'bank', details: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type Tab = 'deposit' | 'withdraw';
type DepositMethod = 'mpesa' | 'card';
type WithdrawMethod = 'mpesa' | 'bank';
type Step = 'form' | 'processing' | 'pin' | 'success';

const QUICK_DEPOSIT = [100, 500, 1000, 2000, 5000, 10000];
const QUICK_WITHDRAW = [100, 500, 1000, 2000, 5000];

export default function WalletModal({ balance, onDeposit, onWithdraw, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('deposit');
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('mpesa');
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>('mpesa');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;

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
    if (parsedAmount < 50) { setError('Minimum amount is KShs 50'); return; }

    if (tab === 'deposit') {
      if (depositMethod === 'mpesa') {
        if (!phone || phone.length < 9) { setError('Enter a valid phone number'); return; }
        // Simulate STK push -> show PIN input
        setStep('processing');
        await new Promise(r => setTimeout(r, 1500));
        setStep('pin');
        return;
      }
      if (depositMethod === 'card') {
        if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) { setError('Enter a valid card number'); return; }
        if (!cardExpiry || cardExpiry.length < 5) { setError('Enter expiry date'); return; }
        if (!cardCvv || cardCvv.length < 3) { setError('Enter CVV'); return; }
        if (!cardName) { setError('Enter cardholder name'); return; }
        setLoading(true);
        setStep('processing');
        try {
          await onDeposit(parsedAmount, 'card', { cardNumber, cardExpiry, cardCvv, cardName });
          setStep('success');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Payment failed');
          setStep('form');
        } finally {
          setLoading(false);
        }
      }
    } else {
      if (parsedAmount > balance) { setError('Insufficient balance'); return; }
      if (withdrawMethod === 'mpesa' && (!phone || phone.length < 9)) { setError('Enter a valid phone number'); return; }
      if (withdrawMethod === 'bank' && !bankAccount) { setError('Enter bank account number'); return; }
      setLoading(true);
      setStep('processing');
      try {
        await onWithdraw(parsedAmount, withdrawMethod, { phone, bankAccount });
        setStep('success');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Withdrawal failed');
        setStep('form');
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePinConfirm = async () => {
    if (pin !== '1234' && pin.length !== 4) { setError('Incorrect PIN'); return; }
    setLoading(true);
    setStep('processing');
    try {
      await onDeposit(parsedAmount, 'mpesa', { phone });
      setStep('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
      setStep('form');
    } finally {
      setLoading(false);
      setPin('');
    }
  };

  const reset = () => {
    setStep('form');
    setAmount('');
    setPhone('');
    setCardNumber('');
    setCardExpiry('');
    setCardCvv('');
    setCardName('');
    setBankAccount('');
    setPin('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0e1c2f] border border-[#1e3a5f] rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1e3a5f] sticky top-0 bg-[#0e1c2f] z-10">
          <div>
            <h2 className="text-white font-bold text-lg">Wallet</h2>
            <p className="text-slate-400 text-xs">Balance: <span className="text-white font-semibold">{formatCurrency(balance)}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1">
            <X size={20} />
          </button>
        </div>

        {/* Success */}
        {step === 'success' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-green-400" />
            </div>
            <h3 className="text-white font-bold text-xl mb-2">
              {tab === 'deposit' ? 'Deposit Successful!' : 'Withdrawal Successful!'}
            </h3>
            <p className="text-slate-400 text-sm mb-2">
              {tab === 'deposit' ? `KShs ${parsedAmount.toLocaleString('en-KE')} added to your wallet` : `KShs ${parsedAmount.toLocaleString('en-KE')} sent successfully`}
            </p>
            <p className="text-slate-500 text-xs mb-6">New balance: {formatCurrency(balance)}</p>
            <button
              onClick={reset}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition"
            >
              Make Another Transaction
            </button>
          </div>
        )}

        {/* Processing */}
        {step === 'processing' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Loader size={32} className="text-blue-400 animate-spin" />
            </div>
            <h3 className="text-white font-bold text-lg mb-2">Processing...</h3>
            <p className="text-slate-400 text-sm">Please wait while we process your transaction</p>
          </div>
        )}

        {/* M-Pesa PIN input */}
        {step === 'pin' && (
          <div className="p-6">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-green-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <Smartphone size={28} className="text-green-400" />
              </div>
              <h3 className="text-white font-bold text-lg">M-Pesa STK Push Sent</h3>
              <p className="text-slate-400 text-sm mt-1">
                A push notification has been sent to <span className="text-white">{phone}</span>
              </p>
              <p className="text-slate-500 text-xs mt-1">Enter your M-Pesa PIN to confirm</p>
            </div>

            <div className="bg-[#071120] border border-[#1e3a5f] rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Amount</span>
                <span className="text-white font-semibold">{formatCurrency(parsedAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">To</span>
                <span className="text-white">Aviator Game</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">M-Pesa PIN</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Enter 4-digit PIN"
                maxLength={4}
                className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-center text-2xl tracking-widest focus:outline-none focus:border-green-500 transition"
              />
              <p className="text-slate-600 text-xs mt-1 text-center">Demo PIN: 1234</p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm mb-4">{error}</div>
            )}

            <button
              onClick={handlePinConfirm}
              disabled={pin.length !== 4}
              className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-500 transition disabled:opacity-50"
            >
              Confirm Payment
            </button>
          </div>
        )}

        {/* Main form */}
        {step === 'form' && (
          <div className="p-5">
            {/* Tabs */}
            <div className="flex bg-[#071120] rounded-xl p-1 gap-1 mb-5">
              <button
                onClick={() => setTab('deposit')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition ${tab === 'deposit' ? 'bg-[#1a3a5c] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <ArrowDownLeft size={16} />
                Deposit
              </button>
              <button
                onClick={() => setTab('withdraw')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition ${tab === 'withdraw' ? 'bg-[#1a3a5c] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <ArrowUpRight size={16} />
                Withdraw
              </button>
            </div>

            {/* Deposit */}
            {tab === 'deposit' && (
              <div className="space-y-4">
                {/* Method select */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setDepositMethod('mpesa')}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${depositMethod === 'mpesa' ? 'border-green-500 bg-green-900/20' : 'border-[#1e3a5f] bg-[#071120] hover:border-slate-500'}`}
                  >
                    <Smartphone size={20} className={depositMethod === 'mpesa' ? 'text-green-400' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold ${depositMethod === 'mpesa' ? 'text-green-400' : 'text-slate-400'}`}>M-Pesa</span>
                  </button>
                  <button
                    onClick={() => setDepositMethod('card')}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${depositMethod === 'card' ? 'border-blue-500 bg-blue-900/20' : 'border-[#1e3a5f] bg-[#071120] hover:border-slate-500'}`}
                  >
                    <CreditCard size={20} className={depositMethod === 'card' ? 'text-blue-400' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold ${depositMethod === 'card' ? 'text-blue-400' : 'text-slate-400'}`}>Card</span>
                  </button>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Amount (KShs)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Enter amount"
                    min="50"
                    className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {QUICK_DEPOSIT.map(q => (
                      <button key={q} onClick={() => setAmount(String(q))}
                        className="px-2.5 py-1 text-xs bg-[#071120] border border-[#1e3a5f] rounded text-slate-300 hover:bg-[#1a3a5c] transition">
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    ))}
                  </div>
                </div>

                {depositMethod === 'mpesa' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Phone Number</label>
                    <div className="flex gap-2">
                      <div className="flex items-center bg-[#071120] border border-[#1e3a5f] rounded-lg px-3 text-slate-400 text-sm">+254</div>
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                        placeholder="7XX XXX XXX"
                        className="flex-1 bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-green-500 transition"
                      />
                    </div>
                  </div>
                )}

                {depositMethod === 'card' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Card Number</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={e => setCardNumber(formatCard(e.target.value))}
                        placeholder="1234 5678 9012 3456"
                        maxLength={19}
                        className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition tracking-widest"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Expiry</label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                          placeholder="MM/YY"
                          maxLength={5}
                          className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">CVV</label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                          placeholder="•••"
                          maxLength={3}
                          className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Cardholder Name</label>
                      <input
                        type="text"
                        value={cardName}
                        onChange={e => setCardName(e.target.value)}
                        placeholder="JOHN DOE"
                        className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition uppercase"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Withdraw */}
            {tab === 'withdraw' && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <button
                    onClick={() => setWithdrawMethod('mpesa')}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${withdrawMethod === 'mpesa' ? 'border-green-500 bg-green-900/20' : 'border-[#1e3a5f] bg-[#071120] hover:border-slate-500'}`}
                  >
                    <Smartphone size={20} className={withdrawMethod === 'mpesa' ? 'text-green-400' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold ${withdrawMethod === 'mpesa' ? 'text-green-400' : 'text-slate-400'}`}>M-Pesa</span>
                  </button>
                  <button
                    onClick={() => setWithdrawMethod('bank')}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${withdrawMethod === 'bank' ? 'border-blue-500 bg-blue-900/20' : 'border-[#1e3a5f] bg-[#071120] hover:border-slate-500'}`}
                  >
                    <CreditCard size={20} className={withdrawMethod === 'bank' ? 'text-blue-400' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold ${withdrawMethod === 'bank' ? 'text-blue-400' : 'text-slate-400'}`}>Bank</span>
                  </button>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Amount (KShs)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Enter amount"
                    min="50"
                    max={balance}
                    className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {QUICK_WITHDRAW.map(q => (
                      <button key={q} onClick={() => setAmount(String(Math.min(q, balance)))}
                        className="px-2.5 py-1 text-xs bg-[#071120] border border-[#1e3a5f] rounded text-slate-300 hover:bg-[#1a3a5c] transition">
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    ))}
                    <button onClick={() => setAmount(String(Math.floor(balance)))}
                      className="px-2.5 py-1 text-xs bg-[#071120] border border-[#1e3a5f] rounded text-slate-300 hover:bg-[#1a3a5c] transition">Max</button>
                  </div>
                </div>

                {withdrawMethod === 'mpesa' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">M-Pesa Phone Number</label>
                    <div className="flex gap-2">
                      <div className="flex items-center bg-[#071120] border border-[#1e3a5f] rounded-lg px-3 text-slate-400 text-sm">+254</div>
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                        placeholder="7XX XXX XXX"
                        className="flex-1 bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-green-500 transition"
                      />
                    </div>
                  </div>
                )}

                {withdrawMethod === 'bank' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      placeholder="Enter account number"
                      className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || parsedAmount < 1}
              className="w-full mt-5 py-3.5 rounded-xl font-bold text-base bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20"
            >
              {loading ? 'Processing...' : tab === 'deposit'
                ? `Deposit ${parsedAmount > 0 ? formatCurrency(parsedAmount) : ''}`
                : `Withdraw ${parsedAmount > 0 ? formatCurrency(parsedAmount) : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
