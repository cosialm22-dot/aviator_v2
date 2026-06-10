import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../types';

interface Props {
  children: React.ReactNode;
}

/**
 * AdminGuard handles three states:
 * 1. Loading - checking auth status
 * 2. Not authenticated - show admin login form
 * 3. Authenticated but not admin - show access denied
 * 4. Authenticated and admin - render children
 */
export default function AdminGuard({ children }: Props) {
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'denied' | 'authorized'>('loading');
  const [loginError, setLoginError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAuth();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAuth();
    });
    return () => subscription.unsubscribe();
  }, []);

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState('unauthenticated');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();

    const role = (profile?.role ?? 'player') as UserRole;
    if (role === 'admin' || role === 'super_admin') {
      setState('authorized');
    } else {
      setState('denied');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will trigger checkAuth
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#c8001c] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm bg-[#111122] border border-[#2a2a45] rounded-2xl p-8">
          <div className="text-center mb-8">
            <div className="text-2xl font-black text-white mb-1">Aviator Admin</div>
            <div className="text-sm text-slate-500">Sign in to continue</div>
          </div>

          {loginError && (
            <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
              {loginError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-white text-sm focus:outline-none focus:border-[#c8001c] transition"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-white text-sm focus:outline-none focus:border-[#c8001c] transition"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-[#c8001c] hover:bg-[#a50018] text-white font-semibold rounded-lg text-sm transition disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">⛔</div>
          <div className="text-xl font-bold text-white mb-2">Access Denied</div>
          <div className="text-sm text-slate-400 mb-6">You don’t have admin privileges.</div>
          <a href="/" className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg text-white text-sm hover:bg-[#2a2a45] transition">
            Back to Game
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
