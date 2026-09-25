import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Hand, Send, Zap } from 'lucide-react';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, Empty, ErrorState, Modal, Notice, PageHeader, StatCard, TableWrap, Tabs, Td, Th, inputCls } from '../ui/kit';
import { dateTime, relTime } from '../ui/format';
import { useScope } from '../scopeContext';
import { useAdmin } from '../roleContext';

// ============================================================================
// Withdrawals — the cashier queue (migration 20260930097000).
//   request  → the player's money is HELD at once; small low-risk requests are approved on the spot
//   approve  → paid automatically by M-Pesa B2C when the brand's payment owner has a tested B2C
//              account ("Automatic"), otherwise staff pay by hand and record the receipt ("By hand")
//   needs attention → a payout Safaricom did not complete, or never answered: money still held;
//              staff retry, mark paid (with the receipt) or refund
// Every action is a SECURITY DEFINER RPC that re-checks the role, the brand and the state.
// ============================================================================

interface Attempt { id: string; status: string; result_code: string | null; result_desc: string | null; response_desc: string | null; created_at: string; transaction_id: string | null }
interface Row {
  id: string; user_id: string; username: string; phone_number: string; amount: number; status: string; auto_approved: boolean;
  risk_score: number | null; risk_flags: unknown; rejection_reason: string | null; review_note: string | null; reviewer_username: string | null;
  reviewed_at: string | null; created_at: string; completed_at: string | null; mpesa_receipt: string | null; wallet_balance: number | null;
  total_deposited: number | null; total_withdrawn: number | null; total_wagered: number | null; total_won: number | null;
  site_id: string; site_name: string | null; rail: 'mpesa_b2c' | 'manual' | null; approved_at: string | null; attempts: number;
  attention_reason: string | null; recipient_name: string | null; paid_manually: boolean; release_requested: boolean;
  outcome_unknown: boolean; last_attempt: Attempt | null;
}
interface PayoutStatus {
  rail: 'mpesa_b2c' | 'manual'; auto: boolean; reason: string | null; scope: string; payouts_enabled: boolean; brand_auto_payout: boolean;
  auto_approve_below: number | null; auto_daily_budget: number | null;
  account: { shortcode: string; env: string; test_ok: boolean | null; test_message: string | null; tested_at: string | null } | null;
  counts: { pending: number; approved: number; processing: number; needs_attention: number; paid_today: number; paid_today_kes: number; held_kes: number; alerts: number };
}
interface Detail extends Record<string, unknown> {
  attempts_list: (Attempt & { conversation_id: string | null; recipient_name: string | null; status_queries: number; sent_at: string | null; resolved_at: string | null; amount: number })[];
  audit: { action: string; at: string; by: string | null; details: Record<string, unknown> }[];
}

type Tab = 'pending' | 'needs_attention' | 'approved' | 'processing' | 'completed' | 'closed' | 'all';
const TABS: { k: Tab; label: string }[] = [
  { k: 'pending', label: 'Needs review' }, { k: 'needs_attention', label: 'Needs attention' }, { k: 'approved', label: 'To pay' },
  { k: 'processing', label: 'Sending' }, { k: 'completed', label: 'Paid' }, { k: 'closed', label: 'Declined & returned' }, { k: 'all', label: 'All' },
];
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Needs review', tone: 'warn' }, approved: { label: 'Approved', tone: 'brand' }, processing: { label: 'Sending', tone: 'brand' },
  needs_attention: { label: 'Needs attention', tone: 'down' }, completed: { label: 'Paid', tone: 'up' }, rejected: { label: 'Declined', tone: 'muted' },
  failed: { label: 'Not paid · returned', tone: 'muted' }, cancelled: { label: 'Cancelled by player', tone: 'muted' },
};
const fmtKES = (n: number) => 'KSh ' + Math.round(Number(n)).toLocaleString('en-KE');

