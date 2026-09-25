import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import AdminGuard from './AdminGuard';
import AdminLayout from './layout/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import UserDetailPage from './pages/UserDetailPage';
import GameControlPage from './pages/GameControlPage';
import WithdrawalsPage from './pages/WithdrawalsPage';
import FinancePage from './pages/FinancePage';
import DepositsPage from './pages/DepositsPage';
import AuditPage from './pages/AuditPage';
import RiskPage from './pages/RiskPage';
import SettingsPage from './pages/SettingsPage';
import MarketingAdminPage from './pages/MarketingAdminPage';
import PlatformConsolePage from './pages/PlatformConsolePage';
import NotificationsPage from './pages/NotificationsPage';
import PromoCodesPage from './pages/PromoCodesPage';
import BrandsPage from './pages/BrandsPage';
import BrandDetailPage from './pages/BrandDetailPage';
import PlatformsPage from './pages/PlatformsPage';
import IntegrationsPage from './pages/IntegrationsPage';
import { useAdmin, canAccess, type Section } from './roleContext';

// Route-level authorisation (defence in depth alongside the hidden nav items):
// a user who types a forbidden path is redirected to their landing page. The
// server RPCs remain the real gate.
function RequireSection({ section, children }: { section: Section; children: ReactNode }) {
  const { role } = useAdmin();
  return canAccess(role, section) ? <>{children}</> : <Navigate to="/admin" replace />;
}

export default function AdminApp() {
  return (
    // The back office keeps its own Apple-dark look and system type whatever brand the site wears.
    <div className="admin-scope contents">
    <AdminGuard>
      <AdminLayout>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="platform" element={<RequireSection section="platform"><PlatformConsolePage /></RequireSection>} />
          <Route path="brands" element={<RequireSection section="brands"><BrandsPage /></RequireSection>} />
          <Route path="brands/:siteId" element={<RequireSection section="brands"><BrandDetailPage /></RequireSection>} />
          <Route path="platforms" element={<RequireSection section="platforms"><PlatformsPage /></RequireSection>} />
          <Route path="integrations" element={<RequireSection section="integrations"><IntegrationsPage /></RequireSection>} />
          <Route path="dashboard" element={<RequireSection section="dashboard"><DashboardPage /></RequireSection>} />
          <Route path="marketing" element={<RequireSection section="marketing"><MarketingAdminPage /></RequireSection>} />
          <Route path="notifications" element={<RequireSection section="notifications"><NotificationsPage /></RequireSection>} />
          <Route path="promo-codes" element={<RequireSection section="marketing"><PromoCodesPage /></RequireSection>} />
          {/* Commissions folded into the Marketing hub; keep the old path as a deep link. */}
          <Route path="commissions" element={<Navigate to="/admin/marketing?tab=commissions" replace />} />
          <Route path="users" element={<RequireSection section="users"><UsersPage /></RequireSection>} />
          <Route path="users/:userId" element={<RequireSection section="users"><UserDetailPage /></RequireSection>} />
          <Route path="game" element={<RequireSection section="game"><GameControlPage /></RequireSection>} />
          <Route path="withdrawals" element={<RequireSection section="withdrawals"><WithdrawalsPage /></RequireSection>} />
          <Route path="deposits" element={<RequireSection section="deposits"><DepositsPage /></RequireSection>} />
          <Route path="audit" element={<RequireSection section="audit"><AuditPage /></RequireSection>} />
          <Route path="risk" element={<RequireSection section="risk"><RiskPage /></RequireSection>} />
          <Route path="finance" element={<RequireSection section="finance"><FinancePage /></RequireSection>} />
          <Route path="settings" element={<RequireSection section="settings"><SettingsPage /></RequireSection>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
    </AdminGuard>
    </div>
  );
}
