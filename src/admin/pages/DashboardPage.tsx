import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { DonutChart, TrendAreaChart } from '../components/charts';

interface Stats {
  revenue: number; players: number; bets: number;
  houseEdge: number; pendingCount: number; pendingAmount: number;
  zombies: number; activeSince: string | null;
}

interface Bucket { label: string; count: number; pct: number }
interface Outcomes { won: number; lost: number; active: number }
interface TrendPoint { x: string; y: number }

interface FeedRow {
  id: string;
  username: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: string;
  created_at: string;
}

const POLL_MS = 5000;

// One typographic style for every section/card title (consistency, no icons).
const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
// One label style for KPI/metric captions.
const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';

function fmtKES(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-KE');
}

export default function DashboardPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [outcomes, setOutcomes] = useState<Outcomes>({ won: 0, lost: 0, active: 0 });
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const zc = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      // Local start-of-day, 6 days back (inclusive) -> 7-day window for the trend.
      const weekStart = new Date();
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - 6);
      const [bR, pR, rR, wR, zR, aR, fR, tR] = await Promise.all([
        supabase.from('bets').select('amount,winnings,status').gte('created_at', today).eq('is_bot', false),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('game_rounds').select('crash_multiplier,status').eq('status', 'crashed').order('created_at', { ascending: false }).limit(200),
        supabase.from('withdrawal_requests').select('amount').eq('status', 'pending'),
        supabase.from('game_rounds').select('id', { count: 'exact', head: true }).eq('status', 'flying').lt('started_at', zc),
        supabase.from('game_rounds').select('started_at').eq('status', 'flying').order('started_at', { ascending: true }).limit(1),
        supabase.from('bets').select('id,username,amount,cashout_multiplier,winnings,status,created_at').order('created_at', { ascending: false }).limit(15),
        supabase.from('bets').select('amount,winnings,status,created_at').gte('created_at', weekStart.toISOString()).eq('is_bot', false),
      ]);
      const bets = bR.data ?? [];
      const wagered = bets.reduce((x: number, b) => x + Math.abs(Number(b.amount)), 0);
      const wins = bets.filter((b) => b.status === 'won').reduce((x: number, b) => x + Number(b.winnings ?? 0), 0);
      const revenue = wagered - wins;

      // Today's outcome split (counts) for the donut.
      setOutcomes({
        won: bets.filter((b) => b.status === 'won').length,
        lost: bets.filter((b) => b.status === 'lost').length,
        active: bets.filter((b) => b.status === 'active').length,
      });

      // 7-day daily house revenue (wagered - wins), bucketed by LOCAL day.
      const dayKey = (d: Date) => d.toLocaleDateString('en-KE', { weekday: 'short' });
      const days: { key: string; date: Date }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push({ key: dayKey(d), date: d });
      }
      const wageredByDay = new Map<string, number>();
      const winsByDay = new Map<string, number>();
      for (const b of tR.data ?? []) {
        const d = new Date(String(b.created_at));
        d.setHours(0, 0, 0, 0);
        const k = d.toISOString().slice(0, 10);
        wageredByDay.set(k, (wageredByDay.get(k) ?? 0) + Math.abs(Number(b.amount)));
        if (b.status === 'won') winsByDay.set(k, (winsByDay.get(k) ?? 0) + Number(b.winnings ?? 0));
      }
      setTrend(days.map(({ key, date }) => {
        const k = date.toISOString().slice(0, 10);
        return { x: key, y: (wageredByDay.get(k) ?? 0) - (winsByDay.get(k) ?? 0) };
      }));
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
        pendingAmount: pending.reduce((x: number, p) => x + Number(p.amount), 0),
        zombies: zR.count ?? 0,
        activeSince: aR.data?.[0]?.started_at ?? null,
      });
      setBuckets(bl);
      setFeed(fR.data ?? []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, POLL_MS); return () => clearInterval(t); }, [fetchAll]);

  // Page owns its light surface: cancels AdminLayout's `p-6` gutter, repaints canvas.
  const SHELL = '-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]';

  if (loading && !s) {
    return (
      <div className={SHELL}>
        <div className="h-[104px] rounded-xl border border-line bg-surface animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl border border-line bg-surface animate-pulse" />)}
        </div>
      </div>
    );
  }

  // KPI numbers are the hero. Color only carries meaning: revenue turns red if the house is down.
  const PERF = [
    { label: 'Revenue Today', value: 'KSh ' + fmtKES(s?.revenue ?? 0), tone: (s?.revenue ?? 0) < 0 ? 'text-down' : 'text-ink' },
    { label: 'Total Players', value: (s?.players ?? 0).toLocaleString(), tone: 'text-ink' },
    { label: 'Bets Today', value: (s?.bets ?? 0).toLocaleString(), tone: 'text-ink' },
    { label: 'House Edge', value: (s?.houseEdge ?? 0).toFixed(1) + '%', tone: 'text-ink' },
  ];

  // Health is status-dot led: calm green when healthy, escalates only on action items.
  const STATE: Record<string, { dot: string; note: string; noteCls: string }> = {
    ok: { dot: 'bg-up', note: '', noteCls: '' },
    warn: { dot: 'bg-amber-500', note: 'Action required', noteCls: 'text-amber-600' },
    danger: { dot: 'bg-down', note: 'Investigate now', noteCls: 'text-down' },
    idle: { dot: 'bg-faint', note: 'Idle', noteCls: 'text-faint' },
  };
  const HEALTH = [
    { label: 'Pending Withdrawals', value: (s?.pendingCount ?? 0) + ' \u00b7 KSh ' + fmtKES(s?.pendingAmount ?? 0), state: s?.pendingCount ? 'warn' : 'ok' },
    { label: 'Zombie Rounds', value: String(s?.zombies ?? 0), state: s?.zombies ? 'danger' : 'ok' },
    { label: 'Active Since', value: s?.activeSince ? new Date(s.activeSince).toLocaleTimeString() : '\u2014', state: s?.activeSince ? 'ok' : 'idle' },
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
                <span className="absolute inline-flex h-full w-full rounded-full bg-up opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
              </span>
              Live &middot; refreshes every {POLL_MS / 1000}s
            </span>
            {err && (
              <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[260px] truncate" title={err}>{err}</span>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50"
            >
              {loading && <span className="h-3.5 w-3.5 rounded-full border-2 border-muted/30 border-t-muted animate-spin" />}
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Performance KPIs - unified hairline-divided strip; numbers are the hero */}
        <section>
          <h2 className={HEAD}>Performance</h2>
          <div className="mt-3 rounded-xl border border-line bg-surface overflow-hidden">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line">
              {PERF.map(c => (
                <div key={c.label} className="p-5 sm:p-6">
                  <div className={CAP}>{c.label}</div>
                  <div className={'mt-2.5 text-[28px] leading-none font-semibold tabular-nums tracking-tight ' + c.tone}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* System health - status-dot led; visual urgency only when needed */}
        <section>
          <h2 className={HEAD}>System Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
            {HEALTH.map(c => {
              const st = STATE[c.state];
              return (
                <div key={c.label} className="rounded-xl border border-line bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <span className={CAP}>{c.label}</span>
                    <span className={'h-2 w-2 rounded-full ' + st.dot} />
                  </div>
                  <div className="mt-3 text-xl font-semibold text-ink tabular-nums">{c.value}</div>
                  {st.note && <div className={'mt-1 text-[12px] ' + st.noteCls}>{st.note}</div>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Revenue trend + today's outcome split */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD}>House Revenue &middot; Last 7 Days</h2>
            <p className="text-[12px] text-muted mt-1 mb-4">Daily wagered minus payouts (KES)</p>
            <TrendAreaChart points={trend} color="#015d72" valueFormatter={(n) => 'KSh ' + fmtKES(n)} />
          </div>
          <div className="lg:col-span-2 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD}>Today&rsquo;s Bet Outcomes</h2>
            <p className="text-[12px] text-muted mt-1 mb-5">Real-player bets settled today</p>
            {outcomes.won + outcomes.lost + outcomes.active === 0 ? (
              <div className="py-10 text-center text-faint text-[13px]">No bets yet today</div>
            ) : (
              <DonutChart
                data={[
                  { label: 'Won', value: outcomes.won, color: '#0ecb81' },
                  { label: 'Lost', value: outcomes.lost, color: '#f6465d' },
                  { label: 'In play', value: outcomes.active, color: '#e0a80b' },
                ]}
                centerLabel="Bets"
                centerValue={String(outcomes.won + outcomes.lost + outcomes.active)}
                valueFormatter={(n) => n.toLocaleString('en-KE')}
              />
            )}
          </div>
        </section>

        {/* Crash distribution (outcome shape) + live activity */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD}>Crash Distribution</h2>
            <p className="text-[12px] text-muted mt-1 mb-5">Last {totalRounds} crashed rounds</p>
            <div className="space-y-3">
              {buckets.map(b => {
                const w = Math.max((b.pct / maxPct) * 100, 2) + '%';
                // Two colors only: brand baseline, gold marks the rare high-multiplier tail.
                const bar = b.label === '20.00x+' ? 'bg-gold' : 'bg-brand';
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-ink">{b.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={b.label + ': ' + b.count + ' rounds, ' + b.pct + '%'}>
                      <div className={'h-full rounded-full transition-[width] duration-700 ease-out ' + bar} style={{ width: w }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[12px] text-muted tabular-nums">{b.count} &middot; {b.pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-line bg-surface p-6">
            <h2 className={HEAD}>Recent Activity</h2>
            <div className="grid grid-cols-[minmax(0,1fr)_64px_104px] gap-3 mt-4 pb-2 border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
              <span>Player</span>
              <span className="text-right">Result</span>
              <span className="text-right">Amount</span>
            </div>
            {feed.length === 0 ? (
              <div className="py-10 text-center text-faint text-[13px]">No activity yet</div>
            ) : (
              <div className="divide-y divide-line">
                {feed.map((a) => (
                  <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_64px_104px] gap-3 py-2.5 items-center">
                    <span className="truncate text-[13px] text-ink font-medium">{a.username}</span>
                    <span className={'text-right text-[12px] font-medium tabular-nums ' + (a.status === 'won' ? 'text-up' : a.status === 'lost' ? 'text-down' : 'text-muted')}>
                      {a.status === 'won' ? (a.cashout_multiplier ? Number(a.cashout_multiplier).toFixed(2) + 'x' : '\u2014') : a.status === 'lost' ? 'Lost' : '\u2014'}
                    </span>
                    <span className="text-right text-[12px] text-muted tabular-nums">KSh {Number(a.amount).toLocaleString('en-KE')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
