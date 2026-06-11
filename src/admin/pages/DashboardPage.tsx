import { useState, useEffect } from 'react';
import { Users, TrendingUp, Dices, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [rounds, setRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const [p, b, r, w] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('bets').select('amount, winnings, status').gte('created_at', today).eq('is_bot', false),
        supabase.from('game_rounds').select('id, crash_multiplier, created_at').eq('status', 'crashed').order('created_at', { ascending: false }).limit(20),
        supabase.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      const bets = b.data ?? [];
      const wagered = bets.reduce((s: number, x: any) => s + Number(x.amount), 0);
      const wins = bets.filter((x: any) => x.status === 'won').reduce((s: number, x: any) => s + Number(x.winnings ?? 0), 0);
      setStats({ players: p.count ?? 0, bets: bets.length, revenue: wagered - wins, pending: w.count ?? 0 });
      setRounds(r.data ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="animate-pulse space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-[#111122] rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Revenue Today', value: `KSh ${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Total Players', value: stats.players, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Bets Today', value: stats.bets, icon: Dices, color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { label: 'Pending Withdrawals', value: stats.pending, icon: AlertTriangle, color: stats.pending > 0 ? 'text-amber-400' : 'text-slate-400', bg: stats.pending > 0 ? 'bg-amber-500/10' : 'bg-slate-500/10' },
        ].map(c => (
          <div key={c.label} className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
            <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-3`}><c.icon size={18} className={c.color} /></div>
            <div className="text-xl font-bold text-white">{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl">
        <div className="px-5 py-4 border-b border-[#1e1e35]"><h2 className="text-sm font-semibold text-white">Recent Rounds</h2></div>
        <div className="divide-y divide-[#1e1e35]/50">
          {rounds.map(r => (
            <div key={r.id} className="px-5 py-2.5 flex justify-between">
              <span className="text-slate-400 text-sm">{new Date(r.created_at).toLocaleTimeString()}</span>
              <span className={`font-mono font-bold text-sm ${r.crash_multiplier < 2 ? 'text-red-400' : r.crash_multiplier < 5 ? 'text-amber-400' : 'text-green-400'}`}>{Number(r.crash_multiplier).toFixed(2)}x</span>
            </div>
          ))}
          {rounds.length === 0 && <div className="px-5 py-8 text-center text-slate-600 text-sm">No rounds yet</div>}
        </div>
      </div>
    </div>
  );
}
