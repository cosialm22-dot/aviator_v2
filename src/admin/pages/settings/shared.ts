// Pure helpers for the Settings hub (error mapping + formatting). Kept separate
// from React components so it stays Fast-Refresh friendly and is the single home
// for these utilities within the settings area.

export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}

export function fmtKES(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return 'KSh ' + (Number.isFinite(n) ? n : 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

// Maps RAISE EXCEPTION codes from the settings/staff RPCs to operator copy.
// Falls back to the raw code so nothing is silently swallowed.
export function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have permission for this action.',
    NOT_FOUND: 'That account no longer exists. Refresh and try again.',
    CANNOT_TARGET_SELF: 'You cannot change your own role.',
    INVALID_ROLE: 'Choose a valid role.',
    LAST_SUPER_ADMIN: 'You cannot demote the last super admin.',
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

export const ROLE_META: Record<string, { label: string; badge: string }> = {
  super_admin: { label: 'Super Admin', badge: 'bg-rose-50 text-down border-rose-200' },
  admin:       { label: 'Admin',       badge: 'bg-brand/10 text-brand border-brand/20' },
  marketer:    { label: 'Marketer',    badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  player:      { label: 'Player',      badge: 'bg-slate-100 text-muted border-line' },
};
