import { createContext, useContext } from 'react';

// ============================================================================
// Admin RBAC - single source of truth for the four-role model and access map.
// Mirrors the DB contract in migration 20260613060000_rbac_four_roles.sql:
//   player       - customer; never enters the admin panel.
//   marketer     - growth staff; analytics (Dashboard) visibility only for now.
//   admin        - operations; players, game, withdrawals, finance.
//   super_admin  - everything admin can do, plus settings and staff/role mgmt.
// The server RPCs enforce every privileged write; this map only governs UI
// visibility and client-side route guarding (defence in depth, not the gate).
// ============================================================================

export type Role = 'player' | 'admin' | 'super_admin' | 'marketer';

export type Section =
  | 'dashboard' | 'users' | 'game' | 'withdrawals' | 'finance' | 'settings' | 'staff'
  | 'marketing' | 'commissions';

const ACCESS: Record<Section, Role[]> = {
  // Operations analytics is for operators only; marketers see their own
  // affiliate data under 'marketing', never system-wide revenue.
  dashboard:   ['super_admin', 'admin'],
  users:       ['super_admin', 'admin'],
  game:        ['super_admin', 'admin'],
  withdrawals: ['super_admin', 'admin'],
  finance:     ['super_admin', 'admin'],
  settings:    ['super_admin'],
  staff:       ['super_admin'],
  marketing:   ['marketer'],                 // the marketer's own affiliate dashboard
  commissions: ['super_admin', 'admin'],     // commission payout review (rate edits: super_admin)
};

export function canAccess(role: Role | null | undefined, section: Section): boolean {
  return role != null && ACCESS[section].includes(role);
}

export interface AdminIdentity {
  userId: string;
  role: Role;
  isSuperAdmin: boolean; // role === 'super_admin'
  isAdmin: boolean;      // 'admin' or 'super_admin' (operational staff)
  isStaff: boolean;      // any non-player (admin, super_admin, marketer)
}

export const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity {
  const v = useContext(AdminContext);
  if (!v) throw new Error('useAdmin must be used within AdminGuard');
  return v;
}

export function makeIdentity(userId: string, role: Role): AdminIdentity {
  return {
    userId,
    role,
    isSuperAdmin: role === 'super_admin',
    isAdmin: role === 'super_admin' || role === 'admin',
    isStaff: role === 'super_admin' || role === 'admin' || role === 'marketer',
  };
}
