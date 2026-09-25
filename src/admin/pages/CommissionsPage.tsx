import { TabActions } from './marketing/components';
import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, Empty, Modal, Notice, PageHeader, Pills, StatCard, TableWrap, Td, Th, inputCls } from '../ui/kit';
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

const TAB_ITEMS = TABS.map(t => ({ value: t.k, label: t.label }));

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
function payoutTone(s: string): 'warn' | 'brand' | 'up' | 'muted' {
  switch (s) {
    case 'pending': return 'warn';
    case 'approved': return 'brand';
    case 'paid': return 'up';
    default: return 'muted';
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

  // Stable closers so the kit Modal does not re-run its focus effect on every keystroke.
  const closeReject = useCallback(() => { if (!busyId) setRejectRow(null); }, [busyId]);
  const closeRecord = useCallback(() => { if (!busyId) setRecordRow(null); }, [busyId]);

  const refresh = <Button onClick={fetchAll} loading={loading}>{loading ? 'Refreshing' : 'Refresh'}</Button>;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      {!embedded ? (
        <PageHeader title="Commissions" subtitle="Review and settle marketer affiliate payouts" actions={refresh} />
      ) : (
        <TabActions>{refresh}</TabActions>
      )}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending Requests" value={String(overview?.pending_count ?? 0)} />
        <StatCard label="Pending Payout Value" value={fmtKsh(overview?.pending_amount ?? 0)} />
        <StatCard label="Total Paid" value={fmtKsh(overview?.paid_total ?? 0)} />
      </div>

      {/* Status tabs */}
      <Pills<StatusTab> items={TAB_ITEMS} value={tab} onChange={setTab} label="Payout status" />

      {/* Table */}
      <Card pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th>Marketer</Th>
              <Th numeric>Amount</Th>
              <Th className="hidden md:table-cell">Phone</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">Requested</Th>
              <Th numeric>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6}><Empty title={`No ${tab === 'all' ? '' : tab + ' '}payouts.`} /></td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                <Td className="font-medium text-ink">{r.marketer_username}</Td>
                <Td numeric className="font-semibold text-ink">{fmtKsh(Number(r.amount))}</Td>
                <Td className="hidden md:table-cell font-mono text-[12px] text-muted">{r.phone_number}</Td>
                <Td>
                  <Badge tone={payoutTone(r.status)}><span className="capitalize">{r.status}</span></Badge>
                  {r.status === 'rejected' && r.rejection_reason && (
                    <div className="mt-1 max-w-[200px] truncate text-[12px] text-faint" title={r.rejection_reason}>{r.rejection_reason}</div>
                  )}
                  {r.status === 'paid' && r.mpesa_receipt && (
                    <div className="mt-1 font-mono text-[12px] text-faint">{r.mpesa_receipt}</div>
                  )}
                </Td>
                <Td className="hidden lg:table-cell whitespace-nowrap text-[12px] text-muted" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {r.status === 'pending' ? (
                    <div className="inline-flex items-center gap-2">
                      <Button size="sm" variant="primary" onClick={() => doApprove(r)} loading={busyId === r.id}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => { setErr(null); setRejectReason(''); setRejectRow(r); }} disabled={busyId === r.id}>Reject</Button>
                    </div>
                  ) : r.status === 'approved' ? (
                    <Button size="sm" variant="primary" onClick={() => { setErr(null); setReceipt(''); setRecordRow(r); }} loading={busyId === r.id}>Record receipt</Button>
                  ) : (
                    <span className="text-[12px] text-faint">{r.reviewer_username ? 'by ' + r.reviewer_username : '-'}</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Reject modal */}
      {rejectRow && (
        <Modal title="Reject payout" tone="danger" onClose={closeReject}
          footer={<>
            <Button onClick={() => setRejectRow(null)} disabled={busyId === rejectRow.id}>Cancel</Button>
            <Button variant="danger" onClick={() => doReject(rejectRow, rejectReason)} loading={busyId === rejectRow.id} disabled={!rejectReason.trim()}>Reject</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted">
            Reject <span className="font-semibold text-ink">{fmtKsh(Number(rejectRow.amount))}</span> for <span className="font-semibold text-ink">{rejectRow.marketer_username}</span>. The commission returns to their available balance. A reason is required and recorded.
          </p>
          <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus rows={3}
            placeholder="Reason for rejection (required)…" aria-label="Reason for rejection"
            className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50" />
        </Modal>
      )}

      {/* Record receipt modal */}
      {recordRow && (
        <Modal title="Record M-Pesa receipt" onClose={closeRecord}
          footer={<>
            <Button onClick={() => setRecordRow(null)} disabled={busyId === recordRow.id}>Cancel</Button>
            <Button variant="primary" onClick={() => doRecord(recordRow, receipt)} loading={busyId === recordRow.id} disabled={!receipt.trim()}>Mark paid</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted">
            Confirm the <span className="font-semibold text-ink">{fmtKsh(Number(recordRow.amount))}</span> payout to <span className="font-semibold text-ink">{recordRow.marketer_username}</span> at <span className="font-mono text-[12px]">{recordRow.phone_number}</span> has been sent via M-Pesa, and enter the receipt to mark it paid.
          </p>
          <input value={receipt} onChange={e => setReceipt(e.target.value)} autoFocus
            placeholder="M-Pesa receipt (e.g. SLJ7RT61SV)" aria-label="M-Pesa receipt"
            className={inputCls + ' font-mono'} />
        </Modal>
      )}
    </div>
  );
}
