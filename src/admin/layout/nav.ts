import {
  ArrowDownToLine, Banknote, Bell, Building2, Gamepad2, LayoutDashboard, Megaphone, ScrollText, Settings,
  ShieldAlert, Ticket, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { canAccess, type Role, type Section } from '../roleContext';

/** scoped: the page follows the brand picked in the header. Pages without it show every brand. */
export interface NavItem { label: string; path: string; icon: LucideIcon; section: Section; hint: string; exact?: boolean; badge?: 'withdrawals'; scoped?: boolean }
export interface NavGroup { id: string; label?: string; items: NavItem[] }

// One source for the sidebar and the ⌘K palette. Groups are ordered by how often staff use them.
export const NAV: NavGroup[] = [
  { id: 'home', items: [
    { label: 'Overview', path: '/admin', icon: LayoutDashboard, section: 'dashboard', hint: 'Today, trends and what needs attention', exact: true, scoped: true},
  ] },
  { id: 'money', label: 'Money', items: [
    { label: 'Deposits', path: '/admin/deposits', icon: ArrowDownToLine, section: 'deposits', hint: 'Mega Pay M-Pesa deposits', scoped: true},
    { label: 'Withdrawals', path: '/admin/withdrawals', icon: Banknote, section: 'withdrawals', hint: 'Review and pay out', badge: 'withdrawals' },
    { label: 'Finance', path: '/admin/finance', icon: Wallet, section: 'finance', hint: 'Reconciliation and ledger' },
  ] },
  { id: 'players', label: 'Players', items: [
    { label: 'Players', path: '/admin/users', icon: Users, section: 'users', hint: 'Accounts, balances, bans', scoped: true},
    { label: 'Risk & fraud', path: '/admin/risk', icon: ShieldAlert, section: 'risk', hint: 'Flags and risk scores' },
  ] },
  { id: 'game', label: 'Game', items: [
    { label: 'Game control', path: '/admin/game', icon: Gamepad2, section: 'game', hint: 'Live round and queue' },
  ] },
  { id: 'growth', label: 'Growth', items: [
    { label: 'Marketing', path: '/admin/marketing', icon: Megaphone, section: 'marketing', hint: 'Affiliates, promotions, commissions' },
    { label: 'Promo codes', path: '/admin/promo-codes', icon: Ticket, section: 'marketing', hint: 'Redeemable rewards' },
    { label: 'Notifications', path: '/admin/notifications', icon: Bell, section: 'notifications', hint: 'Broadcasts to players' },
  ] },
  { id: 'admin', label: 'Administration', items: [
    { label: 'Audit log', path: '/admin/audit', icon: ScrollText, section: 'audit', hint: 'Who did what, when', scoped: true},
    { label: 'Settings', path: '/admin/settings', icon: Settings, section: 'settings', hint: 'Brand, staff, payments' },
  ] },
  { id: 'platform', label: 'Platform', items: [
    { label: 'Brands & controls', path: '/admin/platform', icon: Building2, section: 'platform', hint: 'Every brand, platform switches', scoped: true},
  ] },
];

export function navFor(role: Role | null | undefined): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(role, i.section)) })).filter((g) => g.items.length > 0);
}

/** Longest matching path wins, so /admin/users/123 highlights Players, not Overview. */
export function activePath(pathname: string, items: NavItem[]): string | null {
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/dashboard') return '/admin';
  let best: string | null = null;
  for (const i of items) {
    if (i.exact) continue;
    if ((pathname === i.path || pathname.startsWith(i.path + '/')) && (!best || i.path.length > best.length)) best = i.path;
  }
  return best;
}
