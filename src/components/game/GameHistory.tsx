import type { GameRound } from '../../types';

interface Props {
  history: GameRound[];
}

// Spribe palette: low = slate-blue, mid = blue, high = purple, huge = pink.
function getCrashPillStyle(m: number): string {
  if (m < 2)    return 'text-[#8b8ba7]';
  if (m < 5)    return 'text-[#4d9fff]';
  if (m < 10)   return 'text-[#a06bff]';
  return              'text-[#e83e8c]';
}

export default function GameHistory({ history }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-thin">
      {history.slice(0, 40).map((round, i) => (
        <span
          key={round.id || i}
          className={`flex-shrink-0 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${getCrashPillStyle(round.crash_multiplier)}`}
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
