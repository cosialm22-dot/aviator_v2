import { useState } from 'react';
import { X, Eye, EyeOff, Plane } from 'lucide-react';

interface Props {
  onSignUp: (email: string, password: string, username: string) => Promise<unknown>;
  onSignIn: (email: string, password: string) => Promise<unknown>;
  onClose: () => void;
}

export default function AuthModal({ onSignUp, onSignIn, onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (username.length < 3) throw new Error('Username must be at least 3 characters');
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        await onSignUp(email, password, username);
      } else {
        await onSignIn(email, password);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
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
                {mode === 'signin' ? 'Sign in and keep winning' : 'New players get KSh 500 bonus — no deposit needed!'}
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
              <div className="text-2xl">🎁</div>
              <div>
                <div className="text-green-400 font-black text-sm">KSh 500 FREE on signup!</div>
                <div className="text-slate-400 text-[11px]">Start playing immediately — no deposit required</div>
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
                className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full bg-[#071120] border border-[#1e3a5f] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
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