/** Map backend error codes to plain words for staff. */
function friendly(msg: string): string {
  const [code, ...rest] = msg.split(':');
  const tail = rest.join(':').trim();
  const map: Record<string, string> = {
    FORBIDDEN: 'Your role cannot do this.', FORBIDDEN_SITE: 'This withdrawal belongs to a brand outside your scope.',
    NOT_FOUND: 'Withdrawal not found: it may have just changed. Refresh.', NOT_PENDING: 'This withdrawal is no longer waiting for review. Refresh.',
    NOT_APPROVED: 'Only an approved withdrawal can be sent.', NOT_IN_ATTENTION: 'Only a withdrawal that needs attention can be retried.',
    REASON_REQUIRED: 'A reason is required.', PAYOUTS_PAUSED: 'Automatic payouts are paused by the System (Controls).',
    CANNOT_MARK_PAID: 'This withdrawal cannot be marked paid now.', CANNOT_REFUND: 'This withdrawal cannot be refunded now.',
  };
  if (['OUTCOME_UNKNOWN', 'INVALID_RECEIPT', 'RECEIPT_USED', 'NO_PAYOUT_ACCOUNT'].includes(code.trim())) return tail.endsWith('.') ? tail : tail + '.';
  return map[code.trim()] ?? (msg || 'Action failed. Please try again.');
}
const riskTone = (s: number) => (s >= 70 ? 'down' : s >= 30 ? 'warn' : 'muted');

