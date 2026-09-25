import { useState, useEffect, useCallback, useRef } from 'react';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, Empty, ErrorState, Modal, Notice, PageHeader, StatCard, TableWrap, Tabs, Td, Th } from '../ui/kit';

// ============================================================================
// WithdrawalsPage - admin cashier queue (Milestone 1)
// ----------------------------------------------------------------------------
// Data path (all authorisation + audit lives server-side):
//   • list    -> admin_list_withdrawals(p_status,p_limit,p_offset)  [SECURITY DEFINER]
//                returns wallet balance + lifetime stats the client cannot read
//                directly (no admin RLS policy on `wallets`).
//   • approve -> admin_approve_withdrawal(p_id,p_note) stamps reviewer + audits
//                and KEEPS status='pending', then we invoke the deployed
//                `mpesa-b2c` edge fn (it requires 'pending', debits the wallet,
//                and transitions the row to 'processing'). No double-debit.
//   • reject  -> admin_reject_withdrawal(p_id,p_reason): 'pending' -> 'rejected'.
//                No refund - request_withdrawal never debited.
// ============================================================================

interface WithdrawalRow {
  id: string;
  user_id: string;
  username: string;
  phone_number: string;
  amount: number;
  status: string;
  auto_approved: boolean;
  risk_score: number | null;
  risk_flags: unknown;
  rejection_reason: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewer_username: string | null;
  reviewed_at: string | null;
  created_at: string;
  completed_at: string | null;
  mpesa_receipt: string | null;
  wallet_balance: number | null;
  total_deposited: number | null;
  total_withdrawn: number | null;
  total_wagered: number | null;
  total_won: number | null;
}

type StatusTab = 'pending' | 'processing' | 'completed' | 'failed' | 'rejected' | 'all';

const TABS: { k: StatusTab; label: string }[] = [
  { k: 'pending', label: 'Pending' },
  { k: 'processing', label: 'Processing' },
  { k: 'completed', label: 'Completed' },
  { k: 'failed', label: 'Failed' },
  { k: 'rejected', label: 'Rejected' },
  { k: 'all', label: 'All' },
];

function fmtKES(n: number): string {
  return 'KSh ' + Math.round(n).toLocaleString('en-KE');
}


function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/** Map backend RPC / edge error codes to safe, actionable admin copy. */
function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have admin privileges.',
    NOT_FOUND: 'Withdrawal not found - it may have just changed state.',
    NOT_PENDING: 'This withdrawal is no longer pending. Refresh the queue.',
    REASON_REQUIRED: 'A rejection reason is required.',
    INVALID_STATUS: 'This withdrawal is no longer pending. Refresh the queue.',
    AMOUNT_MISMATCH: 'Amount no longer matches the request. Refresh the queue.',
    PHONE_MISMATCH: 'Phone no longer matches the request. Refresh the queue.',
    'Insufficient balance': 'Player balance is now below the requested amount; payout aborted.',
    AUTH_ERROR: 'Could not authenticate with M-Pesa. Check Daraja credentials.',
    Server: 'M-Pesa is not configured on the server (Daraja credentials missing).',
    NOT_FOUND_FN: 'M-Pesa payout function is not deployed.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

/** supabase-js wraps non-2xx Edge responses; the body holds { error, message }. */
async function extractFnError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
    if (ctx?.json) {
      const body = (await ctx.json()) as { error?: string; message?: string };
      return String(body?.error || body?.message || 'network');
    }
  } catch { /* fall through */ }
  return 'network';
}


/** Withdrawal status → kit Badge tone. */
function statusTone(s: string): string {
  switch (s) {
    case 'pending': return 'warn';
    case 'processing': return 'brand';
    case 'completed': return 'up';
    case 'failed': return 'down';
    default: return 'muted';
  }
}

function riskTone(score: number): string {
  if (score >= 70) return 'down';
  if (score >= 30) return 'warn';
  return 'muted';
}

