import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Gamepad2, Wallet, Settings, BarChart3, MessageSquare, Shield } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/users', icon: Users, label: 'Players' },
  { to: '/admin/game', icon: Gamepad2, label: 'Game Control' },
  { to: '/admin/finance', icon: Wallet, label: 'Finance' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
] as const;

export default function AdminSidebar() {
  return (
    <aside className="w-56 bg-[#0d0d1a] border-r border-[#1e1e3a] flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-[#1e1e3a]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#c8001c] flex items-center justify-center">
            <span className="text-white text-xs font-black">A</span>
          </div>
          <span className="text-white font-bold text-sm tracking-tight">AVIATOR ADMIN</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-[#c8001c]/10 text-[#ff3040] border border-[#c8001c]/20'
                  : 'text-slate-400 hover:text-white hover:bg-[#1a1a2e]'
              }`
            }
          >
            <Icon size={16} className="flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#1e1e3a]">
        <NavLink to="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-xs transition-colors">
          <span>&larr;</span>
          <span>Back to Game</span>
        </NavLink>
      </div>
    </aside>
  );
}
