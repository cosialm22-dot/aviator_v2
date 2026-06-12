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

// Shared heading token — one typographic style for every section/card title (consistency).
const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.12em]';

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

  // Page owns its light surface: cancels AdminLayout's dark `p-6` gutter, repaints canvas.
  // Self-contained — no change to shared layout, so sibling pages are unaffected.
  const SHELL = '-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]';

  if (loading && !s) {
    return (
      <div className={SHELL}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl border border-line bg-surface animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // KPI cards — color is mapped to meaning, never decoration:
  // emerald = money earned, brand = audience, neutral = activity volume, gold = margin.
  const PERF = [
    { label: 'Revenue Today', value: 'KSh ' + fmtKES(s?.revenue ?? 0), icon: TrendingUp, chip: 'bg-emerald-50', ic: 'text-emerald-600' },
    { label: 'Total Players', value: (s?.players ?? 0).toLocaleString(), icon: Users, chip: 'bg-brand-tint', ic: 'text-brand' },
    { label: 'Bets Today', value: (s?.bets ?? 0).toLocaleString(), icon: Dices, chip: 'bg-slate-100', ic: 'text-slate-600' },
    { label: 'House Edge', value: (s?.houseEdge ?? 0).toFixed(1) + '%', icon: Percent, chip: 'bg-gold-tint', ic: 'text-gold' },
  ];

  // Health cards stay calm when healthy and only raise visual signal when action is required.
  const TONES: Record<string, { chip: string; ic: string; ring: string; badge: string }> = {
    amber: { chip: 'bg-amber-50', ic: 'text-amber-600', ring: 'border-amber-200 bg-amber-50/50', badge: 'bg-amber-100 text-amber-700' },
    rose: { chip: 'bg-rose-50', ic: 'text-rose-600', ring: 'border-rose-200 bg-rose-50/50', badge: 'bg-rose-100 text-rose-700' },
    brand: { chip: 'bg-brand-tint', ic: 'text-brand', ring: '', badge: '' },
  };
  const HEALTH = [
    { label: 'Pending Withdrawals', value: (s?.pendingCount ?? 0) + ' \u00b7 KSh ' + fmtKES(s?.pendingAmount ?? 0), icon: AlertTriangle, alert: !!s?.pendingCount, tone: 'amber' },
    { label: 'Zombie Rounds', value: String(s?.zombies ?? 0), icon: Zap, alert: !!s?.zombies, tone: 'rose' },
    { label: 'Active Since', value: s?.activeSince ? new Date(s.activeSince).toLocaleTimeString() : '\u2014', icon: Clock, alert: false, tone: 'brand' },
  ];

  const maxPct = Math.max(...buckets.map(b => b.pct), 1);
  const totalRounds = buckets.reduce((a, b) => a + b.count, 0);

  return (
    <div className={SHELL}>
      <div className="space-y-8">
        {/* Page header: title + live-data transparency + manual refresh */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-ink tracking-tight">Dashboard</h1>
            <p className="text-[13px] text-muted mt-1">Real-time overview of game performance</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 text-[12px] text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live &middot; refreshes every {POLL_MS / 1000}s
            </span>
            {err && (
              <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-[12px] max-w-[260px] truncate" title={err}>{err}</span>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              aria-label="Refresh data"
              title="Refresh"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-surface text-muted hover:text-brand hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Performance KPIs — scanned first (money & scale) */}
        <section>
          <h2 className={HEAD}>Performance</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
            {PERF.map(c => (
              <div key={c.label} className="rounded-xl border border-line bg-surface p-5 hover:border-brand/30 transition-colors">
                <div className={'w-9 h-9 rounded-lg flex items-center justify-center ' + c.chip}>
                  <c.icon size={17} className={c.ic} />
                </div>
                <div className="text-[26px] leading-none font-semibold text-ink tabular-nums tracking-tight mt-4">{c.value}</div>
                <div className="text-[13px] text-muted mt-2">{c.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* System health — action items; visual urgency only when needed */}
        <section>
          <h2 className={HEAD}>System Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
            {HEALTH.map(c => {
              const t = TONES[c.tone];
              return (
                <div key={c.label} className={'rounded-xl border p-5 transition-colors ' + (c.alert ? t.ring : 'border-line bg-surface')}>
                  <div className="flex items-center gap-3">
                    <div className={'w-9 h-9 rounded-lg flex items-center justify-center ' + (c.alert ? t.chip : 'bg-slate-100')}>
                      <c.icon size={17} className={c.alert ? t.ic : 'text-muted'} />
                    </div>
                    {c.alert && (
                      <span className={'ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ' + t.badge}>NEEDS ATTENTION</span>
                    )}
                  </div>
                  <div className="text-xl font-semibold text-ink tabular-nums mt-4">{c.value}</div>
                  <div className="text-[13px] text-muted mt-1">{c.label}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Crash distribution (fairness/outcome shape) + live activity */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD}>Crash Distribution</h2>
            <p className="text-[12px] text-muted mt-1 mb-5">Last {totalRounds} crashed rounds</p>
            <div className="space-y-3.5">
              {buckets.map(b => {
                const w = Math.max((b.pct / maxPct) * 100, 2) + '%';
                // Two colors only: brand baseline, gold marks the rare high-multiplier tail.
                const bar = b.label === '20.00x+' ? 'bg-gold' : 'bg-brand';
                return (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13px] text-ink">{b.label}</span>
                      <span className="text-[12px] text-muted tabular-nums">{b.count} &middot; {b.pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={b.label + ': ' + b.count + ' rounds, ' + b.pct + '%'}>
                      <div className={'h-full rounded-full transition-[width] duration-700 ease-out ' + bar} style={{ width: w }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD + ' flex items-center gap-2'}>
              <Activity size={12} /> Recent Activity
            </h2>
            <div className="mt-4 divide-y divide-line">
              {feed.length === 0 ? (
                <div className="py-10 text-center text-faint text-[13px]">No activity yet</div>
              ) : feed.map((a, i) => (
                <div key={a.id || i} className="flex items-center justify-between py-2.5">
                  <span className="text-[13px] text-ink font-medium truncate max-w-[120px]">{a.username}</span>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={'text-[12px] font-medium tabular-nums ' + (a.status === 'won' ? 'text-emerald-600' : a.status === 'lost' ? 'text-rose-500' : 'text-muted')}>
                      {a.status === 'won' ? (a.cashout_multiplier ? Number(a.cashout_multiplier).toFixed(2) + 'x' : '\u2014') : a.status === 'lost' ? 'lost' : '\u2014'}
                    </span>
                    <span className="text-[12px] text-muted tabular-nums">KSh {Number(a.amount).toLocaleString('en-KE')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
