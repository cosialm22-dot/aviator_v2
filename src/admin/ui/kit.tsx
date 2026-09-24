// Admin UI kit — one set of building blocks for every admin page.
// Tokens: canvas / surface / raised / line / ink / muted / faint / brand / up / down / warn.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import FitText from './FitText';

export { FitText };

// ── page structure ──────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{eyebrow}</div>}
        <h1 className="text-[22px] md:text-2xl font-semibold text-ink tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = '', pad = true, testId }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean; testId?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface min-w-0 ${className}`} data-testid={testId}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          {title && <h2 className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em]">{title}</h2>}
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
    <div className={`rounded-xl border border-line bg-surface p-4 min-w-0 ${className}`} data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted truncate">{label}</span>
        {delta && <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${delta.good ? 'text-up' : 'text-down'}`}>{delta.text}</span>}
      </div>
      <div className={`mt-2 font-semibold tabular-nums tracking-tight ${TONE[tone] ?? tone}`}>
        {loading ? <Skeleton className="h-7 w-28" /> : <FitText max={24} min={13}>{value}</FitText>}
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-faint truncate">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-raised ${className}`} />;
}

export function Empty({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-raised text-faint">{icon ?? <Inbox size={18} />}</div>
      <p className="text-ink text-sm font-medium">{title}</p>
      {body && <p className="text-muted text-[13px] mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-down/30 bg-down/10 px-4 py-3 flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[13px] text-down"><AlertTriangle size={15} /> {message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone = 'info', children, onClose }: { tone?: 'info' | 'ok' | 'warn' | 'error'; children: ReactNode; onClose?: () => void }) {
  const cls = { info: 'border-brand/30 bg-brand/10', ok: 'border-up/30 bg-up/10', warn: 'border-warn/40 bg-warn/10', error: 'border-down/30 bg-down/10' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-2.5 text-[13px] text-ink flex items-center justify-between gap-3 ${cls}`}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="text-faint hover:text-ink"><X size={14} /></button>}
    </div>
  );
}

// ── controls ────────────────────────────────────────────────────────────────
type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'warn';
const BTN: Record<BtnVariant, string> = {
  default: 'border border-line bg-surface text-muted hover:text-ink hover:border-brand/40',
  primary: 'border border-brand bg-brand text-white hover:brightness-110',
  danger: 'border border-down/60 bg-down/15 text-down hover:bg-down/25',
  warn: 'border border-warn/60 bg-warn/10 text-warn hover:bg-warn/20',
  ghost: 'border border-transparent text-muted hover:text-ink hover:bg-raised',
};
export function Button({ variant = 'default', size = 'md', loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed ${size === 'sm' ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3 text-[13px]'} ${BTN[variant]} ${className}`}
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
        className="h-9 w-full pl-8 pr-3 rounded-lg border border-line bg-surface text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40" />
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className = '' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}
      className={`h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} data-testid={testId}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-up' : 'bg-line'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line -mb-px">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={`whitespace-nowrap px-3 py-2 text-[13px] font-medium border-b-2 transition-colors ${value === t.value ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({ items, value, onChange, label }: { items: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 bg-white/[0.04] border border-line rounded-lg p-1 flex-wrap">
      {items.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (value === t.value ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>
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
  return <th className={`px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-muted border-b border-line ${numeric ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
}
export function Td({ children, numeric, className = '', title }: { children?: ReactNode; numeric?: boolean; className?: string; title?: string }) {
  return <td title={title} className={`px-3 py-2.5 ${numeric ? 'text-right tabular-nums whitespace-nowrap' : ''} ${className}`}>{children}</td>;
}

export function Pagination({ page, pageSize, total, onPage, label = 'rows' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="px-4 py-3 border-t border-line flex items-center justify-between gap-3 text-[12px] text-muted">
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
  up: 'bg-up/10 text-up border-up/30', down: 'bg-down/10 text-down border-down/30', warn: 'bg-warn/10 text-warn border-warn/40',
  brand: 'bg-brand/10 text-brand border-brand/30', muted: 'bg-white/[0.05] text-muted border-line',
};
export function Badge({ tone = 'muted', children }: { tone?: keyof typeof BADGE | string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${BADGE[tone] ?? BADGE.muted}`}>{children}</span>;
}

// ── modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, subtitle, onClose, children, footer, tone, width = 480 }: {
  title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; tone?: 'danger'; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full rounded-xl border border-line bg-surface shadow-2xl max-h-[90dvh] flex flex-col" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            {tone === 'danger' && <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-down/15 text-down"><AlertTriangle size={16} /></span>}
            <div>
              <h2 className="text-ink font-semibold">{title}</h2>
              {subtitle && <p className="text-[12px] text-muted mt-1">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-ink mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full h-9 px-3 rounded-lg border border-line bg-canvas text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40';

export function Detail({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{k}</dt>
      <dd className={`text-[13px] text-ink break-words ${mono ? 'font-mono text-[12px]' : ''}`}>{v ?? '—'}</dd>
    </div>
  );
}
