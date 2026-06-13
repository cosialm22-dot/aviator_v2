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
import SettingsPage from './pages/SettingsPage';
import { useAdmin, canAccess, type Section } from './roleContext';

// Route-level authorisation (defence in depth alongside the hidden nav items):
// a user who types a forbidden path is redirected to the Dashboard, which every
// staff role can see. The server RPCs remain the real gate.
function RequireSection({ section, children }: { section: Section; children: ReactNode }) {
  const { role } = useAdmin();
  return canAccess(role, section) ? <>{children}</> : <Navigate to="/admin" replace />;
}

export default function AdminApp() {
  return (
    <AdminGuard>
      <AdminLayout>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="users" element={<RequireSection section="users"><UsersPage /></RequireSection>} />
          <Route path="users/:userId" element={<RequireSection section="users"><UserDetailPage /></RequireSection>} />
          <Route path="game" element={<RequireSection section="game"><GameControlPage /></RequireSection>} />
          <Route path="withdrawals" element={<RequireSection section="withdrawals"><WithdrawalsPage /></RequireSection>} />
          <Route path="finance" element={<RequireSection section="finance"><FinancePage /></RequireSection>} />
          <Route path="settings" element={<RequireSection section="settings"><SettingsPage /></RequireSection>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
    </AdminGuard>
  );
}
