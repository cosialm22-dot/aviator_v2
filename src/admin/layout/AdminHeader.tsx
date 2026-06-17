import { useEffect, useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface AdminHeaderProps {
  /** Opens the off-canvas navigation drawer (below `lg`). */
  onMenuClick: () => void;
}

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  const [name, setName] = useState('Admin');
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle();
      if (data) setName(data.username);
    });
  }, []);

  return (
    <header className="h-14 flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-line bg-surface flex-shrink-0">
      {/* Left: hamburger (mobile) + brand context. The sidebar carries the brand
          on `lg+`, so this title only shows when the drawer is hidden. */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 -ml-1.5 rounded-lg text-muted hover:text-ink hover:bg-line/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
        >
          <Menu size={18} />
        </button>
        <span className="lg:hidden font-semibold text-ink text-sm tracking-tight truncate">Aviator Admin</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white text-xs font-semibold">{name[0]?.toUpperCase()}</div>
        <span className="hidden sm:inline text-ink text-sm font-medium">{name}</span>
        <button
          onClick={() => { supabase.auth.signOut(); window.location.href = '/'; }}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-down hover:bg-down/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
