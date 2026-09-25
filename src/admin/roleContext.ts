import { createContext, useContext } from 'react';

// ============================================================================
// Admin RBAC — sections of the back office, each gated by one capability from capabilities.ts
// (the tier table ported from invest254). The server RPCs enforce every privileged write and the
// brand isolation (_can_admin_site / _admin_scope); this only governs what the UI shows.
// ============================================================================
import { can, OPERATOR_ROLES as OPS, type Capability, type Role as R } from './capabilities';

export type Role = R;

export type Section =
  | 'platform' | 'brands'
  | 'dashboard' | 'users' | 'game' | 'withdrawals' | 'deposits' | 'finance' | 'settings' | 'staff' | 'audit'
  | 'marketing' | 'commissions' | 'risk' | 'notifications';

export const OPERATOR_ROLES: Role[] = OPS;

const SECTION_CAP: Record<Section, Capability> = {
  platform: 'console.enter',
  brands: 'console.brand.copy',
  dashboard: 'backoffice.dashboard',
  users: 'backoffice.players',
  game: 'engine.control',
  withdrawals: 'backoffice.withdrawals',
  deposits: 'backoffice.deposits',
  finance: 'backoffice.finance',
  risk: 'backoffice.risk',
  settings: 'backoffice.settings',
  staff: 'backoffice.staff',
  audit: 'backoffice.audit',
  marketing: 'backoffice.marketing',
  commissions: 'backoffice.marketing',
  notifications: 'backoffice.notifications',
};

export function canAccess(role: Role | null | undefined, section: Section): boolean {
  return can(role, SECTION_CAP[section]);
}

export interface AdminIdentity {
  userId: string;
  role: Role;
  isPlatform: boolean;   // role === 'platform_superadmin' (the System owner)
  isPlatformTier: boolean; // owner or platform admin: picks a brand, uses the brand console
  platformId: string | null;
  isSuperAdmin: boolean; // brand owner or above (settings/staff tier)
  isAdmin: boolean;      // any operator role (broad ops visibility)
  isStaff: boolean;      // operator (can enter the admin panel); marketers are not operators
  username: string;
  siteId: string | null; // the staff member's own brand
}

export const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity {
  const v = useContext(AdminContext);
  if (!v) throw new Error('useAdmin must be used within AdminGuard');
  return v;
}

export function makeIdentity(userId: string, role: Role, extra: { username?: string; siteId?: string | null; platformId?: string | null } = {}): AdminIdentity {
  const isPlatform = role === 'platform_superadmin';
  const isPlatformTier = isPlatform || role === 'platform_admin';
  return {
    userId,
    role,
    isPlatform,
    isPlatformTier,
    platformId: extra.platformId ?? null,
    isSuperAdmin: role === 'super_admin' || isPlatformTier,
    isAdmin: OPERATOR_ROLES.includes(role),
    isStaff: OPERATOR_ROLES.includes(role),
    username: extra.username ?? 'Admin',
    siteId: extra.siteId ?? null,
  };
}
