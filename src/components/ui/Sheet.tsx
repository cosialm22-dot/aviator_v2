import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

/**
 * The one dialog container for the player app, built like an iOS sheet.
 * Phones: slides up from the bottom, grabber on top, drag the header down to dismiss.
 * Tablets and up: a centred card. Escape, backdrop tap and the × close it (animated out);
 * focus is trapped inside while open.
 */
export default function Sheet({ title, onClose, children, initialFocus, headerLeft, className = '', label }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement>;
  /** Optional control at the left of the title bar. */
  headerLeft?: ReactNode;
  className?: string;
  /** Accessible name when `title` is not plain text. */
  label?: string;
}) {
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => {
    if (leaving) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { closeRef.current(); return; }
    setLeaving(true);
    setTimeout(() => closeRef.current(), 220);
  }, [leaving]);

  const fallback = useRef<HTMLElement>(null);
  const ref = useModalA11y(close, initialFocus ?? fallback);

  // Drag the grabber / title bar down to dismiss (phones).
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !ref.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transition = 'none';
    ref.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null; if (!d || !ref.current) return;
    const v = d.dy / Math.max(1, performance.now() - d.t);
    ref.current.style.transition = 'transform 250ms cubic-bezier(0.32,0.72,0,1)';
    if (d.dy > 120 || v > 0.6) { ref.current.style.transform = 'translateY(100%)'; setTimeout(() => closeRef.current(), 230); }
    else ref.current.style.transform = '';
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const name = label ?? (typeof title === 'string' ? title : undefined);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={close}
        className={`absolute inset-0 bg-black/50 ${leaving ? 'animate-[fadeOut_0.22s_ease_forwards]' : 'animate-[fadeIn_0.25s_ease]'}`} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={name}
        className={`relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] w-full flex-col overflow-hidden rounded-t-[14px] bg-ios-elev shadow-[0_-8px_40px_rgba(0,0,0,0.5)] sm:max-h-[86vh] sm:max-w-[420px] sm:rounded-[14px] ${leaving ? 'animate-[sheetOut_0.22s_ease-in_forwards]' : 'animate-[sheetIn_0.34s_cubic-bezier(0.32,0.72,0,1)]'} ${className}`}>
        <div className="shrink-0 touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="flex justify-center pt-[5px] sm:hidden"><span className="h-[5px] w-9 rounded-full bg-ios-label3" /></div>
          <div className="grid h-[50px] grid-cols-[72px_1fr_72px] items-center px-2 sm:h-14">
            <div className="justify-self-start">{headerLeft}</div>
            <h2 className="truncate text-center text-headline text-white">{title}</h2>
            <button type="button" onClick={close} aria-label="Close"
              className="grid h-11 w-11 place-items-center justify-self-end">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-ios-fill text-ios-label2"><X size={15} strokeWidth={3} /></span>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
