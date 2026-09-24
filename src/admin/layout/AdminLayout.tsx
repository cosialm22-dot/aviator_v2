import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import CommandPalette from '../components/CommandPalette';
import { useScope } from '../scopeContext';
import { NAV, activePath } from './nav';

const COLLAPSE_KEY = 'admin:sidebar-collapsed';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const { pathname } = useLocation();
  const scope = useScope();
  const items = NAV.flatMap((g) => g.items);
  const page = items.find((i) => i.path === activePath(pathname, items));
  const unscoped = scope.canSwitch && scope.siteId && page && !page.scoped;

  useEffect(() => { setNavOpen(false); }, [pathname]);

  const toggle = useCallback(() => {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  }, []);
  // Ctrl/⌘+B collapses the sidebar.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggle(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [toggle]);

  return (
    <div className="h-[100dvh] flex bg-canvas overflow-hidden text-ink">
      <CommandPalette />
      <AdminSidebar open={navOpen} onClose={() => setNavOpen(false)} collapsed={collapsed} onToggleCollapsed={toggle} />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader onMenuClick={() => setNavOpen(true)} />
        {/* Platform owner looking at one brand: a clear banner so nobody acts on the wrong brand. */}
        {scope.canSwitch && scope.siteId && (
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-1.5 bg-gold/10 border-b border-gold/30 text-[12px] text-ink" data-testid="scope-banner">
            <span><span className="inline-block h-2 w-2 rounded-full bg-gold animate-pulse mr-2 align-middle" />Viewing <b>{scope.label}</b> only</span>
            <button onClick={() => scope.setSiteId(null)} className="text-gold hover:underline">Show all brands</button>
          </div>
        )}
        {unscoped && (
          <div className="px-4 sm:px-6 py-1.5 bg-raised border-b border-line text-[12px] text-muted" data-testid="scope-unscoped">
            {page?.label} is not filtered by brand yet — it shows every brand you run.
          </div>
        )}
        {/* key: pages remount when the brand scope changes, so nothing stale is shown. */}
        <main key={scope.siteId ?? 'all'} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-8 md:py-7 flex flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
