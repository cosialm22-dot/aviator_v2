import { describe, it, expect } from 'vitest';
import { NAV, activePath, navFor } from './nav';

const all = NAV.flatMap((g) => g.items);
const labels = (role: Parameters<typeof navFor>[0]) => navFor(role).flatMap((g) => g.items.map((i) => i.label));

describe('admin navigation', () => {
  it('each tier sees exactly its tools', () => {
    expect(labels('platform_superadmin')).toContain('Brands & controls');
    expect(labels('super_admin')).not.toContain('Brands & controls');
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
