import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import type { AdminAffiliateOverview } from '../../../types/marketing';
import { HEAD, fmtKsh, fmtInt, fmtPct, errMsg, friendly } from './shared';
import { Spin, StatCard } from './components';

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
        {[...Array(8)].map((_, i) => <div key={i} className="h-24 rounded-xl border border-line bg-surface animate-pulse" />)}
      </div>
    );
  }

  if (err && !data) {
    return <div className="rounded-xl border border-down/30 bg-down/10 p-6 text-down text-sm">{err}</div>;
  }

  const d = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3 -mt-2">
        {notice && <span role="status" className="px-3 py-1.5 bg-up/10 border border-up/30 rounded-lg text-up text-[12px] max-w-[420px] truncate" title={notice}>{notice}</span>}
        {err && <span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[420px] truncate" title={err}>{err}</span>}
        <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors">Refresh</button>
      </div>

      {/* Program KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Marketers" value={fmtInt(d.marketer_count)} />
        <StatCard label="Referred Players" value={fmtInt(d.referred_count)} />
        <StatCard label="Qualified Referrals" value={fmtInt(d.qualified_count)} />
        <StatCard label="Revenue Generated (GGR)" value={fmtKsh(d.lifetime_ggr)} />
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line"><h3 className={HEAD}>Commission</h3></div>
        <div className="grid grid-cols-2 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-line">
          <Cell label="Earned (lifetime)" value={fmtKsh(d.commission_earned)} />
          <Cell label="Paid out" value={fmtKsh(d.commission_paid)} />
          <Cell label="Outstanding (available)" value={fmtKsh(d.commission_available)} strong />
        </div>
      </div>

      {/* Program settings */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className={HEAD}>Program settings</div>
        <p className="text-[12px] text-muted mt-1.5">
          Commission is a revenue share of the floored GGR of each marketer&rsquo;s qualified referrals. A referral qualifies on their first M-Pesa deposit at or above the qualifying amount.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Commission rate */}
          <div>
            <label className="text-[11px] font-medium text-muted block mb-1.5">Commission rate</label>
            {isSuperAdmin ? (
              <form onSubmit={saveRate} className="flex items-end gap-2">
                <div className="relative">
                  <input type="number" min={0} max={100} step="0.01" value={ratePct} onChange={e => setRatePct(e.target.value)}
                    className="w-32 px-3 py-2.5 pr-8 bg-surface border border-line rounded-lg text-sm text-ink text-right tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">%</span>
                </div>
                <button type="submit" disabled={savingRate} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
                  {savingRate && <Spin />}Save
                </button>
              </form>
            ) : (
              <div className="text-2xl font-semibold text-ink tabular-nums">{fmtPct(d.commission_rate)}
                <span className="ml-2 text-[12px] font-normal text-faint">set by a super admin</span></div>
            )}
          </div>
          {/* Qualifying deposit */}
          <div>
            <label className="text-[11px] font-medium text-muted block mb-1.5">Qualifying deposit (minimum)</label>
            {isSuperAdmin ? (
              <form onSubmit={saveMin} className="flex items-end gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">KSh</span>
                  <input type="number" min={0} step="1" value={minDep} onChange={e => setMinDep(e.target.value)}
                    className="w-36 pl-11 pr-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink text-right tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
                </div>
                <button type="submit" disabled={savingMin} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
                  {savingMin && <Spin />}Save
                </button>
              </form>
            ) : (
              <div className="text-2xl font-semibold text-ink tabular-nums">{fmtKsh(d.qualifying_deposit_min)}
                <span className="ml-2 text-[12px] font-normal text-faint">set by a super admin</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="p-5">
      <div className={HEAD}>{label}</div>
      <div className={'mt-2 tabular-nums ' + (strong ? 'text-2xl font-semibold text-up' : 'text-xl font-semibold text-ink')}>{value}</div>
    </div>
  );
}
