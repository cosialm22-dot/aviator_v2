import { useLocation, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LayoutDashboard, Users, Gamepad2, Banknote, Wallet, Settings } from 'lucide-react';

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: Users, label: 'Players', path: '/admin/users' },
  { icon: Gamepad2, label: 'Game Control', path: '/admin/game' },
  { icon: Banknote, label: 'Withdrawals', path: '/admin/withdrawals' },
  { icon: Wallet, label: 'Finance', path: '/admin/finance' },
  { icon: Settings, label: 'Settings', path: '/admin/settings' },
];

export default function AdminSidebar() {
  const { pathname } = useLocation();
  const isActive = (p: string) => p === '/admin' ? pathname === '/admin' || pathname === '/admin/dashboard' : pathname.startsWith(p);

  // Live count of pending withdrawals, shown as a badge so admins are notified
  // of new payout requests from anywhere in the dashboard. Loads once, then
  // stays current via a Realtime subscription on withdrawal_requests (admins
  // have SELECT via the admin_full_access RLS policy, so changes are delivered).
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { count } = await supabase
        .from('withdrawal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (active) setPending(count ?? 0);
    };
    load();
    const channel = supabase
      .channel('admin-withdrawals-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_requests' }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  return (
    <aside className="w-56 bg-brand-dark flex flex-col flex-shrink-0 hidden lg:flex">
      <div className="h-14 flex items-center px-5 border-b border-white/10">
        <Link to="/admin" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#c8001c] rounded-lg flex items-center justify-center"><span className="text-white text-xs font-black">A</span></div>
          <span className="text-white font-semibold text-sm tracking-tight">Aviator Admin</span>
        </Link>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV.map(({ icon: Icon, label, path }) => {
          const active = isActive(path);
          const badge = path === '/admin/withdrawals' && pending > 0;
          return (
            <Link
              key={path}
              to={path}
              aria-current={active ? 'page' : undefined}
              className={'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-colors ' + (active ? 'bg-white/10 text-white font-medium' : 'text-white/55 hover:text-white hover:bg-white/[0.06]')}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-gold" />}
              <Icon size={16} strokeWidth={1.75} />{label}
              {badge && (
                <span
                  aria-label={`${pending} pending withdrawals`}
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-gold text-brand-dark text-[11px] font-bold tabular-nums"
                >
                  {pending > 99 ? '99+' : pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-white/10">
        <a href="/" className="text-white/55 hover:text-white text-xs transition-colors">&larr; Back to Game</a>
      </div>
    </aside>
  );
}
