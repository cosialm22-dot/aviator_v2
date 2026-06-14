import { useState, useEffect, useCallback } from 'react';
import { Trophy } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Player leaderboard for the "Top" tab. Period x metric toggles; server-side
// aggregation via get_leaderboard. Compact layout for the narrow side panel.

type Period = 'day' | 'week' | 'all';
type Metric = 'winnings' | 'profit' | 'multiplier';

interface Row { rank: number; user_id: string; username: string; avatar_color: string; value: number; rounds: number }

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'all', label: 'All' },
];
const METRICS: { key: Metric; label: string }[] = [
  { key: 'winnings', label: 'Wins' }, { key: 'profit', label: 'Profit' }, { key: 'multiplier', label: 'Multi' },
];

function formatValue(v: number, metric: Metric): string {
  if (metric === 'multiplier') return `${Number(v).toFixed(2)}x`;
  const n = Math.round(Number(v));
  return `${n >= 0 ? '' : '-'}KSh ${Math.abs(n).toLocaleString('en-KE')}`;
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>('day');
  const [metric, setMetric] = useState<Metric>('winnings');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: Period, m: Metric) => {
    setLoading(true);
    const { data } = await supabase.rpc('get_leaderboard', { p_period: p, p_metric: m, p_limit: 25 });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(period, metric); }, [load, period, metric]);

  const rankColor = (r: number) => r === 1 ? 'text-[#f59e0b]' : r === 2 ? 'text-slate-300' : r === 3 ? 'text-amber-700' : 'text-slate-500';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#1e1e30]">
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`flex-1 py-1 text-[10px] font-semibold rounded transition ${period === p.key ? 'bg-[#2a2a45] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#1e1e30]">
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key)}
            className={`flex-1 py-1 text-[10px] font-semibold rounded transition ${metric === m.key ? 'bg-[#c8001c] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="text-center text-slate-600 text-xs py-8">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 text-slate-600 text-xs py-8">
            <Trophy size={20} className="opacity-40" /> No winners yet
          </div>
        ) : rows.map((r) => (
          <div key={r.user_id} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1e1e30]">
            <span className={`w-5 text-center text-[11px] font-black tabular-nums ${rankColor(r.rank)}`}>{r.rank}</span>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 border border-[#2a2a45]" style={{ backgroundColor: r.avatar_color }}>
              {r.username[0]?.toUpperCase()}
            </div>
            <span className="text-slate-300 truncate text-[11px] flex-1 min-w-0">{r.username}</span>
            <span className={`text-[11px] font-bold tabular-nums ${metric === 'profit' && r.value < 0 ? 'text-red-400' : 'text-[#22c55e]'}`}>
              {formatValue(r.value, metric)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
