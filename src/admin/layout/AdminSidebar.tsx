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
        className={`fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[300px] bg-surface border-r border-line flex flex-col transform transition-[transform,width] duration-200 ease-out
          lg:static lg:z-auto lg:translate-x-0 lg:flex-shrink-0 ${rail ? 'lg:w-[68px]' : 'lg:w-60'} ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Workspace header: names the scope at all times. */}
        <div className="h-16 flex items-center gap-2.5 px-4 border-b border-line">
          <Link to="/admin" className="flex items-center gap-2.5 min-w-0" title={workspace}>
            <BirdMark skin={planeSkin} width={30} className="-rotate-12 shrink-0" />
            <span className={`min-w-0 ${rail ? 'lg:hidden' : ''}`}>
              <span className="block text-ink font-semibold text-sm tracking-tight truncate">Aviator admin</span>
              <span className={`block text-[11px] truncate ${isPlatform && !scope.siteId ? 'text-gold' : 'text-muted'}`} data-testid="workspace-scope">{workspace}</span>
            </span>
          </Link>
        </div>

        <div className={`px-3 pt-3 ${rail ? 'lg:px-2' : ''}`}>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="w-full h-9 flex items-center gap-2 px-3 rounded-lg border border-line bg-canvas text-faint text-[13px] hover:text-ink"
            aria-label="Search pages">
            <Search size={14} />
            <span className={rail ? 'lg:hidden' : ''}>Jump to…</span>
            <kbd className={`ml-auto text-[10px] border border-line rounded px-1 ${rail ? 'lg:hidden' : ''}`}>⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3">
          {groups.map((g, gi) => (
            <div key={g.id} className={gi > 0 ? 'mt-2.5 border-t border-line/70 pt-2.5' : ''}>
              {g.label && <div className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint ${rail ? 'lg:hidden' : ''}`}>{g.label}</div>}
              {g.items.map(({ icon: Icon, label, path, badge }) => {
                const on = active === path;
                const count = badge === 'withdrawals' && showBadge ? pending : 0;
                return (
                  <Link key={path} to={path} aria-current={on ? 'page' : undefined} title={rail ? label : undefined}
                    className={'relative flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] transition-colors ' +
                      (on ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink hover:bg-raised/60')}>
                    {on && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-gold" />}
                    <Icon size={16} strokeWidth={1.75} className={on ? 'text-gold shrink-0' : 'shrink-0'} />
                    <span className={`truncate ${rail ? 'lg:hidden' : ''}`}>{label}</span>
                    {count > 0 && (
                      <span aria-label={`${count} pending withdrawals`}
                        className={`ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-gold text-canvas text-[11px] font-bold tabular-nums ${rail ? 'lg:absolute lg:top-0.5 lg:right-0.5 lg:ml-0' : ''}`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3 space-y-1">
          <button onClick={onToggleCollapsed} className="hidden lg:flex w-full items-center gap-3 h-8 px-3 rounded-lg text-[12px] text-faint hover:text-ink hover:bg-raised/60"
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
            {rail ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
          </button>
          <a href="/" className="flex items-center gap-3 h-8 px-3 rounded-lg text-[12px] text-faint hover:text-ink hover:bg-raised/60" title="Back to the game">
            <ArrowLeft size={15} /><span className={rail ? 'lg:hidden' : ''}>Back to the game</span>
          </a>
        </div>
      </aside>
    </>
  );
}
