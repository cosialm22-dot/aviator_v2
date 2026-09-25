import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdmin, canAccess, type Section } from '../roleContext';
import { useScope } from '../scopeContext';
import { Badge, Button, Card, ErrorState, PageHeader, Pills, Skeleton, StatCard } from '../ui/kit';
import { delta, kes, kesCompact, num, relTime, staffError } from '../ui/format';
import SeriesChart from '../components/SeriesChart';

// ============================================================================
// OVERVIEW — the brand (or, for the platform owner, every brand) at a glance.
// All figures are computed server-side by admin_overview (no row caps, Nairobi days,
// bots excluded, scoped by brand). Refreshes every 30 s while visible.
// ============================================================================

interface Day { day: string; deposits_kes: number; deposits_count: number; withdrawals_kes: number; stake_kes: number; house_revenue_kes: number; bettors: number; new_players: number }
interface Overview {
  scope: 'all' | 'site'; days: number; generated_at: string;
  today: Record<string, number>; series: Day[]; attention: Record<string, number>; totals: Record<string, number>;
}

const DT = 'text-[13px] font-medium text-muted';
const DD = 'mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.02em]';

const RANGES = [{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }] as const;

export default function DashboardPage() {
  const { role } = useAdmin();
  const scope = useScope();
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_overview', { p_site: scope.siteId, p_days: Number(days) });
    setLoading(false);
    if (error) { setErr(staffError(error, 'Could not load the overview.')); return; }
    setErr(null); setOv(data as Overview);
  }, [scope.siteId, days]);

  useEffect(() => { void load(); }, [load]);
  const ref = useRef(load); ref.current = load;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void ref.current(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const t = ov?.today ?? {};
  const yesterday = ov?.series?.[ov.series.length - 2];
  const period = useMemo(() => {
    const s = ov?.series ?? [];
    const sum = (k: keyof Day) => s.reduce((a, d) => a + (Number(d[k]) || 0), 0);
    return { deposits: sum('deposits_kes'), withdrawals: sum('withdrawals_kes'), stake: sum('stake_kes'), revenue: sum('house_revenue_kes'), newPlayers: sum('new_players') };
  }, [ov]);

  const net = (t.deposits_kes ?? 0) - (t.withdrawals_kes ?? 0);
  const a = ov?.attention ?? {};
  type Item = { n: number; label: string; sub?: string; to: string; section: Section; tone: 'down' | 'warn' };
  const items: Item[] = [
    { n: a.withdrawals_pending ?? 0, label: 'Withdrawals waiting for review', sub: a.withdrawals_pending_kes ? kes(a.withdrawals_pending_kes) : undefined, to: '/admin/withdrawals', section: 'withdrawals', tone: 'warn' },
    { n: a.deposits_attention ?? 0, label: 'Deposits needing a check', to: '/admin/deposits', section: 'deposits', tone: 'down' },
    { n: a.withdrawals_failed ?? 0, label: 'Payouts that failed (7 days)', to: '/admin/withdrawals', section: 'withdrawals', tone: 'down' },
    { n: a.high_risk_players ?? 0, label: 'High-risk players', to: '/admin/risk', section: 'risk', tone: 'warn' },
    { n: a.commissions_pending ?? 0, label: 'Marketer payouts to review', to: '/admin/marketing?tab=commissions', section: 'marketing', tone: 'warn' },
    { n: a.stuck_rounds ?? 0, label: 'Rounds stuck in flight', to: '/admin/game', section: 'game', tone: 'down' },
  ];
  const attention = items.filter((x) => x.n > 0 && canAccess(role, x.section));

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={<>{scope.label} · today (Nairobi time){ov && <> · updated {relTime(ov.generated_at)}</>}</>}
        actions={<>
          <Pills items={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={days} onChange={setDays} label="Chart range" />
          <Button onClick={() => void load()} loading={loading} aria-label="Refresh"><RefreshCw size={14} /> Refresh</Button>
        </>}
      />

      {err && <ErrorState message={err} onRetry={() => void load()} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="overview-kpis">
        <StatCard label="Deposits today" value={kes(t.deposits_kes ?? 0)} loading={!ov} tone="up" testId="kpi-deposits"
          sub={`${num(t.deposits_count)} deposits · ${num(t.depositors)} players`} delta={yesterday ? delta(t.deposits_kes ?? 0, yesterday.deposits_kes) : null} />
        <StatCard label="Withdrawals paid" value={kes(t.withdrawals_kes ?? 0)} loading={!ov} testId="kpi-withdrawals"
          sub={yesterday ? `Yesterday ${kes(yesterday.withdrawals_kes)}` : undefined} />
        <StatCard label="Net cash today" value={kes(net)} loading={!ov} tone={net >= 0 ? 'up' : 'down'} sub="Deposits minus paid withdrawals" testId="kpi-net" />
        <StatCard label="House revenue" value={kes(t.house_revenue_kes ?? 0)} loading={!ov} tone={(t.house_revenue_kes ?? 0) >= 0 ? 'up' : 'down'} testId="kpi-revenue"
          sub="Real stakes minus winnings" delta={yesterday ? delta(t.house_revenue_kes ?? 0, yesterday.house_revenue_kes) : null} />
        <StatCard label="Staked today" value={kes(t.stake_kes ?? 0)} loading={!ov} sub={`${num(t.bets_count)} real bets`} testId="kpi-stake" />
        <StatCard label="Players betting" value={num(t.bettors)} loading={!ov} sub={yesterday ? `Yesterday ${num(yesterday.bettors)}` : undefined} testId="kpi-bettors" />
        <StatCard label="New players" value={num(t.new_players)} loading={!ov} sub={`${num(period.newPlayers)} in ${days} days`} testId="kpi-new" />
        <StatCard label="Bonuses given" value={kes(t.bonus_kes ?? 0)} loading={!ov} sub="Credited today" testId="kpi-bonus" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={`Money in and out · ${days} days`} className="xl:col-span-2" testId="chart-money">
          {!ov ? <Skeleton className="h-52 w-full" /> : (
            <SeriesChart rows={ov.series as unknown as Record<string, number | string>[]} xKey="day" format={kes} testId="money-chart"
              series={[
                { key: 'deposits_kes', label: 'Deposits', color: '#30d158' },
                { key: 'withdrawals_kes', label: 'Withdrawals paid', color: '#ff453a' },
                { key: 'house_revenue_kes', label: 'House revenue', color: '#ffd60a', kind: 'line' },
              ]} />
          )}
          {ov && (
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
              <div><dt className={DT}>Deposits</dt><dd className={`${DD} text-ink`}>{kesCompact(period.deposits)}</dd></div>
              <div><dt className={DT}>Withdrawals</dt><dd className={`${DD} text-ink`}>{kesCompact(period.withdrawals)}</dd></div>
              <div><dt className={DT}>Staked</dt><dd className={`${DD} text-ink`}>{kesCompact(period.stake)}</dd></div>
              <div><dt className={DT}>House revenue</dt><dd className={`${DD} ${period.revenue >= 0 ? 'text-up' : 'text-down'}`}>{kesCompact(period.revenue)}</dd></div>
            </dl>
          )}
        </Card>

        <Card title="Needs attention" testId="attention">
          {!ov ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            : attention.length === 0 ? (
              <div className="flex items-center gap-3 py-6 text-[13px] text-muted" data-testid="all-clear">
                <CheckCircle2 size={18} className="text-up" /> All clear — nothing is waiting on staff.
              </div>
            ) : (
              <ul className="-mx-2 divide-y divide-line">
                {attention.map((x) => (
                  <li key={x.label}>
                    <Link to={x.to} className="flex min-h-[48px] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.06]">
                      <span className="flex w-10 shrink-0 justify-center tabular-nums"><Badge tone={x.tone}>{x.n}</Badge></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{x.label}</span>
                        {x.sub && <span className="block text-[12px] tabular-nums text-faint">{x.sub}</span>}
                      </span>
                      <ChevronRight size={14} className="text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          {ov && attention.some((x) => x.tone === 'down') && (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-faint"><AlertTriangle size={13} className="text-down" /> Red items involve money or the live game.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={`Players · ${days} days`} className="xl:col-span-2" testId="chart-players">
          {!ov ? <Skeleton className="h-52 w-full" /> : (
            <SeriesChart rows={ov.series as unknown as Record<string, number | string>[]} xKey="day" format={num}
              series={[
                { key: 'bettors', label: 'Players betting', color: '#0a84ff' },
                { key: 'new_players', label: 'New players', color: '#ff9f0a', kind: 'line' },
              ]} />
          )}
        </Card>
        <Card title="Balances held" testId="balances">
          {!ov ? <Skeleton className="h-32 w-full" /> : (
            <dl className="space-y-3 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Players</dt><dd className="tabular-nums text-ink">{num(ov.totals.players)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Active in 7 days</dt><dd className="tabular-nums text-ink">{num(ov.totals.active_7d)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-3"><dt className="text-muted">Cash owed to players</dt><dd className="font-semibold tabular-nums tracking-[-0.01em] text-ink">{kes(ov.totals.player_balances_kes)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Locked bonus balances</dt><dd className="tabular-nums text-ink">{kes(ov.totals.bonus_balances_kes)}</dd></div>
              <p className="text-[12px] text-faint">Cash owed is what players could withdraw today; keep at least this much available for payouts.</p>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
