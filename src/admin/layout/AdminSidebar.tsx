import { useLocation, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowLeft, ChevronsLeft, ChevronsRight, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdmin, canAccess } from '../roleContext';
import { useScope } from '../scopeContext';
import { useSiteTheme } from '../../hooks/useSiteTheme';
import BirdMark from '../../components/game/BirdMark';
import { activePath, navFor } from './nav';
import { ROLE_LABEL } from '../ui/format';

interface AdminSidebarProps {
  /** Drawer visibility below `lg`. Ignored at `lg+` (always docked). */
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function AdminSidebar({ open, onClose, collapsed, onToggleCollapsed }: AdminSidebarProps) {
  const { planeSkin } = useSiteTheme();
  const { pathname } = useLocation();
  const { role, isPlatform } = useAdmin();
  const scope = useScope();
  const groups = navFor(role);
  const active = activePath(pathname, groups.flatMap((g) => g.items));
  const showBadge = canAccess(role, 'withdrawals');
  const rail = collapsed; // icon rail on lg+

  // Live count of pending withdrawals (RLS keeps it to the staff member's brand).
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!showBadge) return;
    let live = true;
    const load = async () => {
      let q = supabase.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (scope.siteId) q = q.eq('site_id', scope.siteId);
      const { count } = await q;
      if (live) setPending(count ?? 0);
    };
    void load();
    const channel = supabase.channel('admin-withdrawals-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_requests' }, () => { void load(); })
      .subscribe();
    const t = setInterval(() => { void load(); }, 60000);
    return () => { live = false; clearInterval(t); supabase.removeChannel(channel); };
  }, [showBadge, scope.siteId]);

  const workspace = isPlatform ? (scope.siteId ? `${scope.label} · viewed as owner` : 'Platform console · all brands') : `${scope.label} · ${ROLE_LABEL[role] ?? role}`;

  return (
    <>
      <div onClick={onClose} aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
      <aside
        aria-label="Admin navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[300px] flex-col border-r border-line/60 bg-[#161618] transform transition-[transform,width] duration-200 ease-out
          lg:static lg:z-auto lg:translate-x-0 lg:flex-shrink-0 ${rail ? 'lg:w-[68px]' : 'lg:w-60'} ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Workspace header: names the scope at all times. */}
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link to="/admin" className="flex min-w-0 items-center gap-2.5" title={workspace}>
            <BirdMark skin={planeSkin} width={28} className="-rotate-12 shrink-0" />
            <span className={`min-w-0 ${rail ? 'lg:hidden' : ''}`}>
              <span className="block truncate text-[13px] font-semibold text-ink">Aviator admin</span>
              <span className={`block truncate text-[11px] ${isPlatform && !scope.siteId ? 'text-gold' : 'text-faint'}`} data-testid="workspace-scope">{workspace}</span>
            </span>
          </Link>
        </div>

        <div className={`px-3 pb-1 ${rail ? 'lg:px-2' : ''}`}>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="flex h-8 w-full items-center gap-2 rounded-lg bg-white/[0.07] px-2.5 text-[13px] text-faint transition-colors hover:text-ink"
            aria-label="Search pages">
            <Search size={14} />
            <span className={rail ? 'lg:hidden' : ''}>Search</span>
            <kbd className={`ml-auto font-sans text-[11px] text-faint ${rail ? 'lg:hidden' : ''}`}>⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3">
          {groups.map((g, gi) => (
            <div key={g.id} className={gi > 0 ? 'mt-4' : ''}>
              {g.label && <div className={`px-2.5 pb-1 text-[11px] font-semibold text-faint ${rail ? 'lg:hidden' : ''}`}>{g.label}</div>}
              {g.items.map(({ icon: Icon, label, path, badge }) => {
                const on = active === path;
                const count = badge === 'withdrawals' && showBadge ? pending : 0;
                return (
                  <Link key={path} to={path} aria-current={on ? 'page' : undefined} title={rail ? label : undefined}
                    className={'relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ' +
                      (on ? 'bg-brand text-white' : 'text-ink hover:bg-white/[0.06]')}>
                    <Icon size={16} strokeWidth={1.9} className={on ? 'shrink-0 text-white' : 'shrink-0 text-brand'} />
                    <span className={`truncate ${rail ? 'lg:hidden' : ''}`}>{label}</span>
                    {count > 0 && (
                      <span aria-label={`${count} pending withdrawals`}
                        className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${on ? 'bg-white/25 text-white' : 'bg-down text-white'} ${rail ? 'lg:absolute lg:right-0.5 lg:top-0.5 lg:ml-0' : ''}`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-line/60 p-3">
          <button onClick={onToggleCollapsed} className="hidden h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-white/[0.06] hover:text-ink lg:flex"
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
            {rail ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
          </button>
          <a href="/" className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-white/[0.06] hover:text-ink" title="Back to the game">
            <ArrowLeft size={15} /><span className={rail ? 'lg:hidden' : ''}>Back to the game</span>
          </a>
        </div>
      </aside>
    </>
  );
}
