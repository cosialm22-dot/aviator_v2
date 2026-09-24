import { createContext, useContext } from 'react';

// ============================================================================
// Admin RBAC - single source of truth for the role ladder and access map.
// Mirrors the DB role ladder (see 20260828050000_p2_roles_guards.sql):
//   player               - customer; never enters the admin panel.
//   marketer             - growth affiliate; uses the /marketer hub in the
//                          PLAYER shell, never the operator admin panel.
//   support              - read-oriented ops (players, risk, dashboard).
//   finance_admin        - finance + withdrawals ops.
//   admin                - operations: players, game, withdrawals, finance, risk.
//   super_admin          - everything admin can do, plus settings & staff mgmt.
//   platform_superadmin  - the platform owner (root): super_admin across every
//                          brand, PLUS the cross-brand Platform Console.
// The server RPCs enforce every privileged write (and cross-brand isolation via
// _can_admin_site); this map only governs UI visibility and client-side route
// guarding (defence in depth, not the gate).
// ============================================================================

export type Role =
  | 'player'
  | 'marketer'
  | 'support'
  | 'finance_admin'
  | 'admin'
  | 'super_admin'
  | 'platform_superadmin';

export type Section =
  | 'platform'
  | 'dashboard' | 'users' | 'game' | 'withdrawals' | 'deposits' | 'finance' | 'settings' | 'staff'
  | 'marketing' | 'commissions' | 'risk' | 'notifications';

// Operator roles that may enter the admin panel at all (AdminGuard gate).
export const OPERATOR_ROLES: Role[] = [
  'platform_superadmin', 'super_admin', 'admin', 'finance_admin', 'support',
];

const ACCESS: Record<Section, Role[]> = {
  // Cross-brand console: platform owner only.
  platform:    ['platform_superadmin'],
  dashboard:   ['platform_superadmin', 'super_admin', 'admin', 'finance_admin', 'support'],
  users:       ['platform_superadmin', 'super_admin', 'admin', 'support'],
  game:        ['platform_superadmin', 'super_admin', 'admin'],
  withdrawals: ['platform_superadmin', 'super_admin', 'admin', 'finance_admin'],
  // Deposits: support can look (to help players); only finance+ can confirm by hand (server-enforced).
  deposits:    ['platform_superadmin', 'super_admin', 'admin', 'finance_admin', 'support'],
  finance:     ['platform_superadmin', 'super_admin', 'admin', 'finance_admin'],
  // Risk & fraud monitoring is an operations function (see module 7 spec).
  risk:        ['platform_superadmin', 'super_admin', 'admin', 'support'],
  settings:    ['platform_superadmin', 'super_admin'],
  staff:       ['platform_superadmin', 'super_admin'],
  // Operator-only Marketing hub (affiliates + promotions + commissions). Marketers
  // manage their own affiliate data in the /marketer hub (player shell), not here.
  marketing:   ['platform_superadmin', 'super_admin', 'admin'],
  commissions: ['platform_superadmin', 'super_admin', 'admin'], // legacy; route redirects into the hub
  notifications: ['platform_superadmin', 'super_admin', 'admin'],
};

export function canAccess(role: Role | null | undefined, section: Section): boolean {
  return role != null && ACCESS[section].includes(role);
}

export interface AdminIdentity {
  userId: string;
  role: Role;
  isPlatform: boolean;   // role === 'platform_superadmin' (owns the cross-brand console)
  isSuperAdmin: boolean; // 'super_admin' or 'platform_superadmin' (settings/staff tier)
  isAdmin: boolean;      // any operator role (broad ops visibility)
  isStaff: boolean;      // operator (can enter the admin panel); marketers are not operators
}

export const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity {
  const v = useContext(AdminContext);
  if (!v) throw new Error('useAdmin must be used within AdminGuard');
  return v;
}

export function makeIdentity(userId: string, role: Role): AdminIdentity {
  const isPlatform = role === 'platform_superadmin';
  return {
    userId,
    role,
    isPlatform,
    isSuperAdmin: role === 'super_admin' || isPlatform,
    isAdmin: OPERATOR_ROLES.includes(role),
    isStaff: OPERATOR_ROLES.includes(role),
  };
}
