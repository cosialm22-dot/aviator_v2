import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Off-canvas navigation drawer state for screens below `lg`. On `lg+` the
  // sidebar is permanently docked and this flag is ignored.
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Auto-close the mobile drawer on every route change so a tap that navigates
  // never leaves the overlay covering the freshly-loaded page.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  return (
    <div className="h-[100dvh] flex bg-canvas overflow-hidden">
      <AdminSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
