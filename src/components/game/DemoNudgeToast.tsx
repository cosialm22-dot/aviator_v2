import { X } from 'lucide-react';
import type { DemoNudge } from '../../hooks/useDemoNudges';

// Conversion toast shown over the game while in Demo mode. Fixed, mobile-first,
// bottom-centred so it never blocks the multiplier. Caller wires the CTA to
// switch into Real mode (and open sign-up).
interface Props {
  nudge: DemoNudge | null;
  onPlayReal: () => void;
  onDismiss: () => void;
}

export default function DemoNudgeToast({ nudge, onPlayReal, onDismiss }: Props) {
  if (!nudge) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 flex justify-center pointer-events-none sm:bottom-6">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-sm rounded-2xl bg-gradient-to-br from-[#c8001c] to-[#ff2a00] p-4 text-white shadow-2xl shadow-red-900/50 ring-1 ring-white/10 animate-fade-in-up"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black leading-tight">{nudge.title}</div>
            <div className="mt-0.5 text-xs leading-snug text-white/90">{nudge.sub}</div>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex-shrink-0 rounded-lg p-1 text-white/70 transition hover:bg-white/15 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <button
          onClick={onPlayReal}
          className="mt-3 w-full rounded-xl bg-white py-2.5 text-sm font-black text-[#c8001c] transition active:scale-[0.98] hover:bg-gray-100"
        >
          Play for Real →
        </button>
      </div>
    </div>
  );
}
