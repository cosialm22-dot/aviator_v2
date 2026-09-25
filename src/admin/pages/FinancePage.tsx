import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { DonutChart, CompareBars } from '../components/charts';
import { Badge, Button, Card, Empty, ErrorState, Modal, PageHeader, Pills, SearchInput, Select, Skeleton, StatCard, TableWrap, Td, Th, inputCls } from '../ui/kit';

// ============================================================================
// FinancePage - admin financial reconciliation, ledger and M-Pesa drill-down
// ----------------------------------------------------------------------------
// Under the Phase-1 security lockdown the `transactions` table is admin-
// unreadable directly (only "read own" RLS), so EVERY read here goes through
// SECURITY DEFINER RPCs that self-check _is_admin():
//   - admin_finance_summary(from,to)      -> deposits vs withdrawals reconciliation
//   - admin_list_transactions(...)         -> filtered, paginated admin-wide ledger
//   - admin_get_mpesa_detail(txn_id)       -> STK/B2C record + raw Daraja payload
// Date ranges are half-open [from, to); the upper bound is start-of-next-day so
// the selected end day is fully included.
// ============================================================================

const PAGE_SIZE = 100;
const EXPORT_CAP = 10000; // matches the server-side limit ceiling

type TxType = 'all' | 'deposit' | 'withdrawal' | 'bet' | 'win' | 'adjustment';
type TxStatus = 'all' | 'completed' | 'pending' | 'processing' | 'failed';
type Preset = 'today' | '7d' | '30d' | 'mtd' | 'all' | 'custom';

interface TxRow {
  id: string;
  user_id: string;
  username: string;
  type: string;
  amount: number;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  status: string;
  created_at: string;
  total_count: number;
}

interface Summary {
  deposit_count: number;
  deposit_total: number;
  mpesa_deposit_count: number;
  mpesa_deposit_total: number;
  bonus_deposit_total: number;
  withdrawal_paid_count: number;
  withdrawal_paid_total: number;
  withdrawal_pending_count: number;
  withdrawal_pending_total: number;
  withdrawal_failed_count: number;
  withdrawal_failed_total: number;
  withdrawal_reversed_total: number;
  net_cashflow: number;
  bet_count: number;
  bet_volume: number;
  win_count: number;
  win_total: number;
  ggr: number;
  adjustment_total: number;
}

interface MpesaDetail {
  transaction: Record<string, unknown>;
  kind: 'stk' | 'b2c' | null;
  detail: Record<string, unknown> | null;
  linked: boolean;
}

/** Chart series: Apple system colours (dark), matching the admin up/down/warn/brand/gold tokens. */
/** Date pickers sit next to the 32 px segmented control, so they take its height. */
const DATE_INPUT = inputCls.replace('h-9', 'h-8') + ' tabular-nums [color-scheme:dark]';
const SYS = { green: '#30d158', red: '#ff453a', orange: '#ff9f0a', blue: '#0a84ff', yellow: '#ffd60a', gray: '#8e8e93' };

const TYPE_FILTERS: { value: TxType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
  { value: 'bet', label: 'Bets' },
  { value: 'win', label: 'Wins' },
  { value: 'adjustment', label: 'Adjustments' },
];

const STATUS_FILTERS: { value: TxStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
];

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'mtd', label: 'Month' },
  { value: 'all', label: 'All time' },
];

function fmtKES(n: number): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have admin privileges.',
    NOT_FOUND: 'Record not found - it may have just changed.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}


