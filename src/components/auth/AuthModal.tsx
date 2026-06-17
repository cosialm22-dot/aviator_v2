import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Phone, Gift } from 'lucide-react';
import { normalizeKenyanPhone, isValidKenyanPhone } from '../../lib/phone';
import { useModalA11y } from '../../hooks/useModalA11y';

interface Props {
  initialMode: 'signin' | 'signup';
  onSignUp: (phone: string, password: string, username: string) => Promise<unknown>;
  onSignIn: (phone: string, password: string) => Promise<unknown>;
  onClose: () => void;
}

export default function AuthModal({ initialMode, onSignUp, onSignIn, onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalA11y(onClose, firstFieldRef);

  const isSignup = mode === 'signup';

  // Re-focus the first field when the mode flips (username for sign-up, phone for
  // sign-in). Initial focus on open is handled by useModalA11y.
  useEffect(() => { firstFieldRef.current?.focus(); }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidKenyanPhone(phone)) {
      setError('Enter a valid Kenyan phone number (e.g. 0712345678)');
      return;
    }
    // Enforce the minimum only on sign-up (account creation). Supabase enforces
    // a 6-char minimum server-side, so no existing account can be weaker; on
    // sign-in we stay permissive and let the server authenticate whatever the
    // user has, rather than risk locking anyone out with a new client rule.
    if (isSignup && password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const normalized = normalizeKenyanPhone(phone);
      if (mode === 'signup') {
        if (username.trim().length < 3) throw new Error('Username must be at least 3 characters');
        await onSignUp(normalized, password, username.trim());
      } else {
        await onSignIn(normalized, password);
      }
      onClose();
    } catch (err) {
      // Errors from useAuth are already sanitized for user display.
      // Never show raw/unfiltered error messages.
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    // Scrollable overlay: the dialog stays centred when it fits and the whole
    // overlay scrolls when the form is taller than the viewport (short / landscape
    // phones) so the CTA is always reachable.
    // Dark scrim (player `night` token at 80% + blur) dims the page behind the
    // modal. This keeps the app's dark theme consistent while the elevated card
    // below still reads as distinct via its lighter gradient, border and shadow.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-night/80 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-title"
          className="w-full max-w-[380px] relative overflow-hidden rounded-[20px] border border-edge"
          style={{
            // Elevated card: its gradient sits a step lighter than the `night`
            // page/scrim, and the deep drop shadow lifts it off the dimmed
            // backdrop for clear separation without breaking the dark theme.
            background: 'linear-gradient(180deg, #1c1c33 0%, #141426 100%)',
            boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* ─── CONTENT ─── */}
          <div className="relative">

            {/* ─── CLOSE BUTTON ─── */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-500 hover:text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-win/60"
            >
              <X size={15} />
            </button>

            {/* ─── HEADER ─── */}
            <div className="px-8 pt-10 pb-2">
              <h1 id="auth-title" className="text-[22px] font-bold text-white tracking-tight">
                {isSignup ? 'Create Account' : 'Welcome back'}
              </h1>
              <p className="text-slate-500 text-[13px] mt-1">
                {isSignup ? 'Start playing in 30 seconds' : 'Sign in to continue'}
              </p>
            </div>

            {/* ─── BONUS BANNER ─── */}
            {isSignup && (
              <div className="mx-8 mt-5 mb-1">
                <div className="relative overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-950/30 px-5 py-4">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/[0.04] rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="relative flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                      <Gift size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-emerald-400 font-bold text-[15px] leading-tight">100% first-deposit match</div>
                      <div className="text-slate-400 text-[11px] mt-0.5">Double your first deposit up to KSh 500 &mdash; plus KSh 500 free to start</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── FORM ─── */}
            <form onSubmit={handleSubmit} className="px-8 pt-6 pb-8">
              <div className="space-y-4">

                {/* Username (signup only) */}
                {isSignup && (
                  <div>
                    <label htmlFor="auth-username" className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block mb-2">Username</label>
                    <input
                      id="auth-username"
                      ref={firstFieldRef}
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="e.g. Kamau_254"
                      required
                      minLength={3}
                      maxLength={20}
                      autoComplete="username"
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5 text-white text-[14px] focus:outline-none focus:border-win/50 focus:bg-white/[0.05] transition-all placeholder:text-slate-500"
                    />
                  </div>
                )}

                {/* Phone */}
                <div>
                  <label htmlFor="auth-phone" className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block mb-2">Phone Number</label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Phone size={15} strokeWidth={1.5} />
                    </div>
                    <input
                      id="auth-phone"
                      ref={isSignup ? undefined : firstFieldRef}
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="0712 345 678"
                      required
                      maxLength={13}
                      autoComplete="tel"
                      inputMode="numeric"
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl pl-11 pr-4 py-3.5 text-white text-[14px] focus:outline-none focus:border-win/50 focus:bg-white/[0.05] transition-all placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="auth-password" className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block mb-2">Password</label>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={isSignup ? 'Min 6 characters' : 'Your password'}
                      required
                      minLength={isSignup ? 6 : undefined}
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5 text-white text-[14px] focus:outline-none focus:border-win/50 focus:bg-white/[0.05] transition-all pr-12 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-win/60 rounded"
                    >
                      {showPass ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* ─── ERROR ─── */}
              {error && (
                <div role="alert" className="mt-4 rounded-xl bg-red-500/[0.08] border border-red-500/20 px-4 py-3 text-red-400 text-[13px] leading-snug">
                  {error}
                </div>
              )}

              {/* ─── CTA BUTTON ─── */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-6 py-4 rounded-xl font-semibold text-[15px] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-win/70"
                style={{
                  background: loading ? '#1e293b' : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  boxShadow: loading ? 'none' : '0 8px 32px rgba(34, 197, 94, 0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
                }}
              >
                {loading ? 'Please wait...' : isSignup ? 'Create Account' : 'Sign In'}
              </button>

              {/* ─── MODE TOGGLE ─── */}
              <div className="mt-6 text-center">
                <span className="text-slate-400 text-[13px]">
                  {isSignup ? 'Have an account?' : 'New here?'}
                </span>
                <button
                  type="button"
                  onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); }}
                  className="ml-2 text-win hover:text-[#4ade80] text-[13px] font-medium transition rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-win/60"
                >
                  {isSignup ? 'Sign In' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