export default function WithdrawalsPage() {
  const scope = useScope();
  const me = useAdmin();
  const site = scope.siteId ?? null;
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<Row[]>([]);
  const [ps, setPs] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject' | 'paid' | 'refund' | 'retry'; row: Row } | null>(null);
  const [text, setText] = useState('');
  const [confirmUnpaid, setConfirmUnpaid] = useState(false);
  const [detail, setDetail] = useState<{ row: Row; d: Detail | null } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setErr(null);
    const status = tab === 'all' ? null : tab;
    const [list, stat] = await Promise.all([
      supabase.rpc('admin_list_withdrawals', { p_status: status, p_limit: 200, p_offset: 0 }),
      supabase.rpc('admin_payout_status', { p_site: site }),
    ]);
    if (list.error) { setErr(friendly(list.error.message)); setRows([]); } else setRows((list.data ?? []) as Row[]);
    if (!stat.error) setPs(stat.data as PayoutStatus);
    setLoading(false);
  }, [tab, site]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const fetchRef = useRef(fetchAll);
  useEffect(() => { fetchRef.current = fetchAll; }, [fetchAll]);
  useEffect(() => {
    const ch = supabase.channel('admin-withdrawals-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'withdrawal_requests' }, (payload) => {
        const amt = Number((payload.new as { amount?: number })?.amount ?? 0);
        setNotice('New withdrawal request' + (amt ? ': ' + fmtKES(amt) : '') + '.');
        void fetchRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'withdrawal_requests' }, () => { void fetchRef.current(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const act = async (row: Row, fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: string) => {
    setBusyId(row.id); setErr(null); setNotice(null);
    try {
      const { error } = await fn();
      if (error) throw new Error(friendly(error.message));
      setNotice(ok); setDialog(null); setText(''); setConfirmUnpaid(false);
      await fetchAll();
    } catch (e) { setErr(errMsg(e, 'Action failed.')); } finally { setBusyId(null); }
  };
  const openDetail = async (row: Row) => {
    setDetail({ row, d: null });
    const { data, error } = await supabase.rpc('admin_withdrawal_detail', { p_id: row.id });
    if (error) { setErr(friendly(error.message)); setDetail(null); return; }
    setDetail({ row, d: data as Detail });
  };
  const closeDialog = useCallback(() => { if (!busyId) { setDialog(null); setText(''); setConfirmUnpaid(false); } }, [busyId]);
  const c = ps?.counts;

  return (
    <div className="space-y-6">
      <PageHeader title="Withdrawals" subtitle="Review, pay and follow up player withdrawals"
        actions={<Button onClick={fetchAll} loading={loading}>{loading ? 'Refreshing' : 'Refresh'}</Button>} />

      {notice && <Notice tone="ok" onClose={() => setNotice(null)}>{notice}</Notice>}
      {err && <ErrorState message={err} />}
      {c && c.alerts > 0 && (
        <Notice tone="error"><span data-testid="payout-alerts"><AlertTriangle size={14} className="mr-1 inline" />{c.alerts} withdrawal{c.alerts === 1 ? ' was' : 's were'} paid by Safaricom after being closed as unpaid. Open it in Needs attention or Paid and recover the money.</span></Notice>
      )}

      {ps && (
        <Card title="How withdrawals are paid" testId="payout-rail">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {ps.rail === 'mpesa_b2c'
              ? <Badge tone={ps.auto ? 'up' : 'warn'}><Zap size={11} />{ps.auto ? 'Automatic M-Pesa payouts' : 'M-Pesa payouts on Pay'}</Badge>
              : <Badge tone="muted"><Hand size={11} />Paid by hand</Badge>}
            <span className="text-muted">
              {ps.rail === 'mpesa_b2c'
                ? <>From B2C shortcode <span className="font-mono text-ink">{ps.account?.shortcode}</span>{ps.account?.env === 'sandbox' ? ' (sandbox)' : ''}{ps.reason ? ` · ${ps.reason}` : ''}.</>
                : <>{ps.reason}. Staff send the money from M-Pesa and record the receipt here.{' '}
                    {(me.isPlatform || me.role === 'platform_admin') && <Link to={site ? `/admin/brands/${site}?tab=payments` : '/admin/payment-accounts'} className="underline">Set up M-Pesa payouts</Link>}</>}
            </span>
          </div>
          <p className="mt-2 text-[12px] text-faint">
            Requests up to {ps.auto_approve_below != null ? fmtKES(ps.auto_approve_below) : '—'} from low-risk players are approved automatically
            {ps.auto_daily_budget != null ? `, up to ${fmtKES(ps.auto_daily_budget)} a day` : ''}. The rest wait here for review. The requested amount is held from the player's balance until it is paid or returned.
          </p>
          {!ps.payouts_enabled && <p className="mt-2 text-[12px] text-warn">Automatic payouts are paused for every brand (Controls).</p>}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Needs review" value={String(c?.pending ?? '—')} testId="kpi-review" />
        <StatCard label="Needs attention" value={String(c?.needs_attention ?? '—')} tone={c && c.needs_attention > 0 ? 'down' : 'ink'} testId="kpi-attention" />
        <StatCard label="To pay / sending" value={c ? `${c.approved} / ${c.processing}` : '—'} />
        <StatCard label="Paid today" value={c ? fmtKES(c.paid_today_kes) : '—'} sub={c ? `${c.paid_today} payout${c.paid_today === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Held for withdrawals" value={c ? fmtKES(c.held_kes) : '—'} />
      </div>

      <Tabs label="Withdrawal status" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t.k, label: t.label }))} />

      <Card pad={false} className="overflow-hidden">
        <TableWrap minWidth={0} testId="withdrawals-table">
          <thead>
            <tr>
              <Th className="pl-5">Player</Th>
              <Th numeric>Amount</Th>
              <Th className="hidden lg:table-cell">Phone</Th>
              <Th className="hidden sm:table-cell">Risk</Th>
              <Th>Status</Th>
              <Th className="hidden xl:table-cell">Requested</Th>
              <Th numeric className="pr-5">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loading && rows.length === 0 && <tr><td colSpan={7}><Empty title="Nothing here." /></td></tr>}
            {rows.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: 'muted' };
              const score = r.risk_score ?? 0;
              const busy = busyId === r.id;
              return (
                <tr key={r.id} className="cursor-pointer transition-colors hover:bg-white/[0.03]" data-testid={`wd-${r.id}`} onClick={() => void openDetail(r)}>
                  <Td className="pl-5">
                    <div className="font-medium text-ink">{r.username}</div>
                    <div className="mt-0.5 text-[12px] text-faint">{[me.isPlatform && !site ? r.site_name : null, r.auto_approved ? 'approved automatically' : null].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td numeric className="font-semibold text-ink">{fmtKES(r.amount)}</Td>
                  <Td className="hidden lg:table-cell"><span className="font-mono text-[12px] text-muted">{r.phone_number}</span></Td>
                  <Td className="hidden sm:table-cell"><Badge tone={riskTone(score)}>{score}</Badge></Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {r.rail && ['approved', 'processing', 'needs_attention'].includes(r.status) && <Badge>{r.rail === 'manual' ? 'By hand' : 'M-Pesa'}</Badge>}
                    </div>
                    {r.status === 'completed' && r.mpesa_receipt && <div className="mt-0.5 font-mono text-[12px] text-faint">{r.mpesa_receipt}{r.paid_manually ? ' · by hand' : ''}</div>}
                    {(r.attention_reason || (['rejected', 'failed'].includes(r.status) && r.rejection_reason)) && (
                      <div className={`mt-0.5 max-w-[280px] truncate text-[12px] ${r.attention_reason?.startsWith('ALERT') ? 'text-down' : 'text-faint'}`} title={r.attention_reason ?? r.rejection_reason ?? ''} data-testid={`reason-${r.id}`}>{r.attention_reason ?? r.rejection_reason}</div>
                    )}
                  </Td>
                  <Td className="hidden xl:table-cell whitespace-nowrap text-muted" title={dateTime(r.created_at)}>{relTime(r.created_at)}</Td>
                  <Td className="pr-5 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'pending' && <>
                        <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'approve', row: r })} loading={busy} data-testid={`approve-${r.id}`}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', row: r })} disabled={busy}>Decline</Button>
                      </>}
                      {r.status === 'approved' && r.rail === 'mpesa_b2c' && !r.release_requested &&
                        <Button size="sm" variant="primary" loading={busy} data-testid={`paynow-${r.id}`}
                          onClick={() => void act(r, () => supabase.rpc('admin_withdrawal_pay_now', { p_id: r.id }), `Sending ${fmtKES(r.amount)} to ${r.username}.`)}><Send size={13} />Pay now</Button>}
                      {r.status === 'approved' && r.rail === 'mpesa_b2c' && r.release_requested && <span className="text-[12px] text-faint">Queued for M-Pesa</span>}
                      {r.status === 'approved' && (r.rail === 'manual' || !r.release_requested) &&
                        <Button size="sm" variant={r.rail === 'manual' ? 'primary' : 'default'} onClick={() => setDialog({ kind: 'paid', row: r })} data-testid={`markpaid-${r.id}`}><Banknote size={13} />Mark paid</Button>}
                      {r.status === 'approved' && <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', row: r })} disabled={busy}>Decline</Button>}
                      {r.status === 'processing' && <span className="text-[12px] text-faint">Waiting for M-Pesa</span>}
                      {r.status === 'needs_attention' && <>
                        {r.rail === 'mpesa_b2c' && <Button size="sm" onClick={() => setDialog({ kind: 'retry', row: r })} data-testid={`retry-${r.id}`}>Retry</Button>}
                        <Button size="sm" onClick={() => setDialog({ kind: 'paid', row: r })} data-testid={`markpaid-${r.id}`}>Mark paid</Button>
                        <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'refund', row: r })} data-testid={`refund-${r.id}`}>Return money</Button>
                      </>}
                      {['completed', 'rejected', 'failed', 'cancelled'].includes(r.status) && <span className="text-[12px] text-faint">{r.reviewer_username ? 'by ' + r.reviewer_username : ''}</span>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {dialog && <ActionDialog dialog={dialog} ps={ps} text={text} setText={setText} confirmUnpaid={confirmUnpaid} setConfirmUnpaid={setConfirmUnpaid}
        busy={busyId === dialog.row.id} onClose={closeDialog}
        onGo={() => {
          const r = dialog.row;
          switch (dialog.kind) {
            case 'approve': return void act(r, () => supabase.rpc('admin_approve_withdrawal', { p_id: r.id, p_note: text || null }),
              r.rail === 'manual' || ps?.rail === 'manual' ? `Approved. Pay ${fmtKES(r.amount)} to ${r.phone_number} and record the receipt.` : `Approved. ${fmtKES(r.amount)} is being sent to ${r.username}.`);
            case 'reject': return void act(r, () => supabase.rpc('admin_reject_withdrawal', { p_id: r.id, p_reason: text }), `Declined. ${fmtKES(r.amount)} is back in ${r.username}'s wallet.`);
            case 'paid': return void act(r, () => supabase.rpc('admin_withdrawal_mark_paid', { p_id: r.id, p_receipt: text, p_note: null }), `Recorded as paid (${text.toUpperCase()}).`);
            case 'refund': return void act(r, () => supabase.rpc('admin_withdrawal_refund', { p_id: r.id, p_reason: text, p_confirm_unpaid: confirmUnpaid }), `${fmtKES(r.amount)} returned to ${r.username}'s wallet.`);
            case 'retry': return void act(r, () => supabase.rpc('admin_withdrawal_retry', { p_id: r.id, p_confirm_unpaid: confirmUnpaid }), `Sending ${fmtKES(r.amount)} again.`);
          }
        }} />}

      {detail && <DetailModal row={detail.row} d={detail.d} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ActionDialog({ dialog, ps, text, setText, confirmUnpaid, setConfirmUnpaid, busy, onClose, onGo }: {
  dialog: { kind: 'approve' | 'reject' | 'paid' | 'refund' | 'retry'; row: Row }; ps: PayoutStatus | null; text: string; setText: (v: string) => void;
  confirmUnpaid: boolean; setConfirmUnpaid: (v: boolean) => void; busy: boolean; onClose: () => void; onGo: () => void;
}) {
  const r = dialog.row;
  const needsConfirm = (dialog.kind === 'refund' || dialog.kind === 'retry') && r.outcome_unknown;
  const t = {
    approve: { title: 'Approve withdrawal', go: 'Approve', tone: 'primary' as const, input: 'Note (optional)', req: false },
    reject: { title: 'Decline withdrawal', go: 'Decline', tone: 'danger' as const, input: 'Reason the player will see (required)', req: true },
    paid: { title: 'Record a payment made by hand', go: 'Mark paid', tone: 'primary' as const, input: 'M-Pesa receipt, e.g. SIK2AB3CD4', req: true },
    refund: { title: 'Return the money to the player', go: 'Return money', tone: 'danger' as const, input: 'Reason the player will see (required)', req: true },
    retry: { title: 'Send the payout again', go: 'Send again', tone: 'primary' as const, input: '', req: false },
  }[dialog.kind];
  const auto = ps?.rail === 'mpesa_b2c';
  return (
    <Modal title={t.title} onClose={onClose} width={440}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={t.tone} onClick={onGo} loading={busy} disabled={(t.req && !text.trim()) || (needsConfirm && !confirmUnpaid)} data-testid="wd-dialog-go">{t.go}</Button>
      </>}>
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-semibold text-ink tabular-nums">{fmtKES(r.amount)}</span> for <span className="font-semibold text-ink">{r.username}</span> to <span className="font-mono text-[12px]">{r.phone_number}</span>.{' '}
        {dialog.kind === 'approve' && (auto ? (ps?.auto ? 'It will be sent by M-Pesa straight away.' : 'Press Pay afterwards to send it by M-Pesa.') : 'You will send it from M-Pesa yourself, then record the receipt.')}
        {dialog.kind === 'reject' && 'The held amount goes back to the player\'s wallet.'}
        {dialog.kind === 'paid' && 'Only do this after the money has left your M-Pesa account. The receipt is checked for reuse.'}
        {dialog.kind === 'refund' && 'The held amount goes back to the player\'s wallet and they are told why.'}
        {dialog.kind === 'retry' && 'A new M-Pesa payout request is sent.'}
      </p>
      {r.attention_reason && <p className="rounded-xl bg-raised px-3 py-2 text-[12px] text-muted">{r.attention_reason}</p>}
      {needsConfirm && (
        <label className="flex items-start gap-2 rounded-xl bg-down/10 px-3 py-2.5 text-[12px] text-down">
          <input type="checkbox" checked={confirmUnpaid} onChange={(e) => setConfirmUnpaid(e.target.checked)} className="mt-0.5" data-testid="wd-confirm-unpaid" />
          Safaricom never confirmed the last attempt, so it may have been paid. I checked the M-Pesa statement and it was NOT paid.
        </label>
      )}
      {t.input && (dialog.kind === 'paid'
        ? <input value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder={t.input} className={`${inputCls} font-mono`} maxLength={12} autoFocus data-testid="wd-dialog-input" />
        : <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t.input} autoFocus data-testid="wd-dialog-input"
            className="w-full resize-none rounded-lg bg-raised px-3 py-2.5 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50" />)}
    </Modal>
  );
}

function DetailModal({ row, d, onClose }: { row: Row; d: Detail | null; onClose: () => void }) {
  return (
    <Modal title={`Withdrawal · ${fmtKES(row.amount)}`} subtitle={`${row.username} · ${row.phone_number}`} onClose={onClose} width={560}>
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div><div className="text-faint">Status</div><div className="text-ink">{STATUS[row.status]?.label ?? row.status}</div></div>
        <div><div className="text-faint">Paid by</div><div className="text-ink">{row.rail === 'manual' ? 'Hand' : row.rail === 'mpesa_b2c' ? 'M-Pesa B2C' : '—'}</div></div>
        <div><div className="text-faint">Requested</div><div className="text-ink">{dateTime(row.created_at)}</div></div>
        <div><div className="text-faint">Receipt</div><div className="font-mono text-ink">{row.mpesa_receipt ?? '—'}</div></div>
        <div><div className="text-faint">Deposited / withdrawn</div><div className="text-ink">{fmtKES(row.total_deposited ?? 0)} / {fmtKES(row.total_withdrawn ?? 0)}</div></div>
        <div><div className="text-faint">Wagered / won</div><div className="text-ink">{fmtKES(row.total_wagered ?? 0)} / {fmtKES(row.total_won ?? 0)}</div></div>
      </div>
      {!d ? <p className="text-[13px] text-faint">Loading…</p> : (
        <>
          <div>
            <div className="mb-1 text-[13px] font-medium text-ink">M-Pesa attempts</div>
            {d.attempts_list.length === 0 ? <p className="text-[12px] text-faint">None.</p> : (
              <ul className="space-y-1.5" data-testid="wd-attempts">
                {d.attempts_list.map((a) => (
                  <li key={a.id} className="rounded-lg bg-raised px-3 py-2 text-[12px]">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{a.status}</span><span className="text-faint">{dateTime(a.created_at)}</span></div>
                    <div className="text-muted">{[a.result_code != null ? `code ${a.result_code}` : null, a.result_desc ?? a.response_desc, a.transaction_id, a.recipient_name, a.status_queries ? `${a.status_queries} status check${a.status_queries === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-[13px] font-medium text-ink">History</div>
            <ul className="space-y-1 text-[12px] text-muted">
              <li>{dateTime(row.created_at)} · requested{row.auto_approved ? ' (approved automatically)' : ''}</li>
              {d.audit.map((x, i) => <li key={i}>{dateTime(x.at)} · {x.action.replace(/^withdrawal_/, '').replace(/_/g, ' ')}{x.by ? ` by ${x.by}` : ''}</li>)}
            </ul>
          </div>
        </>
      )}
    </Modal>
  );
}
