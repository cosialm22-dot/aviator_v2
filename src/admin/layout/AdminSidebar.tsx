import { useLocation, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LayoutDashboard, Users, Gamepad2, Banknote, Wallet, Settings, Megaphone, ShieldAlert, Building2, Bell, Ticket } from 'lucide-react';
import { useAdmin, canAccess, type Section } from '../roleContext';

// `marketing` is the operator Marketing hub (affiliates + promotions +
// commissions). Commissions is no longer a top-level item - it is a tab inside
// the hub. Marketers manage their own affiliate data in the /marketer hub
// (player shell) and never reach this panel.
const NAV: { icon: typeof LayoutDashboard; label: string; path: string; section: Section }[] = [
  { icon: Building2, label: 'Platform', path: '/admin/platform', section: 'platform' },
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin', section: 'dashboard' },
  { icon: Megaphone, label: 'Marketing', path: '/admin/marketing', section: 'marketing' },
  { icon: Bell, label: 'Notifications', path: '/admin/notifications', section: 'notifications' },
  { icon: Ticket, label: 'Promo Codes', path: '/admin/promo-codes', section: 'marketing' },
  { icon: Users, label: 'Players', path: '/admin/users', section: 'users' },
  { icon: Gamepad2, label: 'Game Control', path: '/admin/game', section: 'game' },
  { icon: Banknote, label: 'Withdrawals', path: '/admin/withdrawals', section: 'withdrawals' },
  { icon: ShieldAlert, label: 'Risk & Fraud', path: '/admin/risk', section: 'risk' },
  { icon: Wallet, label: 'Finance', path: '/admin/finance', section: 'finance' },
  { icon: Settings, label: 'Settings', path: '/admin/settings', section: 'settings' },
];

const ROLE_LABEL: Record<string, string> = {
  platform_superadmin: 'Platform Owner',
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance_admin: 'Finance Admin',
  support: 'Support',
};

interface AdminSidebarProps {
  /** Drawer visibility on screens below `lg`. Ignored at `lg+` (always docked). */
  open: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const { pathname } = useLocation();
  const { role } = useAdmin();
  const isActive = (p: string) => p === '/admin' ? pathname === '/admin' || pathname === '/admin/dashboard' : pathname.startsWith(p);

  const items = NAV.filter(n => canAccess(role, n.section));
  const showWithdrawalsBadge = canAccess(role, 'withdrawals');

  // Live count of pending withdrawals, shown as a badge so operators are notified
  // of new payout requests. Only subscribed when the Withdrawals item is visible
  // to the current role (avoids a needless query/subscription for marketers).
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!showWithdrawalsBadge) return;
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
  }, [showWithdrawalsBadge]);

  return (
    <>
      {/* Scrim behind the off-canvas drawer (below `lg` only). */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-line flex flex-col transform transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-56 lg:translate-x-0 lg:flex-shrink-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="h-14 flex items-center px-5 border-b border-line">
        <Link to="/admin" className="flex items-center gap-2.5">
          <img src="/plane.png" alt="" aria-hidden="true" className="h-5 w-auto -rotate-12 drop-shadow-[0_0_6px_rgba(200,0,24,0.5)]" />
          <span className="text-white font-semibold text-sm tracking-tight">Aviator Admin</span>
        </Link>
      </div>
      <div className="px-5 py-3 border-b border-line">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-white/80 text-[11px] font-medium tracking-tight">{ROLE_LABEL[role] ?? role}</span>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1">
        {items.map(({ icon: Icon, label, path }) => {
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
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-gold text-canvas text-[11px] font-bold tabular-nums"
                >
                  {pending > 99 ? '99+' : pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-line">
        <a href="/" className="text-white/55 hover:text-white text-xs transition-colors">&larr; Back to Game</a>
      </div>
      </aside>
    </>
  );
}
