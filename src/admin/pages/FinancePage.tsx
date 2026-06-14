import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { DonutChart, CompareBars } from '../components/charts';

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

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';

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

function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
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

function Spin() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />;
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

function typeBadge(t: string): string {
  switch (t) {
    case 'deposit': return 'bg-emerald-50 text-up';
    case 'withdrawal': return 'bg-rose-50 text-down';
    case 'win': return 'bg-brand/10 text-brand';
    case 'bet': return 'bg-amber-50 text-amber-600';
    case 'adjustment': return 'bg-sky-50 text-sky-700';
    default: return 'bg-slate-100 text-muted';
  }
}

function statusTone(s: string): { dot: string; text: string } {
  switch (s) {
    case 'completed': return { dot: 'bg-up', text: 'text-up' };
    case 'pending': return { dot: 'bg-amber-500', text: 'text-amber-600' };
    case 'processing': return { dot: 'bg-sky-500', text: 'text-sky-600' };
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
    { label: 'Deposits (in)', value: summary.deposit_total, tone: 'text-up', sub: `${summary.deposit_count} txns - M-Pesa ${fmtKES(summary.mpesa_deposit_total)}` },
    { label: 'Withdrawals (out)', value: summary.withdrawal_paid_total, tone: 'text-down', sub: `${summary.withdrawal_paid_count} paid - ${fmtKES(summary.withdrawal_pending_total)} pending` },
    { label: 'Net cashflow', value: summary.net_cashflow, tone: summary.net_cashflow >= 0 ? 'text-up' : 'text-down', sub: 'deposits minus payouts' },
    { label: 'Gross gaming revenue', value: summary.ggr, tone: 'text-ink', sub: `bets ${fmtKES(summary.bet_volume)} - wins ${fmtKES(summary.win_total)}` },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Finance</h1>
          <p className="text-[13px] text-muted mt-1">Reconciliation, transaction ledger and M-Pesa drill-down</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[420px] truncate" title={err}>{err}</span>}
          <button
            onClick={exportCsv}
            disabled={exporting || loading || !range.valid}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50"
          >
            {exporting && <Spin />}{exporting ? 'Exporting' : 'Export CSV'}
          </button>
          <button
            onClick={() => refetchRef.current()}
            disabled={loading}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50"
          >
            {loading && <Spin />}{loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Date range controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex gap-1 bg-slate-100 border border-line rounded-lg p-1 flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              aria-current={preset === p.value ? 'page' : undefined}
              className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (preset === p.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={e => { setCustomFrom(e.target.value); setPreset('custom'); }}
            aria-label="From date"
            className="h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40"
          />
          <span className="text-faint text-xs">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={e => { setCustomTo(e.target.value); setPreset('custom'); }}
            aria-label="To date"
            className="h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40"
          />
        </div>
        {!range.valid && <span className="text-down text-[12px]">Select a valid date range (from is after to).</span>}
      </div>

      {/* Reconciliation panel */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 pt-4 pb-1 flex items-center justify-between">
          <span className={HEAD}>Reconciliation - {rangeLabel}</span>
          {summaryLoading && <Spin />}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line">
          {!RECON ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="p-5 sm:p-6"><div className="h-3 w-24 bg-slate-100 rounded animate-pulse" /><div className="mt-3 h-6 w-32 bg-slate-100 rounded animate-pulse" /></div>
            ))
          ) : RECON.map(card => (
            <div key={card.label} className="p-5 sm:p-6">
              <div className={HEAD}>{card.label}</div>
              <div className={'mt-2.5 text-[22px] leading-none font-semibold tabular-nums tracking-tight ' + card.tone}>{fmtKES(card.value)}</div>
              <div className="mt-2 text-[11px] text-faint">{card.sub}</div>
            </div>
          ))}
        </div>
        {summary && (summary.withdrawal_failed_count > 0 || summary.withdrawal_reversed_total > 0 || summary.adjustment_total !== 0) && (
          <div className="px-5 py-3 border-t border-line flex items-center gap-x-6 gap-y-1 flex-wrap text-[11px] text-muted">
            <span>Failed payouts: <span className="text-ink font-medium tabular-nums">{summary.withdrawal_failed_count} ({fmtKES(summary.withdrawal_failed_total)})</span></span>
            <span>Reversed to players: <span className="text-ink font-medium tabular-nums">{fmtKES(summary.withdrawal_reversed_total)}</span></span>
            <span>Manual adjustments: <span className="text-ink font-medium tabular-nums">{fmtKES(summary.adjustment_total)}</span></span>
          </div>
        )}
      </div>

      {/* Visual breakdown - driven entirely by the already-fetched summary (no extra queries) */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-xl border border-line bg-surface p-6">
            <span className={HEAD}>Cashflow composition</span>
            <p className="text-[12px] text-muted mt-1 mb-5">Money in vs money out &middot; {rangeLabel}</p>
            <DonutChart
              data={[
                { label: 'Deposits in', value: summary.deposit_total, color: '#0ecb81' },
                { label: 'Withdrawals out', value: summary.withdrawal_paid_total, color: '#f6465d' },
              ]}
              centerLabel="Net"
              centerValue={fmtKES(summary.net_cashflow)}
            />
          </div>

          <div className="rounded-xl border border-line bg-surface p-6">
            <span className={HEAD}>Withdrawal status</span>
            <p className="text-[12px] text-muted mt-1 mb-5">By value across the range</p>
            <DonutChart
              data={[
                { label: 'Paid', value: summary.withdrawal_paid_total, color: '#0ecb81' },
                { label: 'Pending', value: summary.withdrawal_pending_total, color: '#e0a80b' },
                { label: 'Failed', value: summary.withdrawal_failed_total, color: '#f6465d' },
                { label: 'Reversed', value: summary.withdrawal_reversed_total, color: '#566169' },
              ]}
              centerLabel="Requests"
              centerValue={String(summary.withdrawal_paid_count + summary.withdrawal_pending_count + summary.withdrawal_failed_count)}
            />
          </div>

          <div className="rounded-xl border border-line bg-surface p-6">
            <span className={HEAD}>Volumes</span>
            <p className="text-[12px] text-muted mt-1 mb-5">Headline totals &middot; {rangeLabel}</p>
            <CompareBars
              data={[
                { label: 'Deposits', value: summary.deposit_total, color: '#0ecb81' },
                { label: 'Withdrawals', value: summary.withdrawal_paid_total, color: '#f6465d' },
                { label: 'Bet volume', value: summary.bet_volume, color: '#015d72' },
                { label: 'GGR', value: summary.ggr, color: '#e0a80b' },
              ]}
              valueFormatter={(n) => 'KSh ' + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : Math.round(n).toLocaleString('en-KE'))}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ' + (typeFilter === f.value ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface border-line text-muted hover:text-ink')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as TxStatus)}
          aria-label="Status filter"
          className="h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {STATUS_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input
          type="search"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search player or reference..."
          aria-label="Search transactions"
          className="h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 flex-1 min-w-[180px]"
        />
      </div>

      {/* Ledger */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                <th className="text-left px-5 py-3 font-medium">Player</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-right px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Method</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Reference</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Time</th>
                <th className="text-right px-5 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-faint">No transactions match these filters.</td></tr>
              ) : rows.map(tx => {
                const st = statusTone(tx.status);
                const mpesa = tx.payment_method === 'mpesa' && !!tx.reference && (tx.type === 'deposit' || tx.type === 'withdrawal');
                return (
                  <tr key={tx.id} className="hover:bg-canvas transition-colors">
                    <td className="px-5 py-3 text-ink font-medium">{tx.username ?? 'Unknown'}</td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase ' + typeBadge(tx.type)}>{tx.type}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={Number(tx.amount) >= 0 ? 'text-up' : 'text-down'}>
                        {Number(tx.amount) >= 0 ? '+' : '-'}{fmtKES(Math.abs(Number(tx.amount)))}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted text-xs hidden md:table-cell">{tx.payment_method ?? '-'}</td>
                    <td className="px-5 py-3 text-muted text-xs font-mono hidden lg:table-cell max-w-[160px] truncate" title={tx.reference ?? ''}>{tx.reference ?? '-'}</td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex items-center gap-1.5 text-[11px] font-medium ' + st.text}>
                        <span className={'h-1.5 w-1.5 rounded-full ' + st.dot} />{tx.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted text-xs whitespace-nowrap hidden sm:table-cell" title={new Date(tx.created_at).toLocaleString()}>{new Date(tx.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      {mpesa ? (
                        <button
                          onClick={() => openDetail(tx.id)}
                          className="inline-flex items-center px-2.5 py-1 rounded-lg border border-line text-[12px] font-medium text-muted hover:text-brand hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
                        >
                          M-Pesa
                        </button>
                      ) : <span className="text-faint text-[12px]">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line">
          <span className="text-[12px] text-muted tabular-nums">
            {total === 0 ? 'No results' : `${(page * PAGE_SIZE) + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
          </span>
          <div className="inline-flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="h-8 px-3 rounded-lg border border-line bg-surface text-[12px] text-muted hover:text-ink disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-[12px] text-muted tabular-nums">{page + 1} / {pageCount}</span>
            <button
              onClick={() => setPage(p => (p + 1 < pageCount ? p + 1 : p))}
              disabled={page + 1 >= pageCount || loading}
              className="h-8 px-3 rounded-lg border border-line bg-surface text-[12px] text-muted hover:text-ink disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* M-Pesa drill-down modal */}
      {(detailLoading || detail || detailErr) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => { setDetail(null); setDetailErr(null); }}>
          <div className="bg-surface border border-line rounded-2xl w-full max-w-lg shadow-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h3 className="text-ink font-semibold text-lg">M-Pesa transaction detail</h3>
              <button onClick={() => { setDetail(null); setDetailErr(null); }} aria-label="Close" className="text-muted hover:text-ink text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5 overflow-y-auto">
              {detailLoading && <div className="flex items-center gap-2 text-muted text-sm"><Spin />Loading...</div>}
              {detailErr && <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-down text-[13px]">{detailErr}</div>}
              {detail && !detail.linked && (
                <p className="text-muted text-[13px]">No linked M-Pesa record was found for this transaction. Reversals and bonus credits carry no Daraja reference.</p>
              )}
              {detail && detail.linked && detail.detail && (
                <DetailBody kind={detail.kind} d={detail.detail} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  const s = value == null || value === '' ? '-' : String(value);
  return (
    <div className="py-2 flex items-start justify-between gap-4 border-b border-line last:border-0">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={'text-[13px] text-ink text-right break-all ' + (mono ? 'font-mono' : '')}>{s}</span>
    </div>
  );
}

function DetailBody({ kind, d }: { kind: 'stk' | 'b2c' | null; d: Record<string, unknown> }) {
  const amount = d.amount != null ? fmtKES(Number(d.amount)) : '-';
  return (
    <div className="space-y-4">
      <div className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-brand/10 text-brand">
        {kind === 'stk' ? 'STK deposit' : 'B2C payout'}
      </div>
      <div className="rounded-xl border border-line bg-canvas px-4">
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
        <details className="rounded-xl border border-line bg-canvas">
          <summary className="px-4 py-2.5 text-[12px] font-medium text-muted cursor-pointer select-none">Raw Daraja callback payload</summary>
          <pre className="px-4 pb-4 text-[11px] text-ink font-mono whitespace-pre-wrap break-all overflow-x-auto">{JSON.stringify(d.callback_payload, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
