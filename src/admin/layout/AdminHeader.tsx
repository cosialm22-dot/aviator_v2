import { useState, useEffect } from 'react';
import { Menu, Bell, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  onMenuToggle: () => void;
}

export default function AdminHeader({ onMenuToggle }: Props) {
  const [adminName, setAdminName] = useState('Admin');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase
        .from('profiles')
        .select('username, role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (data) setAdminName(data.username);
    });
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <header className="h-16 flex items-center justify-between px-4 lg:px-6 border-b border-[#1e1e35] bg-[#0d0d1a] flex-shrink-0">
      {/* Left: menu toggle (mobile) */}
      <button onClick={onMenuToggle} className="lg:hidden text-slate-400 hover:text-white p-2 -ml-2">
        <Menu size={20} />
      </button>

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Right: notifications + admin info */}
      <div className="flex items-center gap-3">
        <button className="relative p-2 text-slate-400 hover:text-white transition">
          <Bell size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#c8001c] rounded-full" />
        </button>

        <div className="h-8 w-px bg-[#1e1e35]" />

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#c8001c] flex items-center justify-center">
            <span className="text-white text-xs font-bold">{adminName[0]?.toUpperCase()}</span>
          </div>
          <span className="text-sm text-white font-medium hidden sm:block">{adminName}</span>
        </div>

        <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition" title="Logout">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
