// ============================================================================
// capabilities.ts — the ONE list of what each tier may see and do in the operator UI.
// Ported from invest254 (packages/shared/src/capabilities.ts, docs/41 + docs/42 §3): every screen
// decides visibility with can(role, capability); the server RPCs enforce the same rules (see
// supabase/migrations/20260930090000_brand_tiers_scope.sql) and src/admin/capabilities.test.ts
// pins this table to them, so the UI never shows a control the server refuses or hides one it allows.
//
// Tiers (highest first):
//   platform_superadmin  the System owner — every brand, the shared engine, global config
//   platform_admin       runs a platform (a group of brands) — brand console, domains, payment
//                        accounts and staff of ITS brands; never the shared engine
//   super_admin          a brand's owner — its staff, players, money, brand copy/legal/SEO
//   admin / finance_admin / support   a brand's staff
//   marketer / player    never enter the back office
// ============================================================================

export type Role =
  | 'player' | 'marketer'
  | 'support' | 'finance_admin' | 'admin' | 'super_admin'
  | 'platform_admin' | 'platform_superadmin';

const OWNER = ['platform_superadmin'] as const;
const PLATFORM = ['platform_superadmin', 'platform_admin'] as const;
const BRAND_OWNER = [...PLATFORM, 'super_admin'] as const;
const BRAND_ADMIN = [...BRAND_OWNER, 'admin'] as const;
const FINANCE = [...BRAND_ADMIN, 'finance_admin'] as const;
const STAFF = [...FINANCE, 'support'] as const;

export const CAPABILITIES = {
  // ── back office (one brand at a time) ─────────────────────────────────────────
  'backoffice.enter': STAFF,
  'backoffice.dashboard': STAFF,
  'backoffice.players': [...BRAND_ADMIN, 'support'],
  'backoffice.deposits': STAFF,                 // support looks; finance+ confirms (server-enforced)
  'backoffice.withdrawals': FINANCE,
  'backoffice.finance': FINANCE,
  'backoffice.risk': [...BRAND_ADMIN, 'support'],
  'backoffice.marketing': BRAND_ADMIN,
  'backoffice.notifications': BRAND_ADMIN,
  'backoffice.audit': BRAND_ADMIN,
  'backoffice.settings': BRAND_OWNER,
  'backoffice.staff': BRAND_OWNER,
  // ── the shared engine: one round for every brand → owner only (S2) ────────────
  'engine.control': OWNER,                      // live round + crash point, crash queue, force crash, rain
  'engine.config': OWNER,                       // global game / finance settings, kill switches
  // ── brand console ─────────────────────────────────────────────────────────────
  'console.enter': PLATFORM,
  'console.brands': PLATFORM,                   // list, create, look, plane, features, limits, bonuses
  'console.brand.copy': BRAND_OWNER,            // brand-tier settings: copy, SEO, support, legal, analytics
  'console.domains': PLATFORM,
  'console.payment_accounts': PLATFORM,
  'console.platforms': OWNER,                   // platforms + platform admins
  'console.integrations': OWNER,                // Cloudflare / registrar credentials
  'staff.appoint_brand_owner': PLATFORM,
  'staff.appoint_platform_admin': OWNER,
  // ── earning (operators are never affiliates) ──────────────────────────────────
  'earn.marketer_dashboard': ['marketer'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/** May `role` use `cap`? Unknown or missing role → false (fail closed). */
export function can(role: string | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[cap] as readonly string[]).includes(role);
}

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[];

/** Roles that may enter the back office at all. */
export const OPERATOR_ROLES: Role[] = [...STAFF];