export default function WithdrawalsPage() {
  const [tab, setTab] = useState<StatusTab>('pending');
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-row action lock so only the acted-on row's buttons spin/disable.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<WithdrawalRow | null>(null);   // approve target
  const [rejectRow, setRejectRow] = useState<WithdrawalRow | null>(null); // reject target
  const [rejectReason, setRejectReason] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_list_withdrawals', {
      p_status: tab === 'all' ? null : tab,
      p_limit: 200,
      p_offset: 0,
    });
    if (error) {
      setErr(friendly(error.message));
      setRows([]);
    } else {
      setRows((data ?? []) as WithdrawalRow[]);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live updates: refresh the current view whenever a withdrawal changes, and
  // surface a notice when a new request arrives. A ref keeps the subscription
  // pointed at the latest fetchAll without re-subscribing on every tab change.
  const fetchRef = useRef(fetchAll);
  useEffect(() => { fetchRef.current = fetchAll; }, [fetchAll]);
  useEffect(() => {
    const channel = supabase
      .channel('admin-withdrawals-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'withdrawal_requests' }, (payload) => {
        const amt = Number((payload.new as { amount?: number })?.amount ?? 0);
        setNotice('New withdrawal request received' + (amt ? ': ' + fmtKES(amt) : '') + '.');
        fetchRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'withdrawal_requests' }, () => {
        fetchRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const pendingTotal = rows.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0);

  async function doApprove(row: WithdrawalRow) {
    setBusyId(row.id);
    setErr(null);
    setNotice(null);
    try {
      // 1) Authorise + stamp reviewer + audit (status stays 'pending').
      const { data, error } = await supabase.rpc('admin_approve_withdrawal', { p_id: row.id, p_note: null });
      if (error) throw new Error(friendly(error.message));

      const ret = data as { amount: number; phone_number: string; withdrawal_request_id: string };

      // 2) Trigger the real payout via the deployed M-Pesa B2C rail. It strictly
      //    requires the row's canonical amount + phone, so pass the RPC's values.
      const { error: fnErr } = await supabase.functions.invoke('mpesa-b2c', {
        body: {
          withdrawal_request_id: ret.withdrawal_request_id,
          amount: ret.amount,
          phone_number: ret.phone_number,
        },
      });
      if (fnErr) {
        // Approval IS recorded; only the payout rail failed. Surface honestly.
        throw new Error(
          'Approved & logged, but the M-Pesa payout did not start: ' +
          friendly(await extractFnError(fnErr)) +
          ' You can retry from the Pending queue.'
        );
      }
      setNotice(`Payout initiated for ${row.username} (${fmtKES(Number(row.amount))}).`);
      setConfirm(null);
      await fetchAll();
    } catch (e) {
      setErr(errMsg(e, 'Approval failed.'));
    } finally {
      setBusyId(null);
    }
  }

  async function doReject(row: WithdrawalRow, reason: string) {
    setBusyId(row.id);
    setErr(null);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_reject_withdrawal', { p_id: row.id, p_reason: reason });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Withdrawal for ${row.username} rejected.`);
      setRejectRow(null);
      setRejectReason('');
      await fetchAll();
    } catch (e) {
      setErr(errMsg(e, 'Rejection failed.'));
    } finally {
      setBusyId(null);
    }
  }

  // Stable close handlers for the kit Modal (it re-runs its focus effect when onClose changes).
  // Same guard as before: a dialog cannot be dismissed while its action is running.
  const closeConfirm = useCallback(() => { if (!busyId) setConfirm(null); }, [busyId]);
  const closeReject = useCallback(() => { if (!busyId) setRejectRow(null); }, [busyId]);
  // Keep the reason box focused when the reject dialog opens (runs after the Modal's own focus).
  const rejectRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (rejectRow) rejectRef.current?.focus(); }, [rejectRow]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Withdrawals"
        subtitle="Review, approve and reject player payouts"
        actions={<Button onClick={fetchAll} loading={loading}>{loading ? 'Refreshing' : 'Refresh'}</Button>}
      />

      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <ErrorState message={err} />}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard label="Pending Requests" value={String(pendingCount)} />
        <StatCard label="Pending Payout Value" value={fmtKES(pendingTotal)} />
      </div>

      {/* Status tabs */}
      <Tabs label="Withdrawal status" value={tab} onChange={setTab} tabs={TABS.map(t => ({ value: t.k, label: t.label }))} />

      {/* Table */}
      <Card pad={false} className="overflow-hidden">
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="pl-5">Player</Th>
              <Th numeric>Amount</Th>
              <Th className="hidden md:table-cell">Phone</Th>
              <Th numeric className="hidden lg:table-cell">Balance</Th>
              <Th className="hidden sm:table-cell">Risk</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">Requested</Th>
              <Th numeric className="pr-5">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8}><Empty title={`No ${tab === 'all' ? '' : tab + ' '}withdrawals.`} /></td></tr>
            )}
            {rows.map(r => {
              const insufficient = r.wallet_balance != null && Number(r.wallet_balance) < Number(r.amount);
              const score = r.risk_score ?? 0;
              return (
                <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                  <Td className="pl-5">
                    <div className="font-medium text-ink">{r.username}</div>
                    {r.auto_approved && <div className="mt-0.5 text-[12px] text-faint">auto-approve eligible</div>}
                  </Td>
                  <Td numeric className="font-semibold text-ink">{fmtKES(Number(r.amount))}</Td>
                  <Td className="hidden md:table-cell"><span className="font-mono text-[12px] text-muted">{r.phone_number}</span></Td>
                  <Td numeric className="hidden lg:table-cell">
                    <span className={insufficient ? 'text-down font-medium' : 'text-muted'}>{r.wallet_balance != null ? fmtKES(Number(r.wallet_balance)) : '-'}</span>
                    {insufficient && <div className="text-[12px] text-down">below requested</div>}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <span className="tabular-nums"><Badge tone={riskTone(score)}>{score}</Badge></span>
                  </Td>
                  <Td>
                    <span className="capitalize"><Badge tone={statusTone(r.status)}>{r.status}</Badge></span>
                    {r.status === 'rejected' && r.rejection_reason && (
                      <div className="mt-0.5 max-w-[200px] truncate text-[12px] text-faint" title={r.rejection_reason}>{r.rejection_reason}</div>
                    )}
                  </Td>
                  <Td className="hidden lg:table-cell whitespace-nowrap text-muted" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at)}</Td>
                  <Td className="pr-5 text-right whitespace-nowrap">
                    {r.status === 'pending' ? (
                      <div className="inline-flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => { setErr(null); setConfirm(r); }}
                          loading={busyId === r.id}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => { setErr(null); setRejectReason(''); setRejectRow(r); }}
                          disabled={busyId === r.id}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[12px] text-faint">
                        {r.reviewer_username ? 'by ' + r.reviewer_username : '-'}
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Approve confirmation */}
      {confirm && (
        <Modal
          title="Approve withdrawal"
          onClose={closeConfirm}
          width={400}
          footer={<>
            <Button onClick={() => setConfirm(null)} disabled={busyId === confirm.id}>Cancel</Button>
            <Button variant="primary" onClick={() => doApprove(confirm)} loading={busyId === confirm.id}>Approve & Pay</Button>
          </>}
        >
          <p className="text-[13px] leading-relaxed text-muted">
            Pay <span className="font-semibold text-ink tabular-nums">{fmtKES(Number(confirm.amount))}</span> to <span className="font-semibold text-ink">{confirm.username}</span> at <span className="font-mono text-[12px]">{confirm.phone_number}</span> via M-Pesa. This debits the player's wallet and cannot be undone once Safaricom confirms.
          </p>
          {confirm.wallet_balance != null && Number(confirm.wallet_balance) < Number(confirm.amount) && (
            <p className="rounded-xl bg-down/15 px-4 py-2.5 text-[13px] text-down">
              Warning: player balance ({fmtKES(Number(confirm.wallet_balance))}) is below the requested amount. The payout will be aborted by the server.
            </p>
          )}
        </Modal>
      )}

      {/* Reject with required reason */}
      {rejectRow && (
        <Modal
          title="Reject withdrawal"
          onClose={closeReject}
          width={400}
          footer={<>
            <Button onClick={() => setRejectRow(null)} disabled={busyId === rejectRow.id}>Cancel</Button>
            <Button variant="danger" onClick={() => doReject(rejectRow, rejectReason)} disabled={!rejectReason.trim()} loading={busyId === rejectRow.id}>Reject</Button>
          </>}
        >
          <p className="text-[13px] leading-relaxed text-muted">
            Reject <span className="font-semibold text-ink tabular-nums">{fmtKES(Number(rejectRow.amount))}</span> for <span className="font-semibold text-ink">{rejectRow.username}</span>. No funds move (the request never debited the wallet). A reason is required and recorded.
          </p>
          <textarea
            ref={rejectRef}
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            autoFocus
            rows={3}
            placeholder="Reason for rejection (required)…"
            className="w-full resize-none rounded-lg bg-raised px-3 py-2.5 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
          />
        </Modal>
      )}
    </div>
  );
}
