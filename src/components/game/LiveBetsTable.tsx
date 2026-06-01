import type { GameStatus } from '../../types';

interface LiveBet {
  id: string;
  username: string;
  avatar_color: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: 'active' | 'won' | 'lost';
  is_bot: boolean;
}

interface Props {
  bets: LiveBet[];
  status: GameStatus;
}

function Avatar({ username, color }: { username: string; color: string }) {
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 border border-[#2a2a45]"
      style={{ backgroundColor: color }}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

export default function LiveBetsTable({ bets, status }: Props) {
  const sorted = [...bets].sort((a, b) => {
    const order = { won: 0, active: 1, lost: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      {sorted.length === 0 && (
        <div className="text-center text-slate-600 text-xs py-8">No bets yet</div>
      )}
      {sorted.map(bet => (
        <div
          key={bet.id}
          className={`grid items-center px-3 py-1.5 text-xs border-b border-[#1e1e30] transition-colors ${
            bet.status === 'won' ? 'bg-green-900/10' :
            bet.status === 'lost' ? 'bg-red-900/8' : ''
          }`}
          style={{ gridTemplateColumns: '1fr auto auto auto' }}
        >
          {/* Player */}
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar username={bet.username} color={bet.avatar_color} />
            <span className="text-slate-300 truncate text-[11px]">{bet.username}</span>
          </div>

          {/* Bet KShs */}
          <div className="text-slate-200 font-medium text-[11px] px-2">
            {bet.amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
          </div>

          {/* Multiplier (X column) */}
          <div className="text-[11px] px-2 min-w-[40px] text-center">
            {bet.status === 'won' && bet.cashout_multiplier !== null ? (
              <span className="text-[#22c55e] font-bold">{bet.cashout_multiplier.toFixed(2)}x</span>
            ) : bet.status === 'active' && status === 'flying' ? (
              <span className="text-amber-400 animate-pulse">…</span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>

          {/* Win KShs */}
          <div className="text-[11px] min-w-[48px] text-right">
            {bet.status === 'won' && bet.winnings !== null ? (
              <span className="text-[#22c55e] font-bold">{bet.winnings.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
