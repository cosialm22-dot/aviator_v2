import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, Users, Gamepad2, Wallet, Settings, X,
  TrendingUp, Shield, MessageSquare, Megaphone, Share2
} from 'lucide-react';

interface Props {
  onClose: () => void;
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: Users, label: 'Players', path: '/admin/users' },
  { icon: Gamepad2, label: 'Game Control', path: '/admin/game' },
  { icon: Wallet, label: 'Finance', path: '/admin/finance' },
  { icon: Share2, label: 'Affiliates', path: '/admin/affiliates', disabled: true },
  { icon: Megaphone, label: 'Marketing', path: '/admin/marketing', disabled: true },
  { icon: Shield, label: 'Risk', path: '/admin/risk', disabled: true },
  { icon: MessageSquare, label: 'Chat', path: '/admin/chat', disabled: true },
  { icon: TrendingUp, label: 'Analytics', path: '/admin/analytics', disabled: true },
  { icon: Settings, label: 'Settings', path: '/admin/settings' },
] as const;

export default function AdminSidebar({ onClose }: Props) {
  const location = useLocation();

  function isActive(path: string): boolean {
    if (path === '/admin') return location.pathname === '/admin' || location.pathname === '/admin/dashboard';
    return location.pathname.startsWith(path);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 h-16 border-b border-[#1e1e35] flex-shrink-0">
        <Link to="/admin" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#c8001c] rounded-lg flex items-center justify-center">
            <span className="text-white font-black text-sm">A</span>
          </div>
          <span className="text-white font-bold text-sm">Aviator Admin</span>
        </Link>
        <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map(item => {
            const active = isActive(item.path);
            const Icon = item.icon;
            const disabled = 'disabled' in item && item.disabled;

            if (disabled) {
              return (
                <li key={item.path}>
                  <span className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-600 cursor-not-allowed">
                    <Icon size={18} />
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="ml-auto text-[9px] uppercase tracking-wider bg-[#1a1a2e] px-1.5 py-0.5 rounded text-slate-500">Soon</span>
                  </span>
                </li>
              );
            }

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    active
                      ? 'bg-[#c8001c]/10 text-[#ff3344] border border-[#c8001c]/20'
                      : 'text-slate-400 hover:text-white hover:bg-[#1a1a2e]'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#1e1e35] flex-shrink-0">
        <a href="/" className="flex items-center gap-2 text-slate-500 hover:text-white text-xs transition">
          <Gamepad2 size={14} />
          <span>Back to Game</span>
        </a>
      </div>
    </div>
  );
}
