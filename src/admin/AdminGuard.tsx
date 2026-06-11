import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'login' | 'denied' | 'ok'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check());
    return () => subscription.unsubscribe();
  }, []);

  async function check() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setState('login'); return; }
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    if (data && (data.role === 'admin' || data.role === 'super_admin')) setState('ok');
    else setState('denied');
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setSubmitting(false);
  }

  if (state === 'loading') return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#c8001c] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (state === 'login') return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-[#111122] border border-[#2a2a45] rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="text-2xl font-black text-white mb-1">Aviator Admin</div>
          <div className="text-sm text-slate-500">Sign in to continue</div>
        </div>
        {error && <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">{error}</div>}
        <div className="space-y-4">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="Email" className="w-full px-3 py-2.5 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-white text-sm focus:outline-none focus:border-[#c8001c]" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" className="w-full px-3 py-2.5 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-white text-sm focus:outline-none focus:border-[#c8001c]" />
          <button type="submit" disabled={submitting} className="w-full py-2.5 bg-[#c8001c] hover:bg-[#a50018] text-white font-semibold rounded-lg text-sm transition disabled:opacity-50">
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
    </div>
  );

  if (state === 'denied') return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4 text-center">
      <div><div className="text-4xl mb-4">&#x26d4;</div><div className="text-white font-bold text-lg">Access Denied</div><div className="text-slate-400 text-sm mt-2">No admin privileges.</div><a href="/" className="inline-block mt-4 px-4 py-2 bg-[#1a1a2e] rounded-lg text-white text-sm">Back to Game</a></div>
    </div>
  );

  return <>{children}</>;
}