function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Parse a YYYY-MM-DD string as a LOCAL date (midnight), or null. */
function parseDateInput(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Transaction type → kit Badge tone. */
function typeTone(t: string): string {
  switch (t) {
    case 'deposit': return 'up';
    case 'withdrawal': return 'down';
    case 'win': return 'brand';
    case 'bet': return 'warn';
    default: return 'muted';
  }
}

function statusTone(s: string): { dot: string; text: string } {
  switch (s) {
    case 'completed': return { dot: 'bg-up', text: 'text-up' };
    case 'pending': return { dot: 'bg-warn', text: 'text-warn' };
    case 'processing': return { dot: 'bg-brand', text: 'text-brand' };
    case 'failed': return { dot: 'bg-down', text: 'text-down' };
    default: return { dot: 'bg-faint', text: 'text-muted' };
  }
}

/** RFC-4180 CSV cell: wrap in quotes when it contains a comma, quote or newline. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function FinancePage() {
  // ---- date range -----------------------------------------------------------
  const [preset, setPreset] = useState<Preset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo<{ fromISO: string | null; toISO: string | null; valid: boolean }>(() => {
    const now = new Date();
    const tomorrow = addDays(startOfDay(now), 1); // exclusive upper bound for "through today"
    switch (preset) {
      case 'today': return { fromISO: startOfDay(now).toISOString(), toISO: tomorrow.toISOString(), valid: true };
      case '7d': return { fromISO: addDays(startOfDay(now), -6).toISOString(), toISO: tomorrow.toISOString(), valid: true };
      case '30d': return { fromISO: addDays(startOfDay(now), -29).toISOString(), toISO: tomorrow.toISOString(), valid: true };
      case 'mtd': return { fromISO: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), toISO: tomorrow.toISOString(), valid: true };
      case 'all': return { fromISO: null, toISO: null, valid: true };
      case 'custom': {
        const f = parseDateInput(customFrom);
        const t = parseDateInput(customTo);
        if (!f || !t || f.getTime() > t.getTime()) return { fromISO: null, toISO: null, valid: false };
        return { fromISO: f.toISOString(), toISO: addDays(t, 1).toISOString(), valid: true };
      }
    }
  }, [preset, customFrom, customTo]);

  // ---- filters --------------------------------------------------------------
  const [typeFilter, setTypeFilter] = useState<TxType>('all');
  const [statusFilter, setStatusFilter] = useState<TxStatus>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Debounce the search box into the applied `search` (which drives fetches).
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // ---- data -----------------------------------------------------------------
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Reset to first page whenever the active query changes.
  useEffect(() => { setPage(0); }, [preset, customFrom, customTo, typeFilter, statusFilter, search]);

  const rpcArgs = useCallback((forExport: boolean) => ({
    p_type: typeFilter === 'all' ? null : typeFilter,
    p_status: statusFilter === 'all' ? null : statusFilter,
    p_from: range.fromISO,
    p_to: range.toISO,
    p_search: search || null,
    p_limit: forExport ? EXPORT_CAP : PAGE_SIZE,
    p_offset: forExport ? 0 : page * PAGE_SIZE,
  }), [typeFilter, statusFilter, range.fromISO, range.toISO, search, page]);

  const fetchSummary = useCallback(async () => {
    if (!range.valid) return;
    setSummaryLoading(true);
    const { data, error } = await supabase.rpc('admin_finance_summary', { p_from: range.fromISO, p_to: range.toISO });
    if (error) { setErr(friendly(error.message)); setSummary(null); }
    else {
      const row = Array.isArray(data) ? data[0] : data;
      setSummary((row ?? null) as Summary | null);
    }
    setSummaryLoading(false);
  }, [range.valid, range.fromISO, range.toISO]);

  const fetchRows = useCallback(async () => {
    if (!range.valid) { setRows([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_list_transactions', rpcArgs(false));
    if (error) { setErr(friendly(error.message)); setRows([]); setTotal(0); }
    else {
      const list = (data ?? []) as TxRow[];
      setRows(list);
      setTotal(list.length > 0 ? Number(list[0].total_count) : 0);
    }
    setLoading(false);
  }, [range.valid, rpcArgs]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Live refresh when transactions change (admins receive changes via the RPC,
  // not the table, so we just re-run the active queries on any txn mutation).
  const refetchRef = useRef<() => void>(() => {});
  useEffect(() => { refetchRef.current = () => { fetchSummary(); fetchRows(); }; }, [fetchSummary, fetchRows]);
  useEffect(() => {
    const channel = supabase
      .channel('admin-finance-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => refetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ---- CSV export -----------------------------------------------------------
  async function exportCsv() {
    if (!range.valid) return;
    setExporting(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc('admin_list_transactions', rpcArgs(true));
      if (error) throw new Error(friendly(error.message));
      const list = (data ?? []) as TxRow[];
      const header = ['Time (ISO)', 'Player', 'Type', 'Amount (KES)', 'Payment Method', 'Reference', 'Status', 'Description'];
      const lines = [header.join(',')];
      for (const r of list) {
        lines.push([
          r.created_at,
          r.username,
          r.type,
          Number(r.amount).toFixed(2),
          r.payment_method ?? '',
          r.reference ?? '',
          r.status,
          r.description ?? '',
        ].map(csvCell).join(','));
      }
      // Prepend a UTF-8 BOM so Excel renders KSh and unicode correctly.
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = (range.fromISO ?? 'all').slice(0, 10) + '_to_' + (range.toISO ? addDays(new Date(range.toISO), -1).toISOString().slice(0, 10) : 'now');
      a.href = url;
      a.download = `transactions_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (list.length >= EXPORT_CAP) {
        setErr(`Export capped at ${EXPORT_CAP.toLocaleString()} rows. Narrow the date range or filters to export the remainder.`);
      }
    } catch (e) {
      setErr(errMsg(e, 'Export failed.'));
    } finally {
      setExporting(false);
    }
  }

  // ---- drill-down -----------------------------------------------------------
  const [detail, setDetail] = useState<MpesaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  async function openDetail(txId: string) {
    setDetail(null);
    setDetailErr(null);
    setDetailLoading(true);
    const { data, error } = await supabase.rpc('admin_get_mpesa_detail', { p_transaction_id: txId });
    if (error) setDetailErr(friendly(error.message));
    else setDetail(data as MpesaDetail);
    setDetailLoading(false);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeLabel = preset === 'all' ? 'all time' : preset === 'custom' ? 'custom range' : (PRESETS.find(p => p.value === preset)?.label ?? '');

  const RECON = summary && [
    { label: 'Deposits (in)', value: summary.deposit_total, tone: 'up', sub: `${summary.deposit_count} txns - M-Pesa ${fmtKES(summary.mpesa_deposit_total)}` },
    { label: 'Withdrawals (out)', value: summary.withdrawal_paid_total, tone: 'down', sub: `${summary.withdrawal_paid_count} paid - ${fmtKES(summary.withdrawal_pending_total)} pending` },
    { label: 'Net cashflow', value: summary.net_cashflow, tone: summary.net_cashflow >= 0 ? 'up' : 'down', sub: 'deposits minus payouts' },
    { label: 'Gross gaming revenue', value: summary.ggr, tone: 'ink', sub: `bets ${fmtKES(summary.bet_volume)} - wins ${fmtKES(summary.win_total)}` },
  ];

  // Stable close handler for the kit Modal (it re-runs its focus effect when onClose changes).
  const closeDetail = useCallback(() => { setDetail(null); setDetailErr(null); }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        subtitle="Reconciliation, transaction ledger and M-Pesa drill-down"
        actions={<>
          <Button onClick={exportCsv} disabled={loading || !range.valid} loading={exporting}>
            {exporting ? 'Exporting' : 'Export CSV'}
          </Button>
          <Button onClick={() => refetchRef.current()} loading={loading}>
            {loading ? 'Refreshing' : 'Refresh'}
          </Button>
        </>}
      />

      {err && <ErrorState message={err} />}

      {/* Date range controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Pills<Preset> label="Date range" items={PRESETS} value={preset} onChange={setPreset} />
        <div className="inline-flex items-center gap-2">
          <span className="w-40">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={e => { setCustomFrom(e.target.value); setPreset('custom'); }}
              aria-label="From date"
              className={DATE_INPUT}
            />
          </span>
          <span className="text-[12px] text-faint">to</span>
          <span className="w-40">
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={e => { setCustomTo(e.target.value); setPreset('custom'); }}
              aria-label="To date"
              className={DATE_INPUT}
            />
          </span>
        </div>
        {!range.valid && <span className="text-[13px] text-down">Select a valid date range (from is after to).</span>}
      </div>

      {/* Reconciliation panel */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Reconciliation - {rangeLabel}</h2>
          {summaryLoading && <span className="text-faint"><Spin /></span>}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {!RECON ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-surface p-4"><Skeleton className="h-3.5 w-24" /><Skeleton className="mt-3 h-7 w-32" /></div>
            ))
          ) : RECON.map(card => (
            <StatCard key={card.label} label={card.label} value={fmtKES(card.value)} sub={card.sub} tone={card.tone} />
          ))}
        </div>
        {summary && (summary.withdrawal_failed_count > 0 || summary.withdrawal_reversed_total > 0 || summary.adjustment_total !== 0) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-surface px-4 py-3 text-[13px] text-muted">
            <span>Failed payouts: <span className="font-medium tabular-nums text-ink">{summary.withdrawal_failed_count} ({fmtKES(summary.withdrawal_failed_total)})</span></span>
            <span>Reversed to players: <span className="font-medium tabular-nums text-ink">{fmtKES(summary.withdrawal_reversed_total)}</span></span>
            <span>Manual adjustments: <span className="font-medium tabular-nums text-ink">{fmtKES(summary.adjustment_total)}</span></span>
          </div>
        )}
      </section>

      {/* Visual breakdown - driven entirely by the already-fetched summary (no extra queries) */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Cashflow composition">
            <p className="mb-5 text-[12px] text-faint">Money in vs money out &middot; {rangeLabel}</p>
            <DonutChart
              data={[
                { label: 'Deposits in', value: summary.deposit_total, color: SYS.green },
                { label: 'Withdrawals out', value: summary.withdrawal_paid_total, color: SYS.red },
              ]}
              centerLabel="Net"
              centerValue={fmtKES(summary.net_cashflow)}
            />
          </Card>

          <Card title="Withdrawal status">
            <p className="mb-5 text-[12px] text-faint">By value across the range</p>
            <DonutChart
              data={[
                { label: 'Paid', value: summary.withdrawal_paid_total, color: SYS.green },
                { label: 'Pending', value: summary.withdrawal_pending_total, color: SYS.orange },
                { label: 'Failed', value: summary.withdrawal_failed_total, color: SYS.red },
                { label: 'Reversed', value: summary.withdrawal_reversed_total, color: SYS.gray },
              ]}
              centerLabel="Requests"
              centerValue={String(summary.withdrawal_paid_count + summary.withdrawal_pending_count + summary.withdrawal_failed_count)}
            />
          </Card>

          <Card title="Volumes">
            <p className="mb-5 text-[12px] text-faint">Headline totals &middot; {rangeLabel}</p>
            <CompareBars
              data={[
                { label: 'Deposits', value: summary.deposit_total, color: SYS.green },
                { label: 'Withdrawals', value: summary.withdrawal_paid_total, color: SYS.red },
                { label: 'Bet volume', value: summary.bet_volume, color: SYS.blue },
                { label: 'GGR', value: summary.ggr, color: SYS.yellow },
              ]}
              valueFormatter={(n) => 'KSh ' + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : Math.round(n).toLocaleString('en-KE'))}
            />
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Pills<TxType> label="Transaction type" items={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
        <Select<TxStatus> label="Status filter" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search player or reference..."
          label="Search transactions"
          className="flex-1 min-w-[180px]"
        />
      </div>

      {/* Ledger */}
      <Card pad={false} className="overflow-hidden">
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="pl-5">Player</Th>
              <Th>Type</Th>
              <Th numeric>Amount</Th>
              <Th className="hidden md:table-cell">Method</Th>
              <Th className="hidden lg:table-cell">Reference</Th>
              <Th>Status</Th>
              <Th className="hidden sm:table-cell">Time</Th>
              <Th numeric className="pr-5">Detail</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i}><td colSpan={8} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={8}><Empty title="No transactions match these filters." /></td></tr>
            ) : rows.map(tx => {
              const st = statusTone(tx.status);
              const mpesa = tx.payment_method === 'mpesa' && !!tx.reference && (tx.type === 'deposit' || tx.type === 'withdrawal');
              return (
                <tr key={tx.id} className="transition-colors hover:bg-white/[0.03]">
                  <Td className="pl-5 font-medium text-ink">{tx.username ?? 'Unknown'}</Td>
                  <Td>
                    <span className="capitalize"><Badge tone={typeTone(tx.type)}>{tx.type}</Badge></span>
                  </Td>
                  <Td numeric>
                    <span className={Number(tx.amount) >= 0 ? 'text-up' : 'text-down'}>
                      {Number(tx.amount) >= 0 ? '+' : '-'}{fmtKES(Math.abs(Number(tx.amount)))}
                    </span>
                  </Td>
                  <Td className="hidden md:table-cell text-muted">{tx.payment_method ?? '-'}</Td>
                  <Td className="hidden lg:table-cell max-w-[160px] truncate" title={tx.reference ?? ''}><span className="font-mono text-[12px] text-muted">{tx.reference ?? '-'}</span></Td>
                  <Td>
                    <span className={'inline-flex items-center gap-1.5 text-[12px] font-medium capitalize ' + st.text}>
                      <span className={'h-1.5 w-1.5 rounded-full ' + st.dot} />{tx.status}
                    </span>
                  </Td>
                  <Td className="hidden sm:table-cell whitespace-nowrap tabular-nums text-muted" title={new Date(tx.created_at).toLocaleString()}>{new Date(tx.created_at).toLocaleString()}</Td>
                  <Td className="pr-5 text-right">
                    {mpesa ? (
                      <Button size="sm" onClick={() => openDetail(tx.id)}>M-Pesa</Button>
                    ) : <span className="text-[12px] text-faint">-</span>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-muted">
          <span className="tabular-nums">
            {total === 0 ? 'No results' : `${(page * PAGE_SIZE) + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
          </span>
          <div className="inline-flex items-center gap-2">
            <Button size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}>Previous</Button>
            <span className="tabular-nums">{page + 1} / {pageCount}</span>
            <Button size="sm" onClick={() => setPage(p => (p + 1 < pageCount ? p + 1 : p))} disabled={page + 1 >= pageCount || loading}>Next</Button>
          </div>
        </div>
      </Card>

      {/* M-Pesa drill-down modal */}
      {(detailLoading || detail || detailErr) && (
        <Modal title="M-Pesa transaction detail" onClose={closeDetail} width={512}>
          {detailLoading && <div className="flex items-center gap-2 text-[13px] text-muted"><Spin />Loading...</div>}
          {detailErr && <div className="rounded-xl bg-down/15 px-4 py-2.5 text-[13px] text-down">{detailErr}</div>}
          {detail && !detail.linked && (
            <p className="text-[13px] text-muted">No linked M-Pesa record was found for this transaction. Reversals and bonus credits carry no Daraja reference.</p>
          )}
          {detail && detail.linked && detail.detail && (
            <DetailBody kind={detail.kind} d={detail.detail} />
          )}
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  const s = value == null || value === '' ? '-' : String(value);
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={'break-all text-right text-ink ' + (mono ? 'font-mono text-[12px]' : 'text-[13px]')}>{s}</span>
    </div>
  );
}

function DetailBody({ kind, d }: { kind: 'stk' | 'b2c' | null; d: Record<string, unknown> }) {
  const amount = d.amount != null ? fmtKES(Number(d.amount)) : '-';
  return (
    <div className="space-y-4">
      <Badge tone="brand">{kind === 'stk' ? 'STK deposit' : 'B2C payout'}</Badge>
      <div className="divide-y divide-line rounded-xl bg-raised/60 px-4">
        <Field label="Status" value={d.status} />
        <Field label="Amount" value={amount} />
        <Field label="Phone" value={d.phone_number} mono />
        <Field label="M-Pesa receipt" value={d.mpesa_receipt_number} mono />
        {kind === 'stk'
          ? <><Field label="Checkout request ID" value={d.checkout_request_id} mono /><Field label="Merchant request ID" value={d.merchant_request_id} mono /></>
          : <><Field label="Conversation ID" value={d.conversation_id} mono /><Field label="Originator ID" value={d.originator_conversation_id} mono /></>}
        <Field label="Result code" value={d.result_code} />
        <Field label="Result desc" value={d.result_desc} />
        <Field label="Created" value={d.created_at ? new Date(String(d.created_at)).toLocaleString() : '-'} />
        <Field label="Completed" value={d.completed_at ? new Date(String(d.completed_at)).toLocaleString() : '-'} />
      </div>
      {d.callback_payload != null && (
        <details className="rounded-xl bg-raised/60">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] font-medium text-muted">Raw Daraja callback payload</summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-4 pb-4 font-mono text-[12px] text-ink">{JSON.stringify(d.callback_payload, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
