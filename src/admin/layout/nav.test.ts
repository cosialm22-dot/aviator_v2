import { describe, it, expect } from 'vitest';
import { NAV, activePath, navFor } from './nav';

const all = NAV.flatMap((g) => g.items);
const labels = (role: Parameters<typeof navFor>[0]) => navFor(role).flatMap((g) => g.items.map((i) => i.label));

describe('admin navigation', () => {
  it('each tier sees exactly its tools', () => {
    expect(labels('platform_superadmin')).toEqual(expect.arrayContaining(['Brands', 'Platforms', 'Integrations', 'Controls', 'Game control']));
    // a platform admin runs its brands, never the shared engine or the platform list
    expect(labels('platform_admin')).toContain('Brands');
    expect(labels('platform_admin')).toContain('Payment accounts');
    expect(labels('platform_admin')).not.toContain('Controls');
    expect(labels('platform_admin')).not.toContain('Platforms');
    expect(labels('platform_admin')).not.toContain('Integrations');
    expect(labels('platform_admin')).not.toContain('Game control');
    // a brand owner edits its own brand's words, contacts and legal pages
    expect(labels('super_admin')).toContain('Brands');
    expect(labels('super_admin')).not.toContain('Controls');
    expect(labels('super_admin')).not.toContain('Payment accounts');
    expect(labels('super_admin')).not.toContain('Game control');
    expect(labels('admin')).not.toContain('Brands');
    expect(labels('support')).toEqual(['Overview', 'Deposits', 'Players', 'Risk & fraud']);
    expect(labels('finance_admin')).toEqual(['Overview', 'Deposits', 'Withdrawals', 'Finance']);
    expect(labels('admin')).toContain('Audit log');
    expect(labels('admin')).not.toContain('Settings');
    expect(labels('player')).toEqual([]);
  });
  it('drops groups with nothing left', () => {
    expect(navFor('finance_admin').map((g) => g.id)).toEqual(['home', 'money']);
  });
  it('highlights the longest matching item', () => {
    expect(activePath('/admin', all)).toBe('/admin');
    expect(activePath('/admin/users/abc', all)).toBe('/admin/users');
    expect(activePath('/admin/promo-codes', all)).toBe('/admin/promo-codes');
    expect(activePath('/admin/nothing', all)).toBeNull();
  });
});
