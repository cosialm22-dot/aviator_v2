import { useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Users, Gamepad2, Wallet, Settings } from 'lucide-react';

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: Users, label: 'Players', path: '/admin/users' },
  { icon: Gamepad2, label: 'Game Control', path: '/admin/game' },
  { icon: Wallet, label: 'Finance', path: '/admin/finance' },
  { icon: Settings, label: 'Settings', path: '/admin/settings' },
];

export default function AdminSidebar() {
  const { pathname } = useLocation();
  const isActive = (p: string) => p === '/admin' ? pathname === '/admin' || pathname === '/admin/dashboard' : pathname.startsWith(p);

  return (
    <aside className="w-56 bg-[#0d0d1a] border-r border-[#1e1e35] flex flex-col flex-shrink-0 hidden lg:flex">
      <div className="h-14 flex items-center px-5 border-b border-[#1e1e35]">
        <Link to="/admin" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#c8001c] rounded-lg flex items-center justify-center"><span className="text-white text-xs font-black">A</span></div>
          <span className="text-white font-bold text-sm">Aviator Admin</span>
        </Link>
      </div>
      <nav className="flex-1 py-3 px-3 space-y-1">
        {NAV.map(({ icon: Icon, label, path }) => (
          <Link key={path} to={path} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition ${isActive(path) ? 'bg-[#c8001c]/10 text-[#ff3344]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a2e]'}`}>
            <Icon size={16} />{label}
          </Link>
        ))}
      </nav>
      <div className="px-5 py-3 border-t border-[#1e1e35]"><a href="/" className="text-slate-500 hover:text-white text-xs">&larr; Back to Game</a></div>
    </aside>
  );
}
