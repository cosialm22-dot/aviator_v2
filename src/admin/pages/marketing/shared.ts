// Shared formatting, error-mapping, and status-styling utilities for the admin
// Marketing hub (Overview / Affiliates / Promotions). Pure, non-component module
// so it stays a single source of truth for these helpers and is Fast-Refresh
// friendly. React components live in ./components.

export const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

// Supabase/PostgREST can return Postgres `numeric` as a string; coerce safely.
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtKsh(v: unknown): string {
  return 'KSh ' + num(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtInt(v: unknown): string {
  return num(v).toLocaleString('en-KE');
}

export function fmtPct(fraction: unknown): string {
  return (num(fraction) * 100).toLocaleString('en-KE', { maximumFractionDigits: 2 }) + '%';
}

export function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

export function relTime(iso: string | null): string {
  if (!iso) return '-';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}

// Maps raw RPC error codes (RAISE EXCEPTION '<CODE>') to operator-friendly copy.
// Falls back to the raw code so nothing is ever silently swallowed.
export function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have permission for this action.',
    NOT_FOUND: 'That record no longer exists. Refresh and try again.',
    CANNOT_TARGET_SELF: 'You cannot perform this action on your own account.',
    CANNOT_CONVERT_OPERATOR: 'Admins and super admins cannot be made marketers.',
    ALREADY_MARKETER: 'That user is already a marketer.',
    NOT_A_MARKETER: 'That user is not a marketer.',
    USERNAME_REQUIRED: 'Enter a username.',
    LAST_SUPER_ADMIN: 'You cannot demote the last super admin.',
    INVALID_RATE: 'Commission rate must be between 0% and 100%.',
    INVALID_MIN: 'Qualifying deposit must be zero or more.',
    TITLE_REQUIRED: 'A promotion title is required.',
    INVALID_CATEGORY: 'Choose a valid promotion category.',
    INVALID_REWARD_KIND: 'Choose a valid reward type.',
    INVALID_PERCENTAGE: 'A percentage reward cannot exceed 100%.',
    INVALID_AMOUNT: 'Enter a valid, non-negative amount.',
    INVALID_DATE_RANGE: 'The end date must be after the start date.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

// Status pill styling shared by commission payouts and promotion runtime status.
export function statusBadge(s: string): string {
  switch (s) {
    case 'pending':
    case 'scheduled': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'approved': return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'paid':
    case 'live':
    case 'qualified': return 'bg-emerald-50 text-up border-emerald-200';
    case 'rejected':
    case 'expired':
    case 'inactive': return 'bg-slate-100 text-muted border-line';
    default: return 'bg-slate-100 text-muted border-line';
  }
}
