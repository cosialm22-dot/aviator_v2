import { useState, useEffect } from 'react';
import { Users, DollarSign, TrendingUp, Activity, AlertTriangle, Gamepad2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Stats {
  totalPlayers: number;
  totalRevenue: number;
  todayBets: number;
  todayRounds: number;
  pendingWithdrawals: number;
  activeToday: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentRounds, setRecentRounds] = useState<any[]>([]);

  useEffect(() => {
    async function fetchStats() {
      const today = new Date().toISOString().split('T')[0];

      const [playersRes, betsRes, roundsRes, withdrawRes, roundHistRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('bets').select('amount')
          .gte('created_at', today).eq('is_bot', false),
        supabase.from('game_rounds').select('id', { count: 'exact', head: true })
          .gte('created_at', today),
        supabase.from('withdrawal_requests').select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase.from('game_rounds').select('*')
          .eq('status', 'crashed').order('created_at', { ascending: false }).limit(15),
      ]);

      const totalWagered = betsRes.data?.reduce((s, b) => s + Number(b.amount), 0) ?? 0;
      const houseEdge = 0.04;
      const estimatedRevenue = Math.round(totalWagered * houseEdge);

      setStats({
        totalPlayers: playersRes.count ?? 0,
        totalRevenue: estimatedRevenue,
        todayBets: betsRes.data?.length ?? 0,
        todayRounds: roundsRes.count ?? 0,
        pendingWithdrawals: withdrawRes.count ?? 0,
        activeToday: betsRes.data ? new Set(betsRes.data.map(() => 'x')).size : 0,
      });

      setRecentRounds(roundHistRes.data ?? []);
      setLoading(false);
    }
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-[#1a1a2e] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'Total Players', value: stats?.totalPlayers ?? 0, icon: Users, color: '#3b82f6' },
    { label: 'Est. Revenue Today', value: `KSh ${(stats?.totalRevenue ?? 0).toLocaleString()}`, icon: DollarSign, color: '#22c55e' },
    { label: 'Bets Today', value: stats?.todayBets ?? 0, icon: TrendingUp, color: '#f59e0b' },
    { label: 'Rounds Today', value: stats?.todayRounds ?? 0, icon: Gamepad2, color: '#8b5cf6' },
    { label: 'Pending Withdrawals', value: stats?.pendingWithdrawals ?? 0, icon: AlertTriangle, color: stats?.pendingWithdrawals ? '#ef4444' : '#64748b' },
    { label: 'Active Players', value: stats?.activeToday ?? 0, icon: Activity, color: '#06b6d4' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-white text-xl font-bold">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-xs font-medium">{label}</span>
              <Icon size={15} style={{ color }} />
            </div>
            <div className="text-white text-xl font-bold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {/* Recent Rounds */}
      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl">
        <div className="px-4 py-3 border-b border-[#2a2a45]">
          <h2 className="text-white text-sm font-semibold">Recent Rounds</h2>
        </div>
        <div className="divide-y divide-[#2a2a45]/50">
          {recentRounds.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">No rounds yet</div>
          )}
          {recentRounds.map((round) => (
            <div key={round.id} className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-slate-500 text-xs font-mono w-8">#{round.round_number ?? '-'}</span>
                <span className={`text-sm font-bold tabular-nums ${
                  round.crash_multiplier < 2 ? 'text-red-400' :
                  round.crash_multiplier < 5 ? 'text-amber-400' : 'text-green-400'
                }`}>
                  {Number(round.crash_multiplier).toFixed(2)}x
                </span>
              </div>
              <span className="text-slate-500 text-[10px]">
                {new Date(round.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
