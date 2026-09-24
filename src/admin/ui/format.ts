// Pure formatting helpers shared by every admin page (single source; unit-tested in format.test.ts).

/** KSh 1,234 — whole shillings unless the value has cents. */
export function kes(v: unknown, opts: { cents?: boolean } = {}): string {
  const n = typeof v === 'number' ? v : Number(v);
  const x = Number.isFinite(n) ? n : 0;
  const cents = opts.cents ?? !Number.isInteger(x);
  const s = Math.abs(x).toLocaleString('en-KE', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${x < 0 ? '−' : ''}KSh ${s}`;
}

/** Compact money for tight tiles: KSh 1.2M, KSh 45.3K. */
export function kesCompact(v: unknown): string {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}KSh ${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}KSh ${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}KSh ${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return kes(n);
}

export function num(v: unknown): string {
  const n = Number(v) || 0;
  return n.toLocaleString('en-KE');
}

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/** Change between two periods as a chip: {text:'▲ 12%', good:true}. null when there is nothing to compare. */
export function delta(now: number, before: number, goodWhen: 'up' | 'down' = 'up'): { text: string; good: boolean } | null {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  if (before === 0) return now === 0 ? null : { text: 'New', good: goodWhen === 'up' ? now > 0 : now < 0 };
  const d = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(d) < 0.5) return { text: '0%', good: true };
  const up = d > 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(Math.round(d))}%`, good: goodWhen === 'up' ? up : !up };
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

/** 254712345678 → 0712 •••678 */
export function maskPhone(p: string | null | undefined): string {
  const d = (p || '').replace(/\D/g, '');
  const local = d.startsWith('254') ? '0' + d.slice(3) : d;
  if (local.length < 7) return local || '—';
  return `${local.slice(0, 4)} •••${local.slice(-3)}`;
}

export const ROLE_LABEL: Record<string, string> = {
  platform_superadmin: 'Platform owner',
  super_admin: 'Brand owner',
  admin: 'Admin',
  finance_admin: 'Finance',
  support: 'Support',
  marketer: 'Marketer',
  player: 'Player',
};

/** Server error codes → staff copy. Unknown codes never leak raw SQL. */
export function staffError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  const code = msg.split(':')[0].trim();
  const map: Record<string, string> = {
    NOT_AUTHORIZED: 'Your role cannot do this.',
    FORBIDDEN: 'Your role cannot do this.',
    FORBIDDEN_SITE: 'That belongs to another brand.',
    FORBIDDEN_TARGET: 'Only a brand owner can change another admin.',
    AUTH_REQUIRED: 'Your session expired. Sign in again.',
    NOT_FOUND: 'Not found.',
    CANNOT_TARGET_SELF: 'You cannot do this to your own account.',
    ROOT_SUPER_ADMIN_PROTECTED: 'The platform owner account is protected.',
    REASON_REQUIRED: 'Write a reason.',
    INVALID_SORT: 'Unknown sort order.',
    INVALID_FILTER: 'Unknown filter.',
    INVALID_SHORTCODE: 'The shortcode must be 5–7 digits.',
    INVALID_CALLBACK_URL: 'The callback URL must start with https://.',
    INVALID_ENVIRONMENT: 'Choose sandbox or production.',
  };
  if (map[code]) return map[code];
  const range = /INVALID_RANGE:\s*(.+)/i.exec(msg);
  if (range) return range[1].charAt(0).toUpperCase() + range[1].slice(1);
  return fallback;
}
