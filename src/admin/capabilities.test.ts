import { describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES, CAPABILITIES, can, OPERATOR_ROLES } from './capabilities';

// Pins the tier table to the server rules in 20260930090000_brand_tiers_scope.sql (and the DB e2e
// supabase/tests/brand_config_e2e.py, which checks the same rules as each caller).
describe('capabilities', () => {
  it('the shared engine is owner-only (S2)', () => {
    for (const r of ['platform_admin', 'super_admin', 'admin', 'finance_admin', 'support', 'marketer', 'player']) {
      expect(can(r, 'engine.control')).toBe(false);
      expect(can(r, 'engine.config')).toBe(false);
    }
    expect(can('platform_superadmin', 'engine.control')).toBe(true);
  });
  it('brand console: owner + platform admin; brand owner edits brand-tier copy only', () => {
    expect(can('platform_admin', 'console.brands')).toBe(true);
    expect(can('super_admin', 'console.brands')).toBe(false);
    expect(can('super_admin', 'console.brand.copy')).toBe(true);
    expect(can('admin', 'console.brand.copy')).toBe(false);
  });
  it('platforms, integrations and platform admins: owner only', () => {
    for (const c of ['console.platforms', 'console.integrations', 'staff.appoint_platform_admin'] as const) {
      expect(can('platform_admin', c)).toBe(false);
      expect(can('platform_superadmin', c)).toBe(true);
    }
  });
  it('marketers and players never enter the back office; operators never earn', () => {
    expect(can('marketer', 'backoffice.enter')).toBe(false);
    expect(can('player', 'backoffice.enter')).toBe(false);
    for (const r of OPERATOR_ROLES) expect(can(r, 'earn.marketer_dashboard')).toBe(false);
  });
  it('fails closed', () => {
    expect(can(null, 'backoffice.enter')).toBe(false);
    expect(can('nobody', 'backoffice.enter')).toBe(false);
    expect(ALL_CAPABILITIES.length).toBe(Object.keys(CAPABILITIES).length);
  });
  it('every tier above a role can do what the role can (monotonic ladder)', () => {
    // support and finance_admin are side branches (players vs money); from admin up the ladder is strict.
    const ladder = ['admin', 'super_admin', 'platform_admin', 'platform_superadmin'];
    for (const c of ALL_CAPABILITIES) {
      if (c === 'earn.marketer_dashboard') continue;
      const allowed = ladder.map((r) => can(r, c));
      const first = allowed.indexOf(true);
      if (first >= 0) expect(allowed.slice(first).every(Boolean)).toBe(true);
    }
  });
});
