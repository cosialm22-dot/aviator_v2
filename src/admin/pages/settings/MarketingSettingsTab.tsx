import { useState, useEffect, useCallback } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { AdminAffiliateOverview } from '../../../types/marketing';
import { errMsg, friendly, fmtKES } from './shared';

// Marketing program settings. These two values live in `marketing_config` (not
// system_settings) and are written exclusively through the server-enforced RPCs
// admin_set_commission_rate / admin_set_qualifying_deposit, which is why this
// tab does not use the generic system-settings editor. Current values are read
// from admin_affiliate_overview (the same source the Marketing hub uses), so the
// figure shown here is always consistent with the affiliate program.
export default function MarketingSettingsTab() {
  const [data, setData] = useState<AdminAffiliateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [ratePct, setRatePct] = useState('');
  const [minDep, setMinDep] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [savingMin, setSavingMin] = useState(false);
  const [savedRate, setSavedRate] = useState(false);
  const [savedMin, setSavedMin] = useState(false);

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

  useEffect(() => { void load(); }, [load]);

  async function saveRate() {
    const pct = Number(ratePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setErr('Commission rate must be between 0% and 100%.'); return; }
    setErr(null); setSavingRate(true);
    try {
      const { error } = await supabase.rpc('admin_set_commission_rate', { p_rate: pct / 100 });
      if (error) throw new Error(friendly(error.message));
      setSavedRate(true); setTimeout(() => setSavedRate(false), 1800);
      await load();
    } catch (e) { setErr(errMsg(e, 'Could not update commission rate.')); } finally { setSavingRate(false); }
  }

  async function saveMin() {
    const m = Number(minDep);
    if (!Number.isFinite(m) || m < 0) { setErr('Qualifying deposit must be zero or more.'); return; }
    setErr(null); setSavingMin(true);
    try {
      const { error } = await supabase.rpc('admin_set_qualifying_deposit', { p_min: m });
      if (error) throw new Error(friendly(error.message));
      setSavedMin(true); setTimeout(() => setSavedMin(false), 1800);
      await load();
    } catch (e) { setErr(errMsg(e, 'Could not update qualifying deposit.')); } finally { setSavingMin(false); }
  }

  if (loading) {
    return <div className="space-y-4">{[...Array(2)].map((_, i) => <div key={i} className="h-28 rounded-xl border border-line bg-surface animate-pulse" />)}</div>;
  }
  if (err && !data) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-down text-sm">{err}</div>;
  }

  const d = data!;
  const rateDirty = String(+(d.commission_rate * 100).toFixed(2)) !== ratePct.trim();
  const minDirty = String(+Number(d.qualifying_deposit_min).toFixed(0)) !== minDep.trim();

  return (
    <div className="space-y-6">
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-down text-[13px]">{err}</div>}

      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line">
          <h3 className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em]">Affiliate commission program</h3>
        </div>
        <p className="px-5 pt-4 text-[12px] text-muted leading-relaxed">
          Commission is a revenue share of the floored GGR of each marketer&rsquo;s qualified referrals. A referral
          qualifies on their first M-Pesa deposit at or above the qualifying amount. There are currently {d.marketer_count} marketer(s).
        </p>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="text-[11px] font-medium text-muted block mb-1.5">Commission rate</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input type="number" min={0} max={100} step="0.01" value={ratePct} onChange={e => setRatePct(e.target.value)} aria-label="Commission rate percent"
                  className="w-32 pr-8 pl-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink text-right tabular-nums font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs">%</span>
              </div>
              {savedRate && !rateDirty && <Check size={16} className="text-up" aria-label="Saved" />}
              {rateDirty && (
                <button onClick={saveRate} disabled={savingRate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
                  {savingRate && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}Save
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted block mb-1.5">Qualifying deposit (minimum)</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs">KSh</span>
                <input type="number" min={0} step="1" value={minDep} onChange={e => setMinDep(e.target.value)} aria-label="Qualifying deposit minimum"
                  className="w-36 pl-11 pr-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink text-right tabular-nums font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
              </div>
              {savedMin && !minDirty && <Check size={16} className="text-up" aria-label="Saved" />}
              {minDirty && (
                <button onClick={saveMin} disabled={savingMin}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
                  {savingMin && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}Save
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-line text-[12px] text-faint">
          Currently paying {fmtKES(d.commission_paid)} of {fmtKES(d.commission_earned)} earned &middot; {fmtKES(d.commission_available)} outstanding.
        </div>
      </section>
    </div>
  );
}
