import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../types';

export interface AdminProfile {
  id: string;
  username: string;
  avatar_color: string;
  role: UserRole;
}

let _adminProfile: AdminProfile | null = null;
export function getAdminProfile(): AdminProfile | null { return _adminProfile; }

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'authorized' | 'unauthorized'>('loading');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { if (!cancelled) setState('unauthorized'); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, avatar_color, role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
        if (!cancelled) setState('unauthorized'); return;
      }
      _adminProfile = { id: profile.id, username: profile.username, avatar_color: profile.avatar_color, role: profile.role as UserRole };
      if (!cancelled) setState('authorized');
    }
    checkAuth();
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#c8001c] border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400 text-sm">Verifying admin access...</span>
        </div>
      </div>
    );
  }

  if (state === 'unauthorized') {
    return (
      <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center p-4">
        <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">&#x1f512;</div>
          <h1 className="text-white text-lg font-bold mb-2">Access Denied</h1>
          <p className="text-slate-400 text-sm mb-6">You need admin privileges to access this area.</p>
          <button onClick={() => navigate('/')} className="w-full py-2.5 bg-[#c8001c] hover:bg-[#a50018] text-white rounded-lg text-sm font-semibold transition-colors">Return to Game</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
