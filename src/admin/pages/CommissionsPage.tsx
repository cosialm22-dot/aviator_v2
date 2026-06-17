import { useState, useEffect, useCallback } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { AdminCommissionOverview, AdminCommissionPayoutRow } from '../../types/marketing';

// ============================================================================
// CommissionsPage - admin review & settlement of marketer commission payouts.
// Rendered as the "Commissions" tab of the Marketing hub (embedded), so it omits
// its own page header. Program settings (commission rate, qualifying deposit) are
// owned by the Overview tab - this page is strictly the payout queue.
// Data path (all authorisation + audit server-side, SECURITY DEFINER):
//   • overview -> admin_commission_overview()                 [_is_admin]
//   • list     -> admin_list_commission_payouts(status,limit,offset)
//   • approve  -> admin_review_commission_payout(id,true,note)  pending -> approved
//   • reject   -> admin_review_commission_payout(id,false,reason) pending -> rejected
//   • record   -> admin_record_commission_payout(id,receipt)   approved -> paid
// Approve only authorises; the actual M-Pesa B2C disbursement happens out-of-band,
// then its receipt is recorded here to move the row to 'paid'.
// ============================================================================

type StatusTab = 'pending' | 'approved' | 'paid' | 'rejected' | 'all';
const TABS: { k: StatusTab; label: string }[] = [
  { k: 'pending', label: 'Pending' },
  { k: 'approved', label: 'Approved' },
  { k: 'paid', label: 'Paid' },
  { k: 'rejected', label: 'Rejected' },
  { k: 'all', label: 'All' },
];

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

function fmtKsh(n: number): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have access to this action.',
    NOT_FOUND: 'Payout not found - it may have just changed state.',
    NOT_PENDING: 'This payout is no longer pending. Refresh the queue.',
    NOT_APPROVED: 'This payout is not in the approved state. Refresh the queue.',
    REASON_REQUIRED: 'A rejection reason is required.',
    RECEIPT_REQUIRED: 'An M-Pesa receipt is required.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}
function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function payoutBadge(s: string): string {
  switch (s) {
    case 'pending': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'approved': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    case 'paid': return 'bg-up/10 text-up border-up/30';
    case 'rejected': return 'bg-white/[0.06] text-muted border-line';
    default: return 'bg-white/[0.06] text-muted border-line';
  }
}

