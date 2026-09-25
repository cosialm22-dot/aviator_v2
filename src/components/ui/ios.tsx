// ============================================================================
// Player UI kit — Apple dark (iOS Human Interface Guidelines) for everything off the game screen.
// One source for sizes and colours: iOS text styles (tailwind fontSize: headline/body/subhead/…),
// system colours (tailwind `ios.*`), 44 pt rows, 50 pt primary buttons, inset grouped lists with
// hairline separators, 32 pt segmented controls and 51×31 switches.
// ============================================================================
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

type Variant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive';
const VARIANT: Record<Variant, string> = {
  filled: 'bg-ios-cta text-ios-cta-fg active:brightness-90 disabled:bg-ios-fill disabled:text-ios-label3',
  tinted: 'bg-[rgba(48,209,88,0.15)] text-ios-green active:bg-[rgba(48,209,88,0.25)] disabled:opacity-40',
  gray: 'bg-ios-fill text-white active:bg-ios-elev3 disabled:opacity-40',
  plain: 'bg-transparent text-ios-green active:opacity-60 disabled:opacity-40',
  destructive: 'bg-transparent text-ios-red active:opacity-60 disabled:opacity-40',
};
const SIZE = { lg: 'h-[50px] w-full rounded-xl px-5 text-headline', md: 'h-11 rounded-[10px] px-4 text-subhead font-semibold', sm: 'h-[30px] rounded-full px-3.5 text-footnote font-semibold' } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }>(
  function Button({ variant = 'filled', size = 'lg', className = '', ...p }, ref) {
    return <button ref={ref} type="button" {...p} className={`inline-flex select-none items-center justify-center gap-2 transition-[filter,background-color,opacity] duration-150 ${SIZE[size]} ${VARIANT[variant]} ${className}`} />;
  });

/** Filled text field (no border), 50 pt, 17 pt text. */
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode }>(
  function Field({ leading, trailing, className = '', ...p }, ref) {
    return (
      <div className={`flex h-[50px] items-center rounded-xl bg-ios-fill px-4 focus-within:ring-2 focus-within:ring-ios-green/60 ${className}`}>
        {leading ? <span className="mr-2 shrink-0 text-body text-ios-label2">{leading}</span> : null}
        <input ref={ref} {...p} className="h-full min-w-0 flex-1 bg-transparent text-body text-white placeholder:text-ios-label3 focus:outline-none" />
        {trailing}
      </div>
    );
  });

/** iOS segmented control (32 pt). */
export function Segmented<T extends string>({ value, onChange, items, label, className = '' }: {
  value: T; onChange: (v: T) => void; items: [T, string][]; label: string; className?: string;
}) {
  const i = Math.max(0, items.findIndex(([k]) => k === value));
  return (
    <div role="tablist" aria-label={label} className={`relative grid h-8 rounded-[9px] bg-ios-fill p-[2px] ${className}`} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      <span aria-hidden className="absolute bottom-[2px] top-[2px] rounded-[7px] bg-[#636366] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-ios"
        style={{ left: 2, width: `calc((100% - 4px) / ${items.length})`, transform: `translateX(${i * 100}%)` }} />
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`relative z-10 text-footnote ${value === k ? 'font-semibold text-white' : 'font-medium text-white/90'}`}>{l}</button>
      ))}
    </div>
  );
}

/** iOS switch, 51×31. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${checked ? 'bg-ios-green' : 'bg-[rgba(120,120,128,0.32)]'}`}>
      <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-[left] duration-200 ease-ios ${checked ? 'left-[22px]' : 'left-[2px]'}`} />
    </button>
  );
}

/** Settings-style icon: white glyph on a coloured 29 pt rounded square. */
export function Glyph({ children, color }: { children: ReactNode; color: string }) {
  return <span className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[7px] text-white" style={{ backgroundColor: color }}>{children}</span>;
}

/** Inset grouped list section (header / rows / footer). `on` = the surface it sits on. */
export function Group({ header, footer, children, on = 'page', className = '' }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; on?: 'page' | 'sheet'; className?: string }) {
  return (
    <section className={className}>
      {header ? <h3 className="px-4 pb-1.5 text-footnote uppercase text-ios-label2">{header}</h3> : null}
      <div className={`overflow-hidden rounded-[10px] ${on === 'sheet' ? 'bg-ios-elev2' : 'bg-ios-elev'}`}>{children}</div>
      {footer ? <p className="px-4 pt-1.5 text-footnote text-ios-label2">{footer}</p> : null}
    </section>
  );
}

/** A 44 pt list row. Hairline separator inset to the text (not under the icon); none on the last row. */
export function Row({ icon, title, subtitle, detail, onClick, chevron, trailing, destructive, role, ariaLabel, className = '' }: {
  icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; detail?: ReactNode; onClick?: () => void; chevron?: boolean; trailing?: ReactNode;
  destructive?: boolean; role?: string; ariaLabel?: string; className?: string;
}) {
  const inset = icon ? 'after:left-[58px]' : 'after:left-4';
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 py-[11px] text-left">
        <span className={`block truncate text-body ${destructive ? 'text-ios-red' : 'text-white'}`}>{title}</span>
        {subtitle ? <span className="block truncate text-footnote text-ios-label2">{subtitle}</span> : null}
      </span>
      {detail != null ? <span className="shrink-0 text-body tabular-nums text-ios-label2">{detail}</span> : null}
      {trailing}
      {chevron ? <ChevronRight size={18} strokeWidth={2.5} className="-mr-1 shrink-0 text-ios-label3" /> : null}
    </>
  );
  const cls = `relative flex min-h-[44px] w-full items-center gap-3 px-4 after:absolute after:bottom-0 after:right-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-ios-sep last:after:hidden ${inset} ${className}`;
  return onClick
    ? <button type="button" role={role} aria-label={ariaLabel} onClick={onClick} className={`${cls} transition-colors active:bg-ios-elev3`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** Centred empty state: one line, quiet. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-6 py-12 text-center text-subhead text-ios-label2">{children}</p>;
}

/** iOS-style activity indicator. */
export function Spinner({ size = 20 }: { size?: number }) {
  return <span role="status" aria-label="Loading" className="inline-block animate-spin rounded-full border-2 border-ios-label3 border-t-white" style={{ width: size, height: size }} />;
}

export const kes = (n: number, dp = 2) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
