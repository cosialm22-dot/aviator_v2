import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { RefreshCw, TrendingUp, Users, Dices, Percent, AlertTriangle, Activity, Clock, Zap } from 'lucide-react';

interface Stats {
  revenue: number; players: number; bets: number;
  houseEdge: number; pendingCount: number; pendingAmount: number;
  zombies: number; activeSince: string | null;
}

interface Bucket { label: string; count: number; pct: number }

const POLL_MS = 5000;

function fmtKES(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-KE');
}

export default function DashboardPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [feed, setFeed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const zc = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const [bR, pR, rR, wR, zR, aR, fR] = await Promise.all([
        supabase.from('bets').select('amount,winnings,status').gte('created_at', today).eq('is_bot', false),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('game_rounds').select('crash_multiplier,status').eq('status', 'crashed').order('created_at', { ascending: false }).limit(200),
        supabase.from('withdrawal_requests').select('amount').eq('status', 'pending'),
        supabase.from('game_rounds').select('id', { count: 'exact', head: true }).eq('status', 'flying').lt('started_at', zc),
        supabase.from('game_rounds').select('started_at').eq('status', 'flying').order('started_at', { ascending: true }).limit(1),
        supabase.from('bets').select('username,amount,cashout_multiplier,winnings,status,created_at').order('created_at', { ascending: false }).limit(15),
      ]);
      const bets = bR.data ?? [];
      const wagered = bets.reduce((x: number, b: any) => x + Math.abs(Number(b.amount)), 0);
      const wins = bets.filter((b: any) => b.status === 'won').reduce((x: number, b: any) => x + Number(b.winnings ?? 0), 0);
      const revenue = wagered - wins;
      const rounds = rR.data ?? [];
      const bm: Record<string, number> = {
        '1.00x (instant)': 0, '1.01-1.49x': 0, '1.50-2.49x': 0,
        '2.50-5.99x': 0, '6.00-19.99x': 0, '20.00x+': 0
      };
      for (const r of rounds) {
        const m = Number(r.crash_multiplier);
        if (m <= 1.001) bm['1.00x (instant)']++;
        else if (m < 1.5) bm['1.01-1.49x']++;
        else if (m < 2.5) bm['1.50-2.49x']++;
        else if (m < 6) bm['2.50-5.99x']++;
        else if (m < 20) bm['6.00-19.99x']++;
        else bm['20.00x+']++;
      }
      const total = rounds.length || 1;
      const bl: Bucket[] = Object.entries(bm).map(([label, count]) => ({
        label, count, pct: Math.round((count / total) * 100)
      }));
      const pending = wR.data ?? [];
      setS({
        revenue, players: pR.count ?? 0, bets: bets.length,
        houseEdge: Math.round(wagered > 0 ? revenue / wagered * 1000 : 0) / 10,
        pendingCount: pending.length,
        pendingAmount: pending.reduce((x: number, p: any) => x + Number(p.amount), 0),
        zombies: zR.count ?? 0,
        activeSince: aR.data?.[0]?.started_at ?? null,
      });
      setBuckets(bl);
      setFeed(fR.data ?? []);
      setErr(null);
    } catch (e: any) { setErr(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, POLL_MS); return () => clearInterval(t); }, [fetchAll]);

  if (loading && !s) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-[#0a0f14] border border-white/[0.04] rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const PERF = [
    { label: 'Revenue Today',  value: 'KSh ' + fmtKES(s?.revenue ?? 0), icon: TrendingUp,   accent: 'text-emerald-400', bg: 'bg-emerald-500/5' },
    { label: 'Total Players',  value: (s?.players ?? 0).toLocaleString(),    icon: Users,        accent: 'text-blue-400',    bg: 'bg-blue-500/5' },
    { label: 'Bets Today',     value: (s?.bets ?? 0).toLocaleString(),       icon: Dices,        accent: 'text-violet-400',  bg: 'bg-violet-500/5' },
    { label: 'House Edge',     value: (s?.houseEdge ?? 0).toFixed(1) + '%',  icon: Percent,      accent: 'text-cyan-400',    bg: 'bg-cyan-500/5' },
  ];

  const HEALTH = [
    {
      label: 'Pending Withdrawals',
      value: (s?.pendingCount ?? 0) + ' (' + fmtKES(s?.pendingAmount ?? 0) + ' KSh)',
      icon: AlertTriangle,
      accent: s?.pendingCount ? 'text-amber-400' : 'text-slate-500',
      bg: s?.pendingCount ? 'bg-amber-500/5' : 'bg-slate-500/5',
      alert: !!(s?.pendingCount),
      pulse: !!(s?.pendingCount),
    },
    {
      label: 'Zombie Rounds',
      value: String(s?.zombies ?? 0),
      icon: Zap,
      accent: s?.zombies ? 'text-red-400' : 'text-slate-500',
      bg: s?.zombies ? 'bg-red-500/5' : 'bg-slate-500/5',
      alert: !!(s?.zombies),
    },
    {
      label: 'Active Since',
      value: s?.activeSince ? new Date(s.activeSince).toLocaleTimeString() : '\u2014',
      icon: Clock,
      accent: 'text-indigo-400',
      bg: 'bg-indigo-500/5',
    },
  ];

  const maxPct = Math.max(...buckets.map(b => b.pct), 1);

  return (
    <div className="space-y-10 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-slate-500 mt-1">Real-time overview of game performance</p>
        </div>
        <div className="flex items-center gap-3">
          {err && <div className="px-3 py-1.5 bg-red-500/[0.06] border border-red-500/15 rounded-xl text-red-400 text-[11px] max-w-[240px] truncate" title={err}>{err}</div>}
          <button onClick={fetchAll} disabled={loading} className="p-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl text-slate-500 hover:text-white hover:border-[#c8001c]/30 transition-all disabled:opacity-40" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <section>
        <h2 className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-4">Performance</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {PERF.map(c => (
            <div key={c.label} className="bg-[#0a0f14] border border-white/[0.04] rounded-2xl p-6 hover:border-white/[0.08] transition-colors duration-500">
              <div className={'w-9 h-9 rounded-xl ' + c.bg + ' flex items-center justify-center mb-4'}>
                <c.icon size={17} className={c.accent} />
              </div>
              <div className="text-2xl font-black text-white tabular-nums tracking-tight">{c.value}</div>
              <div className="text-[12px] text-slate-500 mt-1.5 font-medium">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-4">System Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {HEALTH.map(c => (
            <div key={c.label} className={'bg-[#0a0f14] border rounded-2xl p-6 transition-colors duration-500 ' + (c.alert ? 'border-amber-500/15 bg-amber-500/[0.02]' : 'border-white/[0.04] hover:border-white/[0.08]')}>
              <div className="flex items-center gap-3 mb-4">
                <div className={'w-9 h-9 rounded-xl ' + c.bg + ' flex items-center justify-center'}>
                  <c.icon size={17} className={c.accent + (c.pulse ? ' animate-pulse' : '')} />
                </div>
                {c.alert && (
                  <span className={'ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ' + (c.label.includes('Withdrawal') ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400')}>
                    NEEDS ATTENTION
                  </span>
                )}
              </div>
              <div className="text-xl font-black text-white tabular-nums">{c.value}</div>
              <div className="text-[12px] text-slate-500 mt-1.5 font-medium">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-[#0a0f14] border border-white/[0.04] rounded-2xl p-6">
          <h2 className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-5">Crash Distribution</h2>
          <div className="space-y-3">
            {buckets.map(b => {
              const bc = b.label === '20.00x+' ? 'bg-amber-500/60' :
                b.label === '6.00-19.99x' ? 'bg-cyan-500/50' :
                b.label === '2.50-5.99x' ? 'bg-emerald-500/50' :
                b.label === '1.50-2.49x' ? 'bg-blue-500/40' :
                b.label === '1.01-1.49x' ? 'bg-amber-600/40' :
                'bg-red-500/40';
              const w = Math.max((b.pct / maxPct) * 100, 2) + '%';
              return (
                <div key={b.label} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] text-slate-300 font-medium">{b.label}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">{b.count} ({b.pct}%)</span>
                  </div>
                  <div className="h-2.5 bg-white/[0.03] rounded-full overflow-hidden">
                    <div className={'h-full rounded-full transition-all duration-700 ease-out ' + bc} style={{{ width: w }}} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 bg-[#0a0f14] border border-white/[0.04] rounded-2xl p-6">
          <h2 className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-5 flex items-center gap-2">
            <Activity size={11} /> Recent Activity
          </h2>
          <div className="space-y-1">
            {feed.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-[13px]">No activity yet</div>
            ) : feed.map((a, i) => (
              <div key={a.id || i} className="flex items-center justify-between py-2.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] rounded-lg px-2 -mx-2 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[13px] text-slate-300 font-medium truncate max-w-[120px]">{a.username}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={'text-[11px] font-mono font-semibold ' + (a.status === 'won' ? 'text-emerald-400' : a.status === 'lost' ? 'text-red-400' : 'text-slate-500')}>
                    {a.status === 'won' ? (a.cashout_multiplier ? Number(a.cashout_multiplier).toFixed(2) + 'x' : '—') : a.status === 'lost' ? 'lost' : '—'}
                  </span>
                  <span className="text-[11px] text-slate-600 font-mono tabular-nums">KSh {Number(a.amount).toLocaleString('en-KE')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}