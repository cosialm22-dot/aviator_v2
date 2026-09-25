import { useState, useEffect } from 'react';
import { ShieldOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AdminContext, makeIdentity, OPERATOR_ROLES, type AdminIdentity, type Role } from './roleContext';
import { normalizeKenyanPhone, isValidKenyanPhone } from '../lib/phone';
import { useSiteTheme } from '../hooks/useSiteTheme';
import BirdMark from '../components/game/BirdMark';
import ScopeProvider from './ScopeProvider';

// AdminGuard authenticates the session, authorises OPERATOR roles
// (platform_superadmin, platform_admin, super_admin, admin, finance_admin, support), rejects
// suspended (banned) accounts, and publishes the resolved identity to the panel
// via AdminContext, then the brand scope via ScopeProvider. Marketers and players
// are NOT operators - they use the player shell. The server RPCs remain the real gate.
const STAFF_ROLES: Role[] = OPERATOR_ROLES;

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { planeSkin } = useSiteTheme();
  const [state, setState] = useState<'loading' | 'login' | 'denied' | 'ok'>('loading');
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    check();
    // Never call Supabase synchronously inside onAuthStateChange (GoTrue holds its lock there and
    // a nested call deadlocks the client). Deferring with setTimeout(0) runs after the lock is released.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => { void check(); }, 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function check() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setIdentity(null); setState('login'); return; }
    const { data } = await supabase.from('profiles').select('role, is_banned, username, site_id, platform_id').eq('id', session.user.id).maybeSingle();
    const role = data?.role as Role | undefined;
    const banned = data?.is_banned === true;
    if (data && !banned && role && STAFF_ROLES.includes(role)) {
      setIdentity((prev) => (prev && prev.userId === session.user.id && prev.role === role ? prev
        : makeIdentity(session.user.id, role, { username: data.username ?? 'Admin', siteId: data.site_id ?? null, platformId: data.platform_id ?? null })));
      setState('ok');
    } else {
      setIdentity(null);
      setState('denied');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    // Operators may enter their Kenyan phone (phone@phone.aviator.ke) or a raw email.
    const id = email.trim();
    const loginEmail = isValidKenyanPhone(id) ? `${normalizeKenyanPhone(id)}@phone.aviator.ke` : id;
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (err) setError('Wrong phone, email or password.');
    setSubmitting(false);
  }

  if (state === 'loading') return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" aria-label="Loading" />
    </div>
  );

  if (state === 'login') return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-surface border border-line rounded-2xl p-8">
        <div className="text-center mb-8">
          <BirdMark skin={planeSkin} width={44} className="mx-auto mb-3 -rotate-12" />
          <div className="text-xl font-semibold text-ink mb-1">Admin sign in</div>
          <div className="text-sm text-muted">Staff accounts only</div>
        </div>
        {error && <div role="alert" className="mb-4 px-3 py-2 bg-down/10 border border-down/30 rounded-lg text-down text-xs">{error}</div>}
        <div className="space-y-4">
          <input type="text" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="Phone or email" aria-label="Phone or email"
            className="w-full h-10 px-3 bg-canvas border border-line rounded-lg text-ink text-sm focus:outline-none focus:border-brand/60" />
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" aria-label="Password"
            className="w-full h-10 px-3 bg-canvas border border-line rounded-lg text-ink text-sm focus:outline-none focus:border-brand/60" />
          <button type="submit" disabled={submitting} className="w-full h-10 bg-brand hover:brightness-110 text-white font-semibold rounded-lg text-sm transition disabled:opacity-50">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );

  if (state === 'denied' || !identity) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-down/10 text-down"><ShieldOff size={22} /></div>
        <div className="text-ink font-semibold text-lg">No access</div>
        <div className="text-muted text-sm mt-2">This account is not a staff account, or it is suspended.</div>
        <div className="mt-5 flex justify-center gap-2">
          <a href="/" className="px-4 h-9 inline-flex items-center rounded-lg border border-line text-ink text-sm">Back to the game</a>
          <button onClick={() => { void supabase.auth.signOut(); }} className="px-4 h-9 rounded-lg border border-line text-muted text-sm hover:text-ink">Sign out</button>
        </div>
      </div>
    </div>
  );

  return (
    <AdminContext.Provider value={identity}>
      <ScopeProvider>{children}</ScopeProvider>
    </AdminContext.Provider>
  );
}
