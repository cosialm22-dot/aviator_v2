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
    <header className="h-14 flex items-center justify-between px-6 border-b border-[#1e1e35] bg-[#0d0d1a] flex-shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-[#c8001c] flex items-center justify-center text-white text-xs font-bold">{name[0]?.toUpperCase()}</div>
        <span className="text-white text-sm font-medium">{name}</span>
        <button onClick={() => { supabase.auth.signOut(); window.location.href = '/'; }} className="p-2 text-slate-400 hover:text-red-400"><LogOut size={15} /></button>
      </div>
    </header>
  );
}
