// Admin UI kit — one set of building blocks for every admin page, drawn to Apple's dark design
// language (macOS / iOS HIG): black window, #1c1c1e cards without borders, hairline separators,
// systemBlue selection, 13 pt controls, segmented pickers, pill badges, sentence-case headings.
// Tokens: canvas / surface / raised / line / ink / muted / faint / brand / up / down / warn / gold.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import FitText from './FitText';

export { FitText };

// ── page structure ──────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] font-medium text-faint">{eyebrow}</div>}
        <h1 className="text-[26px] md:text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[15px] leading-5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = '', pad = true, testId }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean; testId?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl bg-surface ${className}`} data-testid={testId}>
      {(title || action) && (
        <div className="flex min-h-[44px] items-center justify-between gap-3 px-5 pb-1 pt-3">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className={pad ? 'px-5 pb-5 ' + (title || action ? 'pt-1' : 'pt-5') : ''}>{children}</div>
    </section>
  );
}

const TONE: Record<string, string> = { ink: 'text-ink', up: 'text-up', down: 'text-down', warn: 'text-warn', brand: 'text-brand' };

export function StatCard({ label, value, sub, tone = 'ink', delta, loading, testId, className = '' }: {
  label: string; value: string; sub?: ReactNode; tone?: keyof typeof TONE | string; delta?: { text: string; good: boolean } | null;
  loading?: boolean; testId?: string; className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-xl bg-surface p-4 ${className}`} data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-muted">{label}</span>
        {delta && <span className={`shrink-0 rounded-full px-1.5 text-[12px] font-semibold tabular-nums ${delta.good ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{delta.text}</span>}
      </div>
      <div className={`mt-1.5 font-semibold tabular-nums tracking-[-0.02em] ${TONE[tone] ?? tone}`}>
        {loading ? <Skeleton className="h-8 w-28" /> : <FitText max={28} min={14}>{value}</FitText>}
      </div>
      {sub && <div className="mt-1 truncate text-[12px] text-faint">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span className={`block animate-pulse rounded-lg bg-raised ${className}`} />;
}

export function Empty({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-raised text-faint">{icon ?? <Inbox size={20} strokeWidth={1.75} />}</div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-down/10 px-4 py-3">
      <span className="flex items-center gap-2 text-[13px] text-down"><AlertTriangle size={15} /> {message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone = 'info', children, onClose }: { tone?: 'info' | 'ok' | 'warn' | 'error'; children: ReactNode; onClose?: () => void }) {
  const cls = { info: 'bg-brand/15', ok: 'bg-up/15', warn: 'bg-warn/15', error: 'bg-down/15' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-[13px] text-ink ${cls}`}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="text-faint hover:text-ink"><X size={14} /></button>}
    </div>
  );
}

// ── controls ────────────────────────────────────────────────────────────────
type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'warn';
const BTN: Record<BtnVariant, string> = {
  default: 'bg-raised text-ink hover:bg-[#3a3a3c] active:bg-[#48484a]',
  primary: 'bg-brand text-white hover:bg-[#1a8cff] active:bg-brand-dark',
  danger: 'bg-down/15 text-down hover:bg-down/25',
  warn: 'bg-warn/15 text-warn hover:bg-warn/25',
  ghost: 'text-brand hover:bg-brand/10',
};
export function Button({ variant = 'default', size = 'md', loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40 ${size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]'} ${BTN[variant]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}{children}
    </button>
  );
}

/** Two-step inline confirmation: first click arms it, second click acts; disarms after 4 s. */
export function ConfirmButton({ children, confirmLabel, onConfirm, variant = 'danger', size = 'sm', disabled, testId }: {
  children: ReactNode; confirmLabel: string; onConfirm: () => void | Promise<void>; variant?: BtnVariant; size?: 'sm' | 'md'; disabled?: boolean; testId?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <Button size={size} variant="default" disabled={disabled} onClick={() => setArmed(true)} data-testid={testId}>{children}</Button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button size={size} variant={variant} loading={busy} data-testid={testId ? testId + '-confirm' : undefined}
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setArmed(false); } }}>{confirmLabel}</Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder, label, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={`relative block ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className="h-8 w-full rounded-lg bg-raised pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50" />
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className = '' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}
      className={`h-8 rounded-lg bg-raised pl-3 pr-8 text-[13px] text-ink focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 ${className}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} data-testid={testId}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${checked ? 'bg-up' : 'bg-[#48484a]'}`}>
      <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-raised p-[2px] self-start">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium transition-colors ${value === t.value ? 'bg-[#636366] text-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]' : 'text-muted hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({ items, value, onChange, label }: { items: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-[9px] bg-raised p-[2px]">
      {items.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={'inline-flex h-7 items-center rounded-[7px] px-3 text-[13px] font-medium transition-colors ' + (value === t.value ? 'bg-[#636366] text-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]' : 'text-muted hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────
export function TableWrap({ children, testId, minWidth = 720 }: { children: ReactNode; testId?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }} data-testid={testId}>{children}</table>
    </div>
  );
}
export function Th({ children, numeric, className = '' }: { children?: ReactNode; numeric?: boolean; className?: string }) {
  return <th className={`h-9 border-b border-line px-3 text-[12px] font-medium text-faint ${numeric ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
}
export function Td({ children, numeric, className = '', title }: { children?: ReactNode; numeric?: boolean; className?: string; title?: string }) {
  return <td title={title} className={`px-3 py-2.5 text-[13px] ${numeric ? 'text-right tabular-nums whitespace-nowrap' : ''} ${className}`}>{children}</td>;
}

export function Pagination({ page, pageSize, total, onPage, label = 'rows' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-muted">
      <span className="tabular-nums">{total === 0 ? `No ${label}` : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${label}`}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous page"><ChevronLeft size={14} /></Button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <Button size="sm" onClick={() => onPage(Math.min(pages - 1, page + 1))} disabled={page + 1 >= pages} aria-label="Next page"><ChevronRight size={14} /></Button>
      </div>
    </div>
  );
}

// ── status ──────────────────────────────────────────────────────────────────
const BADGE: Record<string, string> = {
  up: 'bg-up/15 text-up', down: 'bg-down/15 text-down', warn: 'bg-warn/15 text-warn',
  brand: 'bg-brand/15 text-brand', muted: 'bg-raised text-muted',
};
export function Badge({ tone = 'muted', children }: { tone?: keyof typeof BADGE | string; children: ReactNode }) {
  return <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold ${BADGE[tone] ?? BADGE.muted}`}>{children}</span>;
}

// ── modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, subtitle, onClose, children, footer, tone, width = 480 }: {
  title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; tone?: 'danger'; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Armed once: Escape closes; focus goes to the first field (or [autofocus]), never to the ×.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', k);
    const root = ref.current;
    (root?.querySelector<HTMLElement>('[autofocus],[data-autofocus]')
      ?? root?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]),textarea,select')
      ?? root?.querySelector<HTMLElement>('[data-modal-footer] button'))?.focus();
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-[fadeIn_0.15s_ease]" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90dvh] w-full flex-col rounded-2xl bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08] animate-[menuIn_0.2s_cubic-bezier(0.32,0.72,0,1)]" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="flex items-start gap-3">
            {tone === 'danger' && <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-down/15 text-down"><AlertTriangle size={16} /></span>}
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
              {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
            </div>
          </div>
          <button onClick={() => closeRef.current()} aria-label="Close" className="-mr-1 grid h-7 w-7 place-items-center rounded-full bg-raised text-muted hover:text-ink"><X size={13} strokeWidth={2.75} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div data-modal-footer className="flex justify-end gap-2 px-5 pb-5">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full h-9 px-3 rounded-lg border border-transparent bg-raised text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50';

export function Detail({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-faint">{k}</dt>
      <dd className={`text-[13px] text-ink break-words ${mono ? 'font-mono text-[12px]' : ''}`}>{v ?? '—'}</dd>
    </div>
  );
}
