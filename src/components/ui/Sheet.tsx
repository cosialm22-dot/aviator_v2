import { useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

/**
 * The one dialog container for the player app. Phones: a bottom sheet (thumb reach, full width,
 * clears the home indicator). Tablets and up: a centred card. Escape, backdrop tap and × close
 * it; focus is trapped inside while it is open.
 */
export default function Sheet({ title, onClose, children, initialFocus, hideTitle = false, className = '' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement>;
  /** Keep the title for screen readers but show no header row (the content has its own). */
  hideTitle?: boolean;
  className?: string;
}) {
  const fallback = useRef<HTMLElement>(null);
  const ref = useModalA11y(onClose, initialFocus ?? fallback);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/70 animate-[fadeIn_0.15s_ease]" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#2a2b2e] bg-[#1b1c1d] shadow-2xl animate-[sheetUp_0.2s_ease-out] sm:max-w-md sm:rounded-2xl ${className}`}>
        {hideTitle ? (
          <button type="button" onClick={onClose} aria-label="Close"
            className="absolute right-2 top-2 z-10 grid h-10 w-10 place-items-center rounded-full text-[#9ea0a3] hover:text-white"><X size={18} /></button>
        ) : (
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#2a2b2e] pl-4 pr-1">
            <h2 className="text-[15px] font-semibold text-white">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-[#9ea0a3] hover:text-white"><X size={18} /></button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  );
}
