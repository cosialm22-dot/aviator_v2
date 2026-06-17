import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ============================================================================
// useModalA11y — the shared accessibility contract for every dialog/modal.
//
// On open it remembers the trigger, moves focus into the dialog (an explicit
// `initialFocus` target if given, else the first focusable element), traps Tab
// within the dialog, and closes on Escape. On unmount it restores focus to the
// trigger. Returns a ref to spread onto the dialog container.
//
// `onClose` is read through a ref so the listener is armed exactly once and is
// never torn down / re-captured by parent re-renders.
// ============================================================================
export function useModalA11y(
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement>,
): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const target = initialFocus?.current
      ?? containerRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ?? null;
    target?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // Run exactly once for the lifetime of the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return containerRef;
}
