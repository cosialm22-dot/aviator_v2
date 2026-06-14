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
import RiskPage from './pages/RiskPage';
import SettingsPage from './pages/SettingsPage';
import MarketingPage from './pages/MarketingPage';
import MarketingAdminPage from './pages/MarketingAdminPage';
import { useAdmin, canAccess, type Section } from './roleContext';

// Route-level authorisation (defence in depth alongside the hidden nav items):
// a user who types a forbidden path is redirected to their landing page. The
// server RPCs remain the real gate.
function RequireSection({ section, children }: { section: Section; children: ReactNode }) {
  const { role } = useAdmin();
  return canAccess(role, section) ? <>{children}</> : <Navigate to="/admin" replace />;
}

// Role-aware landing: operators see the analytics Dashboard; marketers (who have
// no analytics access) land on their own affiliate dashboard instead.
function Landing() {
  const { role } = useAdmin();
  if (role === 'marketer') return <Navigate to="/admin/marketing" replace />;
  return <DashboardPage />;
}

// The /admin/marketing route is shared: marketers see their own affiliate
// dashboard; operators see the Marketing management hub. One nav item, one
// route, role-appropriate content (mirrors the Landing dispatch above).
function MarketingRouter() {
  const { role } = useAdmin();
  return role === 'marketer' ? <MarketingPage /> : <MarketingAdminPage />;
}

export default function AdminApp() {
  return (
    <AdminGuard>
      <AdminLayout>
        <Routes>
          <Route index element={<Landing />} />
          <Route path="dashboard" element={<RequireSection section="dashboard"><DashboardPage /></RequireSection>} />
          <Route path="marketing" element={<RequireSection section="marketing"><MarketingRouter /></RequireSection>} />
          {/* Commissions folded into the Marketing hub; keep the old path as a deep link. */}
          <Route path="commissions" element={<Navigate to="/admin/marketing?tab=commissions" replace />} />
          <Route path="users" element={<RequireSection section="users"><UsersPage /></RequireSection>} />
          <Route path="users/:userId" element={<RequireSection section="users"><UserDetailPage /></RequireSection>} />
          <Route path="game" element={<RequireSection section="game"><GameControlPage /></RequireSection>} />
          <Route path="withdrawals" element={<RequireSection section="withdrawals"><WithdrawalsPage /></RequireSection>} />
          <Route path="risk" element={<RequireSection section="risk"><RiskPage /></RequireSection>} />
          <Route path="finance" element={<RequireSection section="finance"><FinancePage /></RequireSection>} />
          <Route path="settings" element={<RequireSection section="settings"><SettingsPage /></RequireSection>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
    </AdminGuard>
  );
}
