import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Gift } from 'lucide-react';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
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
  const cfg = usePaymentConfig();

  // Re-focus the first field when the mode flips (username for sign-up, phone for
  // sign-in). Initial focus on open is handled by useModalA11y.
  useEffect(() => { firstFieldRef.current?.focus(); }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidKenyanPhone(phone)) {
      setError('Enter a valid phone number, e.g. 0712345678');
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

  const inputCls = 'h-12 w-full rounded-xl border border-[#2f3033] bg-[#141516] px-4 text-white placeholder:text-[#5c5d60] focus:border-win/60 focus:outline-none';
  const offer = cfg.offer;
  const offerText = offer
    ? [offer.welcome > 0 ? `${offer.welcome.toLocaleString('en-KE')} KES free` : '', offer.matchPct > 0 && offer.matchCap > 0 ? `+${offer.matchPct}% first deposit` : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-title"
        className="relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-[#2a2b2e] bg-[#1b1c1d] pb-[env(safe-area-inset-bottom)] shadow-2xl animate-[sheetUp_0.2s_ease-out] sm:max-w-[380px] sm:rounded-2xl">
        <div className="flex items-center justify-between py-2 pl-5 pr-1">
          <h1 id="auth-title" className="text-xl font-bold text-white">{isSignup ? 'Register' : 'Log in'}</h1>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[#9ea0a3] hover:text-white"><X size={20} /></button>
        </div>

        {isSignup && offerText && (
          <p className="mx-5 mb-1 flex items-center gap-2 rounded-xl bg-win/10 px-3 py-2.5 text-[13px] font-semibold text-[#5cd334]">
            <Gift size={16} className="shrink-0" />{offerText}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 px-5 pb-5 pt-3">
          {isSignup && (
            <input id="auth-username" ref={firstFieldRef} type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Username" aria-label="Username" required minLength={3} maxLength={20} autoComplete="username"
              autoCapitalize="none" className={inputCls} />
          )}
          <input id="auth-phone" ref={isSignup ? undefined : firstFieldRef} type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Phone (07XX XXX XXX)" aria-label="Phone number" required maxLength={13} autoComplete="tel" inputMode="numeric"
            className={inputCls} />
          <div className="relative">
            <input id="auth-password" type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              placeholder={isSignup ? 'Password (6+ characters)' : 'Password'} aria-label="Password" required minLength={isSignup ? 6 : undefined}
              autoComplete={isSignup ? 'new-password' : 'current-password'} className={`${inputCls} pr-12`} />
            <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center text-[#7b7b7b] hover:text-white">
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <p role="alert" className="text-center text-[13px] text-red-400">{error}</p>}

          <button type="submit" disabled={loading}
            className="h-12 w-full rounded-xl bg-win text-[15px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
            {loading ? '…' : isSignup ? 'Register' : 'Log in'}
          </button>

          <button type="button" onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); }}
            className="h-10 w-full text-[13px] text-[#9ea0a3] hover:text-white">
            {isSignup ? 'Have an account? ' : 'New here? '}<span className="font-semibold text-[#5cd334]">{isSignup ? 'Log in' : 'Register'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
