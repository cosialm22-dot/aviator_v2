import { TabActions } from './components';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import type { AdminAffiliateOverview } from '../../../types/marketing';
import { Button, Card, ErrorState, Notice, inputCls } from '../../ui/kit';
import { fmtKsh, fmtInt, fmtPct, errMsg, friendly } from './shared';
import { StatCard } from './components';

// Overview tab - affiliate-program KPIs + program settings. Program settings
// (commission rate, qualifying deposit) are the single editable home for those
// values; the Commissions tab is purely the payout queue. Edits are super_admin
// only and enforced server-side (admin_set_commission_rate / _qualifying_deposit).
export default function OverviewTab() {
  const { isSuperAdmin } = useAdmin();
  const [data, setData] = useState<AdminAffiliateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ratePct, setRatePct] = useState('');
  const [minDep, setMinDep] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [savingMin, setSavingMin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: d, error } = await supabase.rpc('admin_affiliate_overview');
    if (error) { setErr(friendly(error.message)); setData(null); }
    else {
      const ov = d as AdminAffiliateOverview;
      setData(ov);
      setRatePct(String(+(ov.commission_rate * 100).toFixed(2)));
      setMinDep(String(+Number(ov.qualifying_deposit_min).toFixed(0)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveRate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNotice(null);
    const pct = Number(ratePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setErr('Commission rate must be between 0% and 100%.'); return; }
    setSavingRate(true);
    try {
      const { error } = await supabase.rpc('admin_set_commission_rate', { p_rate: pct / 100 });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Commission rate updated to ${pct}%.`);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not update commission rate.')); } finally { setSavingRate(false); }
  }

  async function saveMin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNotice(null);
    const m = Number(minDep);
    if (!Number.isFinite(m) || m < 0) { setErr('Qualifying deposit must be zero or more.'); return; }
    setSavingMin(true);
    try {
      const { error } = await supabase.rpc('admin_set_qualifying_deposit', { p_min: m });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Qualifying deposit updated to ${fmtKsh(m)}.`);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not update qualifying deposit.')); } finally { setSavingMin(false); }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <div key={i} className="h-[92px] rounded-xl bg-surface animate-pulse" />)}
      </div>
    );
  }

  if (err && !data) {
    return <ErrorState message={err} />;
  }

  const d = data!;

  return (
    <div className="flex flex-col gap-6">
      <TabActions><Button onClick={load}>Refresh</Button></TabActions>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      {/* Program KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Marketers" value={fmtInt(d.marketer_count)} />
        <StatCard label="Referred Players" value={fmtInt(d.referred_count)} />
        <StatCard label="Qualified Referrals" value={fmtInt(d.qualified_count)} />
        <StatCard label="Revenue Generated (GGR)" value={fmtKsh(d.lifetime_ggr)} />
      </div>

      <Card title="Commission" pad={false}>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line pb-1">
          <Cell label="Earned (lifetime)" value={fmtKsh(d.commission_earned)} />
          <Cell label="Paid out" value={fmtKsh(d.commission_paid)} />
          <Cell label="Outstanding (available)" value={fmtKsh(d.commission_available)} strong />
        </div>
      </Card>

      {/* Program settings */}
      <Card title="Program settings">
        <p className="max-w-3xl text-[13px] text-muted">
          Commission is a revenue share of the floored GGR of each marketer&rsquo;s qualified referrals. A referral qualifies on their first M-Pesa deposit at or above the qualifying amount.
        </p>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Commission rate */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-muted">Commission rate</label>
            {isSuperAdmin ? (
              <form onSubmit={saveRate} className="flex items-center gap-2">
                <div className="relative w-32">
                  <input type="number" min={0} max={100} step="0.01" value={ratePct} onChange={e => setRatePct(e.target.value)}
                    className={inputCls + ' pr-8 text-right tabular-nums'} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">%</span>
                </div>
                <Button type="submit" variant="primary" loading={savingRate}>Save</Button>
              </form>
            ) : (
              <div className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular-nums">{fmtPct(d.commission_rate)}
                <span className="ml-2 text-[12px] font-normal tracking-normal text-faint">set by a super admin</span></div>
            )}
          </div>
          {/* Qualifying deposit */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-muted">Qualifying deposit (minimum)</label>
            {isSuperAdmin ? (
              <form onSubmit={saveMin} className="flex items-center gap-2">
                <div className="relative w-36">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">KSh</span>
                  <input type="number" min={0} step="1" value={minDep} onChange={e => setMinDep(e.target.value)}
                    className={inputCls + ' pl-11 text-right tabular-nums'} />
                </div>
                <Button type="submit" variant="primary" loading={savingMin}>Save</Button>
              </form>
            ) : (
              <div className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular-nums">{fmtKsh(d.qualifying_deposit_min)}
                <span className="ml-2 text-[12px] font-normal tracking-normal text-faint">set by a super admin</span></div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={'mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.02em] ' + (strong ? 'text-up' : 'text-ink')}>{value}</div>
    </div>
  );
}
