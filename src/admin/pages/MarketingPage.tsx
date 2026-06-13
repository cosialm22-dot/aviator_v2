import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketerDashboard, CommissionPayout } from '../../types/marketing';

// ============================================================================
// MarketingPage - the marketer's OWN affiliate dashboard (no leaderboard).
// Data path (all authorisation server-side, SECURITY DEFINER, _is_marketer()):
//   • load    -> marketer_dashboard()            (own stats + referral code)
//   • request -> request_commission_payout(amt,phone)  (validated vs available)
// Commission is a separate ledger from the marketer's player wallet; payouts
// are admin-verified and settled out-of-band via M-Pesa, then recorded.
// ============================================================================

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

function fmtKsh(n: number): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}
function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'This page is only available to marketers.',
    INVALID_PHONE: 'Enter a valid Kenyan phone number (e.g. 0712345678).',
    AMOUNT_TOO_LOW: 'Enter a payout amount greater than zero.',
    AMOUNT_NOT_INTEGER: 'Enter a whole number (no decimals).',
    PAYOUT_PENDING: 'You already have a pending payout request. Wait for it to be reviewed.',
    INSUFFICIENT_COMMISSION: 'That exceeds your available commission.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}
function Spin() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />;
}
function payoutBadge(s: string): string {
  switch (s) {
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'approved': return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'paid': return 'bg-emerald-50 text-up border-emerald-200';
    case 'rejected': return 'bg-slate-100 text-muted border-line';
    default: return 'bg-slate-100 text-muted border-line';
  }
}

export default function MarketingPage() {
  const [data, setData] = useState<MarketerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: d, error } = await supabase.rpc('marketer_dashboard');
    if (error) { setErr(friendly(error.message)); setData(null); }
    else setData(d as MarketerDashboard);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const referralLink = data ? `${window.location.origin}/?ref=${data.referral_code}` : '';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked - user can select manually */ }
  }

  async function submitPayout(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNotice(null);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) { setErr('Enter a whole number greater than zero.'); return; }
    if (data && amt > data.commission_available) { setErr('That exceeds your available commission.'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_commission_payout', { p_amount: amt, p_phone: phone });
      if (error) throw new Error(friendly(error.message));
      setNotice('Payout request submitted. An admin will review it shortly.');
      setAmount(''); setPhone('');
      await load();
    } catch (e2) {
      setErr(errMsg(e2, 'Could not submit payout request.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-xl border border-line bg-surface animate-pulse" />)}
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-down text-sm">{err}</div>
    );
  }

  const d = data!;
  const ratePct = (d.commission_rate * 100).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const hasPending = d.commission_pending > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">My Marketing</h1>
          <p className="text-[13px] text-muted mt-1">Your referrals, commission, and payouts &middot; revenue share at {ratePct}%</p>
        </div>
        <div className="flex items-center gap-3">
          {notice && <span role="status" className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-up text-[12px] max-w-[360px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[360px] truncate" title={err}>{err}</span>}
          <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors">Refresh</button>
        </div>
      </div>

      {/* Referral link */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className={HEAD}>Your referral link</div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[220px] px-3 py-2.5 bg-canvas border border-line rounded-lg text-ink text-[13px] font-mono break-all">{referralLink}</code>
          <button onClick={copyLink} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors">
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="text-[12px] text-muted mt-2">
          Share this link. New players who sign up through it are attributed to you and qualify once they make their first M-Pesa deposit of KSh 50 or more.
        </p>
      </div>

      {/* Referral KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Referred Players" value={d.referred_count.toLocaleString('en-KE')} />
        <Stat label="Qualified" value={d.qualified_count.toLocaleString('en-KE')} />
        <Stat label="Revenue Generated (GGR)" value={fmtKsh(d.lifetime_ggr)} />
        <Stat label="Commission Rate" value={`${ratePct}%`} />
      </div>

      {/* Commission ledger */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line"><h3 className={HEAD}>Commission</h3></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-line">
          <Cell label="Earned (lifetime)" value={fmtKsh(d.commission_earned)} />
          <Cell label="Paid out" value={fmtKsh(d.commission_paid)} />
          <Cell label="Pending + Approved" value={fmtKsh(d.commission_pending + d.commission_approved)} />
          <Cell label="Available" value={fmtKsh(d.commission_available)} strong />
        </div>
      </div>

      {/* Request payout */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className={HEAD}>Request a payout</div>
        {hasPending ? (
          <p className="mt-3 text-[13px] text-muted">
            You have a pending payout request. You can submit a new one once it has been reviewed.
          </p>
        ) : d.commission_available <= 0 ? (
          <p className="mt-3 text-[13px] text-muted">
            No commission is available to withdraw yet. Keep referring players - commission accrues as your qualified referrals play.
          </p>
        ) : (
          <form onSubmit={submitPayout} className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="text-[11px] font-medium text-muted block mb-1.5">Amount (KSh)</label>
              <input
                type="number" inputMode="numeric" min={1} step={1} value={amount}
                onChange={e => setAmount(e.target.value)} required
                placeholder={`Up to ${Math.floor(d.commission_available)}`}
                className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-medium text-muted block mb-1.5">M-Pesa phone</label>
              <input
                type="tel" inputMode="numeric" value={phone}
                onChange={e => setPhone(e.target.value)} required
                placeholder="0712345678"
                className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition"
              />
            </div>
            <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
              {submitting && <Spin />}Request payout
            </button>
          </form>
        )}
        <p className="text-[12px] text-faint mt-3">Every payout is reviewed and verified by an admin before settlement.</p>
      </div>

      {/* Payout history */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line"><h3 className={HEAD}>Payout history</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right">Amount</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden sm:table-cell">Phone</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px]">Status</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden md:table-cell">M-Pesa receipt</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden lg:table-cell">Requested</th>
              </tr>
            </thead>
            <tbody>
              {d.payouts.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-faint text-sm">No payout requests yet.</td></tr>
              ) : d.payouts.map((p: CommissionPayout) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 text-right text-ink font-semibold tabular-nums">{fmtKsh(p.amount)}</td>
                  <td className="px-5 py-3 text-muted font-mono text-[13px] hidden sm:table-cell">{p.phone_number}</td>
                  <td className="px-5 py-3">
                    <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ' + payoutBadge(p.status)}>{p.status}</span>
                    {p.status === 'rejected' && p.rejection_reason && (
                      <div className="text-[11px] text-muted mt-0.5 max-w-[220px] truncate" title={p.rejection_reason}>{p.rejection_reason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted font-mono text-[12px] hidden md:table-cell">{p.mpesa_receipt ?? '-'}</td>
                  <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className={HEAD}>{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{value}</div>
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
