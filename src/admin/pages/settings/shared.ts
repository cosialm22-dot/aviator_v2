// Pure helpers for the Settings hub (error mapping + formatting). Kept separate
// from React components so it stays Fast-Refresh friendly and is the single home
// for these utilities within the settings area.

export { errMsg } from '../../../lib/errors';

export function fmtKES(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return 'KSh ' + (Number.isFinite(n) ? n : 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

// Maps RAISE EXCEPTION codes from the settings/staff RPCs to operator copy.
// Falls back to the raw code so nothing is silently swallowed.
export function friendly(code: string): string {
  // admin_set_setting raises descriptive 'INVALID_RANGE: <reason>' messages -
  // surface the reason directly so the operator sees exactly what was wrong.
  const range = /INVALID_RANGE:\s*(.+)/i.exec(code);
  if (range) {
    const r = range[1].trim();
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  const map: Record<string, string> = {
    NOT_AUTHORIZED: 'Only a super admin can change system settings.',
    UNKNOWN_SETTING: 'That setting no longer exists. Refresh and try again.',
    SETTING_NOT_EDITABLE: 'That setting is not editable here.',
    FORBIDDEN: 'You do not have permission for this action.',
    NOT_FOUND: 'That account no longer exists. Refresh and try again.',
    CANNOT_TARGET_SELF: 'You cannot change your own role.',
    INVALID_ROLE: 'Choose a valid role.',
    LAST_SUPER_ADMIN: 'You cannot demote the last super admin.',
    SUPER_ADMIN_LOCKED: 'No one can be promoted to super admin.',
    ROOT_SUPER_ADMIN_PROTECTED: 'The super admin is protected and cannot be changed, banned, or removed.',
    CANNOT_CONVERT_OPERATOR: 'Admins and super admins cannot be made marketers.',
    ALREADY_MARKETER: 'That user is already a marketer.',
    NOT_A_MARKETER: 'That user is not a marketer.',
    INVALID_RATE: 'Commission rate must be between 0% and 100%.',
    INVALID_MIN: 'Qualifying deposit must be zero or more.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

// `badge` is the kit <Badge tone> for the role.
export const ROLE_META: Record<string, { label: string; badge: 'down' | 'brand' | 'warn' | 'muted' }> = {
  super_admin: { label: 'Super Admin', badge: 'down' },
  admin:       { label: 'Admin',       badge: 'brand' },
  marketer:    { label: 'Marketer',    badge: 'warn' },
  player:      { label: 'Player',      badge: 'muted' },
};
