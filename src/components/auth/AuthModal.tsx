import { useState } from 'react';
import { X, Eye, EyeOff, Plane, Phone } from 'lucide-react';

interface Props {
  onSignUp: (phone: string, password: string, username: string) => Promise<unknown>;
  onSignIn: (phone: string, password: string) => Promise<unknown>;
  onClose: () => void;
}

/** Normalize Kenyan phone: accepts 07XX, 01XX, +2547XX, 2547XX → returns 2547XXXXXXXX */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  return digits;
}

function isValidKenyanPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^254(7|1)[0-9]{8}$/.test(normalized);
}

export default function AuthModal({ onSignUp, onSignIn, onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidKenyanPhone(phone)) {
      setError('Enter a valid Kenyan phone number (e.g. 0712345678)');
      return;
    }

    setLoading(true);
    try {
      const normalized = normalizePhone(phone);
      if (mode === 'signup') {
        if (username.trim().length < 3) throw new Error('Username must be at least 3 characters');
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        await onSignUp(normalized, password, username.trim());
      } else {
        await onSignIn(normalized, password);
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      if (msg.includes('User already registered')) {
        setError('This phone number is already registered. Sign in instead.');
      } else if (msg.includes('Invalid login credentials')) {
        setError('Wrong phone number or password.');
      } else if (msg.includes('duplicate key') && msg.includes('username')) {
        setError('This username is already taken. Choose another.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0e1c2f] border border-[#1e3a5f] rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1e3a5f]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
              <Plane size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">
                {mode === 'signin' ? 'Welcome Back!' : 'Get KSh 500 Free!'}
              </h2>
              <p className="text-slate-400 text-xs">
                {mode === 'signin' ? 'Sign in and keep winning' : 'New players get KSh 500 bonus \u2014 no deposit needed!'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {mode === 'signup' && (
            <div className="bg-gradient-to-r from-green-900/40 to-emerald-900/40 border border-green-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="text-2xl">{'\ud83c\udf81'}</div>
              <div>
                <div className="text-green-400 font-black text-sm">KSh 500 FREE on signup!</div>
                <div className="text-slate-400 text-[11px]">Start playing immediately \u2014 no deposit required</div>
              </div>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
                minLength={3}
                maxLength={20}
                autoComplete="username"
                className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">Phone Number</label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Phone size={16} />
              </div>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="0712345678"
                required
                maxLength={13}
                autoComplete="tel"
                inputMode="numeric"
                className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg pl-10 pr-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                required
                minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-base bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
          >
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In & Play' : 'Claim KSh 500 & Play!'}
          </button>

          <p className="text-center text-slate-400 text-sm">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
              className="text-blue-400 hover:text-blue-300 font-semibold transition"
            >
              {mode === 'signin' ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