export default function CommissionsPage({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<StatusTab>('pending');
  const [rows, setRows] = useState<AdminCommissionPayoutRow[]>([]);
  const [overview, setOverview] = useState<AdminCommissionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // modals
  const [rejectRow, setRejectRow] = useState<AdminCommissionPayoutRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [recordRow, setRecordRow] = useState<AdminCommissionPayoutRow | null>(null);
  const [receipt, setReceipt] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [ovRes, listRes] = await Promise.all([
      supabase.rpc('admin_commission_overview'),
      supabase.rpc('admin_list_commission_payouts', { p_status: tab === 'all' ? null : tab, p_limit: 200, p_offset: 0 }),
    ]);
    if (ovRes.error) setErr(friendly(ovRes.error.message));
    else setOverview(ovRes.data as AdminCommissionOverview);
    if (listRes.error) { setErr(friendly(listRes.error.message)); setRows([]); }
    else setRows((listRes.data ?? []) as AdminCommissionPayoutRow[]);
    setLoading(false);
  }, [tab]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function doApprove(row: AdminCommissionPayoutRow) {
    setBusyId(row.id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_review_commission_payout', { p_id: row.id, p_approve: true, p_note: null });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Approved ${fmtKsh(Number(row.amount))} for ${row.marketer_username}. Disburse via M-Pesa, then record the receipt.`);
      await fetchAll();
    } catch (e) { setErr(errMsg(e, 'Approval failed.')); } finally { setBusyId(null); }
  }

  async function doReject(row: AdminCommissionPayoutRow, reason: string) {
    setBusyId(row.id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_review_commission_payout', { p_id: row.id, p_approve: false, p_note: reason });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Payout for ${row.marketer_username} rejected.`);
      setRejectRow(null); setRejectReason('');
      await fetchAll();
    } catch (e) { setErr(errMsg(e, 'Rejection failed.')); } finally { setBusyId(null); }
  }

  async function doRecord(row: AdminCommissionPayoutRow, mpesa: string) {
    setBusyId(row.id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_record_commission_payout', { p_id: row.id, p_receipt: mpesa });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Recorded payout for ${row.marketer_username} as paid.`);
      setRecordRow(null); setReceipt('');
      await fetchAll();
    } catch (e) { setErr(errMsg(e, 'Could not record receipt.')); } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {!embedded && <h1 className="text-[22px] font-semibold text-ink tracking-tight">Commissions</h1>}
          <p className="text-[13px] text-muted mt-1">Review and settle marketer affiliate payouts</p>
        </div>
        <div className="flex items-center gap-3">
          {notice && <span role="status" className="px-3 py-1.5 bg-up/10 border border-up/30 rounded-lg text-up text-[12px] max-w-[420px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[420px] truncate" title={err}>{err}</span>}
          <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors disabled:opacity-50">
            {loading && <Spin />}{loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className={HEAD}>Pending Requests</div>
          <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{overview?.pending_count ?? 0}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className={HEAD}>Pending Payout Value</div>
          <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{fmtKsh(overview?.pending_amount ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className={HEAD}>Total Paid</div>
          <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{fmtKsh(overview?.paid_total ?? 0)}</div>
        </div>
      </div>

      {/* Status tabs */}
      <div className="inline-flex gap-1 bg-white/[0.06] border border-line rounded-lg p-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} aria-current={tab === t.k ? 'page' : undefined}
            className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (tab === t.k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-medium text-muted text-[12px]">Marketer</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right">Amount</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden md:table-cell">Phone</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px]">Status</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden lg:table-cell">Requested</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-faint text-sm">No {tab === 'all' ? '' : tab + ' '}payouts.</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas/60 transition-colors">
                  <td className="px-5 py-3 text-ink font-medium">{r.marketer_username}</td>
                  <td className="px-5 py-3 text-right text-ink font-semibold tabular-nums">{fmtKsh(Number(r.amount))}</td>
                  <td className="px-5 py-3 text-muted font-mono text-[13px] hidden md:table-cell">{r.phone_number}</td>
                  <td className="px-5 py-3">
                    <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ' + payoutBadge(r.status)}>{r.status}</span>
                    {r.status === 'rejected' && r.rejection_reason && (
                      <div className="text-[11px] text-muted mt-0.5 max-w-[200px] truncate" title={r.rejection_reason}>{r.rejection_reason}</div>
                    )}
                    {r.status === 'paid' && r.mpesa_receipt && (
                      <div className="text-[11px] text-muted mt-0.5 font-mono">{r.mpesa_receipt}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {r.status === 'pending' ? (
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => doApprove(r)} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-semibold transition-colors disabled:opacity-40">
                          {busyId === r.id && <Spin />}Approve
                        </button>
                        <button onClick={() => { setErr(null); setRejectReason(''); setRejectRow(r); }} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-muted hover:text-down hover:border-down/40 text-[12px] font-semibold transition-colors disabled:opacity-40">
                          Reject
                        </button>
                      </div>
                    ) : r.status === 'approved' ? (
                      <button onClick={() => { setErr(null); setReceipt(''); setRecordRow(r); }} disabled={busyId === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-semibold transition-colors disabled:opacity-40">
                        {busyId === r.id && <Spin />}Record receipt
                      </button>
                    ) : (
                      <span className="text-faint text-[12px]">{r.reviewer_username ? 'by ' + r.reviewer_username : '-'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject modal */}
      {rejectRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => busyId ? null : setRejectRow(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Reject payout</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">
              Reject <span className="font-semibold text-ink">{fmtKsh(Number(rejectRow.amount))}</span> for <span className="font-semibold text-ink">{rejectRow.marketer_username}</span>. The commission returns to their available balance. A reason is required and recorded.
            </p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus rows={3}
              placeholder="Reason for rejection (required)…"
              className="mt-4 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-down/30 focus:border-down/40 resize-none transition" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRejectRow(null)} disabled={busyId === rejectRow.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => doReject(rejectRow, rejectReason)} disabled={busyId === rejectRow.id || !rejectReason.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-down hover:brightness-95">
                {busyId === rejectRow.id && <Spin />}Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record receipt modal */}
      {recordRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => busyId ? null : setRecordRow(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Record M-Pesa receipt</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">
              Confirm the <span className="font-semibold text-ink">{fmtKsh(Number(recordRow.amount))}</span> payout to <span className="font-semibold text-ink">{recordRow.marketer_username}</span> at <span className="font-mono">{recordRow.phone_number}</span> has been sent via M-Pesa, and enter the receipt to mark it paid.
            </p>
            <input value={receipt} onChange={e => setReceipt(e.target.value)} autoFocus
              placeholder="M-Pesa receipt (e.g. SLJ7RT61SV)"
              className="mt-4 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRecordRow(null)} disabled={busyId === recordRow.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => doRecord(recordRow, receipt)} disabled={busyId === recordRow.id || !receipt.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">
                {busyId === recordRow.id && <Spin />}Mark paid
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
