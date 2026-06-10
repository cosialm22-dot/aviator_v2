import { useState, useEffect } from 'react';
import { Users, TrendingUp, Dices, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Stats {
  totalPlayers: number;
  activePlayers24h: number;
  totalBetsToday: number;
  totalWageredToday: number;
  totalWinsToday: number;
  revenueToday: number;
  pendingWithdrawals: number;
  roundsToday: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentRounds, setRecentRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    const today = new Date().toISOString().split('T')[0];

    const [players, betsToday, roundsToday, withdrawals] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('bets').select('amount, winnings, status, is_bot').gte('created_at', today).eq('is_bot', false),
      supabase.from('game_rounds').select('id, crash_multiplier, created_at').eq('status', 'crashed').gte('created_at', today).order('created_at', { ascending: false }).limit(20),
      supabase.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);

    const bets = betsToday.data ?? [];
    const totalWagered = bets.reduce((s, b) => s + Number(b.amount), 0);
    const totalWins = bets.filter(b => b.status === 'won').reduce((s, b) => s + Number(b.winnings ?? 0), 0);

    setStats({
      totalPlayers: players.count ?? 0,
      activePlayers24h: 0, // Would need last_active_at query
      totalBetsToday: bets.length,
      totalWageredToday: totalWagered,
      totalWinsToday: totalWins,
      revenueToday: totalWagered - totalWins,
      pendingWithdrawals: withdrawals.count ?? 0,
      roundsToday: roundsToday.data?.length ?? 0,
    });

    setRecentRounds(roundsToday.data ?? []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-[#111122] rounded-xl" />)}
        </div>
        <div className="h-64 bg-[#111122] rounded-xl" />
      </div>
    );
  }

  const cards = [
    {
      label: 'Revenue Today',
      value: `KSh ${(stats?.revenueToday ?? 0).toLocaleString('en-KE')}`,
      icon: TrendingUp,
      color: stats && stats.revenueToday >= 0 ? 'text-green-400' : 'text-red-400',
      bgColor: stats && stats.revenueToday >= 0 ? 'bg-green-500/10' : 'bg-red-500/10',
      trend: stats && stats.revenueToday >= 0 ? ArrowUpRight : ArrowDownRight,
    },
    {
      label: 'Total Players',
      value: stats?.totalPlayers.toLocaleString() ?? '0',
      icon: Users,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Bets Today',
      value: stats?.totalBetsToday.toLocaleString() ?? '0',
      icon: Dices,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      sub: `KSh ${(stats?.totalWageredToday ?? 0).toLocaleString('en-KE')} wagered`,
    },
    {
      label: 'Pending Withdrawals',
      value: stats?.pendingWithdrawals.toString() ?? '0',
      icon: AlertTriangle,
      color: stats && stats.pendingWithdrawals > 0 ? 'text-amber-400' : 'text-slate-400',
      bgColor: stats && stats.pendingWithdrawals > 0 ? 'bg-amber-500/10' : 'bg-slate-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Platform overview and key metrics</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                  <Icon size={18} className={card.color} />
                </div>
                {card.trend && <card.trend size={16} className={card.color} />}
              </div>
              <div className="text-xl font-bold text-white">{card.value}</div>
              <div className="text-xs text-slate-500 mt-1">{card.label}</div>
              {card.sub && <div className="text-[10px] text-slate-600 mt-0.5">{card.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* Recent rounds */}
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl">
        <div className="px-5 py-4 border-b border-[#1e1e35]">
          <h2 className="text-sm font-semibold text-white">Recent Rounds</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-[#1e1e35]">
                <th className="text-left px-5 py-3 font-medium">Time</th>
                <th className="text-right px-5 py-3 font-medium">Crash Point</th>
              </tr>
            </thead>
            <tbody>
              {recentRounds.map(round => (
                <tr key={round.id} className="border-b border-[#1e1e35]/50 hover:bg-[#1a1a2e]/50">
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(round.created_at).toLocaleTimeString()}
                  </td>
                  <td className={`px-5 py-3 text-right font-mono font-bold ${
                    round.crash_multiplier < 2 ? 'text-red-400' :
                    round.crash_multiplier < 5 ? 'text-amber-400' :
                    'text-green-400'
                  }`}>
                    {Number(round.crash_multiplier).toFixed(2)}x
                  </td>
                </tr>
              ))}
              {recentRounds.length === 0 && (
                <tr><td colSpan={2} className="px-5 py-8 text-center text-slate-600">No rounds today</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
