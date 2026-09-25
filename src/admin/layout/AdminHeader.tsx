import { useLocation } from 'react-router-dom';
import { Building2, LogOut, Menu } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { useScope } from '../scopeContext';
import { NAV, activePath } from './nav';
import { ROLE_LABEL } from '../ui/format';

interface AdminHeaderProps { onMenuClick: () => void }

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  const { username, role } = useAdmin();
  const scope = useScope();
  const { pathname } = useLocation();
  const items = NAV.flatMap((g) => g.items);
  const current = items.find((i) => i.path === activePath(pathname, items))?.label ?? 'Admin';

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line/60 bg-canvas/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenuClick} aria-label="Open navigation menu"
          className="-ml-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-brand hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 lg:hidden">
          <Menu size={18} />
        </button>
        <span className="truncate text-[15px] font-semibold text-ink lg:hidden">{current}</span>

        {/* Scope: platform owner picks a brand; everyone else sees their brand. */}
        {scope.canSwitch ? (
          <label className="hidden sm:flex items-center gap-2 text-[12px] text-muted">
            <Building2 size={14} className="text-faint" />
            <span className="sr-only">Brand</span>
            <select value={scope.siteId ?? ''} onChange={(e) => scope.setSiteId(e.target.value || null)} aria-label="Brand scope" data-testid="scope-switcher"
              className="h-7 max-w-[220px] rounded-lg bg-raised pl-2.5 pr-7 text-[13px] text-ink focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50">
              <option value="">All brands</option>
              {scope.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status !== 'active' ? ` (${b.status})` : ''}</option>)}
            </select>
          </label>
        ) : (
          <span className="hidden h-7 items-center gap-1.5 rounded-full bg-raised px-3 text-[12px] font-medium text-muted sm:inline-flex" data-testid="scope-label">
            <Building2 size={13} className="text-faint" />{scope.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-[#8e8e93] to-[#636366] text-[12px] font-semibold text-white" aria-hidden>{username[0]?.toUpperCase()}</div>
        <span className="hidden md:flex flex-col leading-tight">
          <span className="text-ink text-[13px] font-medium">{username}</span>
          <span className="text-faint text-[11px]">{ROLE_LABEL[role] ?? role}</span>
        </span>
        <button onClick={() => { void supabase.auth.signOut(); window.location.href = '/'; }} aria-label="Sign out" title="Sign out"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-down/10 hover:text-down focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50">
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
