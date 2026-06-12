import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function AdminHeader() {
  const [name, setName] = useState('Admin');
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle();
      if (data) setName(data.username);
    });
  }, []);

  return (
    <header className="h-14 flex items-center justify-end px-6 border-b border-line bg-surface flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white text-xs font-semibold">{name[0]?.toUpperCase()}</div>
        <span className="text-ink text-sm font-medium">{name}</span>
        <button
          onClick={() => { supabase.auth.signOut(); window.location.href = '/'; }}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
