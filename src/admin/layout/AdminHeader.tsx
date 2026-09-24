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
    <header className="h-14 flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-line bg-surface flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenuClick} aria-label="Open navigation menu"
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 -ml-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          <Menu size={18} />
        </button>
        <span className="lg:hidden font-semibold text-ink text-sm tracking-tight truncate">{current}</span>

        {/* Scope: platform owner picks a brand; everyone else sees their brand. */}
        {scope.canSwitch ? (
          <label className="hidden sm:flex items-center gap-2 text-[12px] text-muted">
            <Building2 size={14} className="text-faint" />
            <span className="sr-only">Brand</span>
            <select value={scope.siteId ?? ''} onChange={(e) => scope.setSiteId(e.target.value || null)} aria-label="Brand scope" data-testid="scope-switcher"
              className="h-8 max-w-[220px] px-2 rounded-lg border border-line bg-canvas text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              <option value="">All brands</option>
              {scope.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status !== 'active' ? ` (${b.status})` : ''}</option>)}
            </select>
          </label>
        ) : (
          <span className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-line text-[12px] text-muted" data-testid="scope-label">
            <Building2 size={13} className="text-faint" />{scope.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white text-xs font-semibold" aria-hidden>{username[0]?.toUpperCase()}</div>
        <span className="hidden md:flex flex-col leading-tight">
          <span className="text-ink text-[13px] font-medium">{username}</span>
          <span className="text-faint text-[11px]">{ROLE_LABEL[role] ?? role}</span>
        </span>
        <button onClick={() => { void supabase.auth.signOut(); window.location.href = '/'; }} aria-label="Sign out" title="Sign out"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-down hover:bg-down/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
