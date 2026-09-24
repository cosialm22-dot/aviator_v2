import { useState } from 'react';
import { MoreHorizontal, X, History } from 'lucide-react';
import type { GameRound } from '../../types';
import { multColor } from '../../lib/betBoard';

interface Props {
  history: GameRound[];
}

const label = (m: number) => (m >= 100 ? `${Math.floor(m).toLocaleString('en-KE')}x` : `${m.toFixed(2)}x`);

/**
 * Round-history strip (owner's mock): the latest results, coloured blue < 2x, purple 2–10x,
 * pink ≥ 10x, and a "…" button on the right that opens the full round history.
 */
export default function GameHistory({ history }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        {history.slice(0, 30).map((round, i) => (
          <span key={round.id || i} className={`shrink-0 text-[12px] font-semibold tabular-nums ${multColor(round.crash_multiplier)}`}>
            {label(round.crash_multiplier)}
          </span>
        ))}
        {history.length === 0 && <span className="text-xs text-[#7b7b7b]">No rounds yet</span>}
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Round history"
        className="grid h-5 w-8 shrink-0 place-items-center rounded-full bg-[#2c2d30] text-[#9ea0a3] hover:text-white">
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-[#2a2b2e] bg-[#1b1c1d] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#9ea0a3]"><History size={13} />Round history</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close round history" className="text-[#9ea0a3] hover:text-white"><X size={15} /></button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
            {history.slice(0, 60).map((round, i) => (
              <span key={round.id || i} className={`rounded-full bg-[#101011] py-1 text-center text-[12px] font-semibold tabular-nums ${multColor(round.crash_multiplier)}`}>
                {label(round.crash_multiplier)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
