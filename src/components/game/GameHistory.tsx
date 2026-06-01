import type { GameRound } from '../../types';

interface Props {
  history: GameRound[];
}

function getCrashPillStyle(m: number): string {
  if (m < 2)    return 'bg-transparent text-[#a0a0c0] border border-[#3a3a55]';
  if (m < 5)    return 'bg-transparent text-[#3b82f6] border border-[#3b82f6]/40';
  if (m < 10)   return 'bg-transparent text-[#a855f7] border border-[#a855f7]/40';
  return              'bg-transparent text-[#f59e0b] border border-[#f59e0b]/40';
}

export default function GameHistory({ history }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-thin">
      {history.slice(0, 40).map((round, i) => (
        <span
          key={round.id || i}
          className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${getCrashPillStyle(round.crash_multiplier)}`}
          title={`${round.crash_multiplier.toFixed(2)}x`}
        >
          {round.crash_multiplier >= 100
            ? `${Math.floor(round.crash_multiplier)}x`
            : `${round.crash_multiplier.toFixed(2)}x`}
        </span>
      ))}
      {history.length === 0 && (
        <span className="text-slate-600 text-xs">No history yet</span>
      )}
    </div>
  );
}
