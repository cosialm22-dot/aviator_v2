import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Gift } from 'lucide-react';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
import { normalizeKenyanPhone, isValidKenyanPhone } from '../../lib/phone';
import Sheet from '../ui/Sheet';
import { Button, Field } from '../ui/ios';

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

  const isSignup = mode === 'signup';
  const cfg = usePaymentConfig();

  // Re-focus the first field when the mode flips (username for sign-up, phone for
  // sign-in). Initial focus on open is handled by the sheet.
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

  const offer = cfg.offer;
  const offerText = offer
    ? [offer.welcome > 0 ? `${offer.welcome.toLocaleString('en-KE')} KES free` : '', offer.matchPct > 0 && offer.matchCap > 0 ? `+${offer.matchPct}% first deposit` : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <Sheet title={isSignup ? 'Register' : 'Log in'} onClose={onClose} initialFocus={firstFieldRef}>
      <form onSubmit={handleSubmit} className="px-4 pt-1">
        {isSignup && offerText && (
          <p className="mb-4 flex items-center gap-2.5 rounded-xl bg-[rgba(48,209,88,0.12)] px-4 py-3 text-subhead font-medium text-ios-green">
            <Gift size={18} className="shrink-0" />{offerText}
          </p>
        )}
        <div className="space-y-3">
          {isSignup && (
            <Field id="auth-username" ref={firstFieldRef} type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Username" aria-label="Username" required minLength={3} maxLength={20} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          )}
          <Field id="auth-phone" ref={isSignup ? undefined : firstFieldRef} type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Phone number" aria-label="Phone number" required maxLength={13} autoComplete="tel" inputMode="numeric" />
          <Field id="auth-password" type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" aria-label="Password" required minLength={isSignup ? 6 : undefined}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            trailing={<button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'}
              className="-mr-2 grid h-11 w-11 place-items-center text-ios-label2">{showPass ? <EyeOff size={18} /> : <Eye size={18} />}</button>} />
        </div>
        {isSignup ? <p className="px-4 pt-1.5 text-footnote text-ios-label2">At least 6 characters.</p> : null}

        {error && <p role="alert" className="mt-3 px-2 text-center text-footnote text-ios-red">{error}</p>}

        <Button type="submit" disabled={loading} className="mt-5">{loading ? '…' : isSignup ? 'Register' : 'Log in'}</Button>

        <p className="mt-3 text-center text-subhead text-ios-label2">
          {isSignup ? 'Have an account? ' : 'New here? '}
          <button type="button" onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); }}
            className="inline-flex h-11 items-center font-semibold text-ios-green">{isSignup ? 'Log in' : 'Register'}</button>
        </p>
      </form>
    </Sheet>
  );
}
