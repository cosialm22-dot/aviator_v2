import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';

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

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

function fmtKES(n: number): string {
  return 'KSh ' + Math.round(n).toLocaleString('en-KE');
}

function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
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

function Spin() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />;
}

function statusBadge(s: string): string {
  switch (s) {
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'processing': return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'completed': return 'bg-emerald-50 text-up border-emerald-200';
    case 'failed': return 'bg-rose-50 text-down border-rose-200';
    case 'rejected': return 'bg-slate-100 text-muted border-line';
    default: return 'bg-slate-100 text-muted border-line';
  }
}

function riskBadge(score: number): string {
  if (score >= 70) return 'bg-rose-50 text-down border-rose-200';
  if (score >= 30) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-muted border-line';
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Withdrawals</h1>
          <p className="text-[13px] text-muted mt-1">Review, approve and reject player payouts</p>
        </div>
        <div className="flex items-center gap-3">
          {notice && <span role="status" className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-up text-[12px] max-w-[360px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[360px] truncate" title={err}>{err}</span>}
          <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50">
            {loading && <Spin />}{loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className={HEAD}>Pending Requests</div>
          <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{pendingCount}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className={HEAD}>Pending Payout Value</div>
          <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{fmtKES(pendingTotal)}</div>
        </div>
      </div>

      {/* Status tabs */}
      <div className="inline-flex gap-1 bg-slate-100 border border-line rounded-lg p-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            aria-current={tab === t.k ? 'page' : undefined}
            className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (tab === t.k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
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
                <th className="px-5 py-3 font-medium text-muted text-[12px]">Player</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right">Amount</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden md:table-cell">Phone</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right hidden lg:table-cell">Balance</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden sm:table-cell">Risk</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px]">Status</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] hidden lg:table-cell">Requested</th>
                <th className="px-5 py-3 font-medium text-muted text-[12px] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-faint text-sm">No {tab === 'all' ? '' : tab + ' '}withdrawals.</td></tr>
              )}
              {rows.map(r => {
                const insufficient = r.wallet_balance != null && Number(r.wallet_balance) < Number(r.amount);
                const score = r.risk_score ?? 0;
                return (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="text-ink font-medium">{r.username}</div>
                      {r.auto_approved && <div className="text-[11px] text-muted mt-0.5">auto-approve eligible</div>}
                    </td>
                    <td className="px-5 py-3 text-right text-ink font-semibold tabular-nums">{fmtKES(Number(r.amount))}</td>
                    <td className="px-5 py-3 text-muted font-mono text-[13px] hidden md:table-cell">{r.phone_number}</td>
                    <td className="px-5 py-3 text-right tabular-nums hidden lg:table-cell">
                      <span className={insufficient ? 'text-down font-medium' : 'text-muted'}>{r.wallet_balance != null ? fmtKES(Number(r.wallet_balance)) : '-'}</span>
                      {insufficient && <div className="text-[11px] text-down">below requested</div>}
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell">
                      <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold ' + riskBadge(score)}>{score}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ' + statusBadge(r.status)}>{r.status}</span>
                      {r.status === 'rejected' && r.rejection_reason && (
                        <div className="text-[11px] text-muted mt-0.5 max-w-[200px] truncate" title={r.rejection_reason}>{r.rejection_reason}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {r.status === 'pending' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => { setErr(null); setConfirm(r); }}
                            disabled={busyId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-semibold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            {busyId === r.id && <Spin />}Approve
                          </button>
                          <button
                            onClick={() => { setErr(null); setRejectReason(''); setRejectRow(r); }}
                            disabled={busyId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-muted hover:text-down hover:border-down/40 text-[12px] font-semibold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-down/30"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-faint text-[12px]">
                          {r.reviewer_username ? 'by ' + r.reviewer_username : '-'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve confirmation */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busyId ? null : setConfirm(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Approve withdrawal</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">
              Pay <span className="font-semibold text-ink">{fmtKES(Number(confirm.amount))}</span> to <span className="font-semibold text-ink">{confirm.username}</span> at <span className="font-mono">{confirm.phone_number}</span> via M-Pesa. This debits the player's wallet and cannot be undone once Safaricom confirms.
            </p>
            {confirm.wallet_balance != null && Number(confirm.wallet_balance) < Number(confirm.amount) && (
              <p className="mt-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px]">
                Warning: player balance ({fmtKES(Number(confirm.wallet_balance))}) is below the requested amount. The payout will be aborted by the server.
              </p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setConfirm(null)} disabled={busyId === confirm.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => doApprove(confirm)} disabled={busyId === confirm.id} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">
                {busyId === confirm.id && <Spin />}Approve & Pay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject with required reason */}
      {rejectRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busyId ? null : setRejectRow(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Reject withdrawal</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">
              Reject <span className="font-semibold text-ink">{fmtKES(Number(rejectRow.amount))}</span> for <span className="font-semibold text-ink">{rejectRow.username}</span>. No funds move (the request never debited the wallet). A reason is required and recorded.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Reason for rejection (required)…"
              className="mt-4 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-down/30 focus:border-down/40 resize-none transition"
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRejectRow(null)} disabled={busyId === rejectRow.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => doReject(rejectRow, rejectReason)} disabled={busyId === rejectRow.id || !rejectReason.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-down hover:brightness-95">
                {busyId === rejectRow.id && <Spin />}Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
