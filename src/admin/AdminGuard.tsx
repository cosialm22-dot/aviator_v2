import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AdminContext, makeIdentity, OPERATOR_ROLES, type AdminIdentity, type Role } from './roleContext';
import { normalizeKenyanPhone, isValidKenyanPhone } from '../lib/phone';
import { useSiteTheme } from '../hooks/useSiteTheme';
import BirdMark from '../components/game/BirdMark';

// AdminGuard authenticates the session, authorises OPERATOR roles
// (platform_superadmin, super_admin, admin, finance_admin, support), rejects
// suspended (banned) accounts, and publishes the resolved identity to the panel
// via AdminContext. Marketers and players are NOT operators - they use the
// player shell (/marketer hub), so they are denied here. Route gating
// downstream reads useAdmin(). The server RPCs remain the real gate.
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
    // CRITICAL: never call Supabase methods synchronously inside the
    // onAuthStateChange callback. GoTrue invokes this callback while holding its
    // internal navigator lock; any nested Supabase call (getSession, or any
    // .from() query which attaches the JWT via getSession) re-acquires that lock
    // and deadlocks the entire client - every subsequent request hangs forever,
    // freezing all admin navigation. Deferring with setTimeout(0) runs check()
    // after the lock is released. See supabase/auth-js lock-deadlock guidance.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => { void check(); }, 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function check() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setIdentity(null); setState('login'); return; }
    const { data } = await supabase.from('profiles').select('role, is_banned').eq('id', session.user.id).maybeSingle();
    const role = data?.role as Role | undefined;
    const banned = data?.is_banned === true;
    if (data && !banned && role && STAFF_ROLES.includes(role)) {
      setIdentity(makeIdentity(session.user.id, role));
      setState('ok');
    } else {
      setIdentity(null);
      setState('denied');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    // Operators may enter either their Kenyan phone (same identity the player
    // shell uses -> phone@phone.aviator.ke) or a raw email. Phones are
    // normalised to the canonical 254XXXXXXXXX before building the login email.
    const id = email.trim();
    const loginEmail = isValidKenyanPhone(id) ? `${normalizeKenyanPhone(id)}@phone.aviator.ke` : id;
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (err) { console.error("[Admin Auth]", err.message); setError("Invalid credentials."); }
    setSubmitting(false);
  }

  if (state === 'loading') return (
    <div className="min-h-screen bg-night-deep flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-danger border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (state === 'login') return (
    <div className="min-h-screen bg-night-deep flex items-center justify-center p-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-[#111122] border border-edge rounded-2xl p-8">
        <div className="text-center mb-8">
          <BirdMark skin={planeSkin} width={44} className="mx-auto mb-3 -rotate-12" />
          <div className="text-2xl font-black text-white mb-1">Aviator Admin</div>
          <div className="text-sm text-slate-500">Sign in to continue</div>
        </div>
        {error && <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">{error}</div>}
        <div className="space-y-4">
          <input type="text" inputMode="text" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="Phone or email" className="w-full px-3 py-2.5 bg-night-deep border border-edge rounded-lg text-white text-sm focus:outline-none focus:border-danger" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" className="w-full px-3 py-2.5 bg-night-deep border border-edge rounded-lg text-white text-sm focus:outline-none focus:border-danger" />
          <button type="submit" disabled={submitting} className="w-full py-2.5 bg-danger hover:bg-[#a50018] text-white font-semibold rounded-lg text-sm transition disabled:opacity-50">
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
    </div>
  );

  if (state === 'denied' || !identity) return (
    <div className="min-h-screen bg-night-deep flex items-center justify-center p-4 text-center">
      <div><div className="text-4xl mb-4">&#x26d4;</div><div className="text-white font-bold text-lg">Access Denied</div><div className="text-slate-400 text-sm mt-2">No admin privileges, or this account is suspended.</div><a href="/" className="inline-block mt-4 px-4 py-2 bg-panel-raised rounded-lg text-white text-sm">Back to Game</a></div>
    </div>
  );

  return <AdminContext.Provider value={identity}>{children}</AdminContext.Provider>;
}
