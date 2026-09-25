import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, PlugZap, RefreshCw, ShieldCheck, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Spin } from '../components/Spin';
import { useScope } from '../scopeContext';
import { fmtKES } from './settings/shared';
import {
  adminDepositError, attentionReason, canCheckNow, canConfirmByHand, maskPhone, normaliseReceipt,
  ORPHAN_REASON, relTime, STATUS_META, successRate, type DepositRow,
} from '../lib/deposits';
import {
  Badge, Button, Card, Empty, ErrorState, Field, Notice, PageHeader, Pills, SearchInput, Select, StatCard, TableWrap, Td, Th, inputCls,
} from '../ui/kit';

// ============================================================================
// DEPOSITS — Mega Pay M-Pesa deposits for operators.
//   • Gateway health: connection test, automatic-check schedule, limits
//   • KPIs for the brand (platform owner: all brands or one)
//   • Every deposit with triage filters, "check now" and hand confirmation
// Scope is enforced server-side: RLS (admin_read_site) for the list,
// fn_admin_megapay_overview / fn_admin_megapay_manual_credit for the rest.
// ============================================================================

const PAGE = 50;
const ICON_BTN = 'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-ink';
const TEXTAREA = 'w-full px-3 py-2 rounded-lg bg-raised text-[13px] text-ink placeholder:text-faint resize-none focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50';
/** Deposit status → kit Badge tone (labels stay in STATUS_META). */
const STATUS_TONE: Record<DepositRow['status'], string> = {
  initiated: 'muted', pending: 'brand', completed: 'up', failed: 'down', cancelled: 'down', timeout: 'warn',
};

type Filter = 'all' | 'attention' | 'open' | 'completed' | 'failed' | 'timeout';
const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all', label: 'All' }, { v: 'attention', label: 'Needs attention' }, { v: 'open', label: 'Waiting' },
  { v: 'timeout', label: 'Unconfirmed' }, { v: 'completed', label: 'Credited' }, { v: 'failed', label: 'Failed' },
];

interface Overview {
  scope: 'all' | 'site';
  kpis: Record<string, number>;
  health: {
    provider: string; min_deposit: number; max_deposit: number;
    auto_check_scheduled: boolean; auto_check_ready: boolean;
    auto_check_last_run: string | null; auto_check_last_status: string | null;
    can_edit_gateway: boolean; can_manual_credit: boolean;
  };
}
interface Gateway { configured: boolean; env: string; base_url: string; email: string | null; cron: boolean; test?: { ok: boolean; message?: string } }

export default function DepositsPage() {
  const scope = useScope();
  const isPlatform = scope.multiBrand;
  const [ov, setOv] = useState<Overview | null>(null);
  const [gw, setGw] = useState<Gateway | null>(null);
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const site = scope.siteId ?? '';
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DepositRow | null>(null);
  const [testing, setTesting] = useState(false);

  const loadOverview = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_admin_megapay_overview', { p_site: site || null });
    if (error) { setErr(adminDepositError(error.message)); return; }
    setOv(data as Overview);
  }, [site]);

  const loadGateway = useCallback(async (action: 'status' | 'test' = 'status') => {
    const { data, error } = await supabase.functions.invoke('megapay-admin', { body: { action } });
    if (!error) setGw(data as Gateway);
    return data as Gateway | null;
  }, []);

  const loadRows = useCallback(async () => {
    let query = supabase.from('mpesa_stk_requests')
      .select('id, created_at, user_id, phone_number, amount, status, provider_status, result_description, mpesa_receipt_number, checkout_request_id, merchant_request_id, check_count, last_checked_at, completed_at, reference, site_id, profiles(username), sites(name)', { count: 'exact' })
      .eq('provider', 'megapay')
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (site) query = query.eq('site_id', site);
    if (filter === 'open') query = query.in('status', ['initiated', 'pending']);
    else if (filter === 'completed') query = query.eq('status', 'completed');
    else if (filter === 'failed') query = query.in('status', ['failed', 'cancelled']);
    else if (filter === 'timeout') query = query.eq('status', 'timeout');
    else if (filter === 'attention') {
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      query = query.neq('status', 'completed').or(
        `and(status.eq.timeout,created_at.lt.${hourAgo}),and(status.eq.failed,result_description.eq."${ORPHAN_REASON}"),provider_status.like.AMOUNT_MISMATCH*`,
      );
    }
    const term = q.trim().replace(/[,()*%]/g, '');
    if (term) {
      const digits = term.replace(/\D/g, '');
      const phone = digits.startsWith('0') ? '254' + digits.slice(1) : digits;
      const ors = [`mpesa_receipt_number.ilike.*${term}*`];
      if (phone.length >= 4) ors.push(`phone_number.ilike.*${phone}*`);
      if (/^[0-9a-f-]{36}$/i.test(term)) ors.push(`id.eq.${term}`);
      query = query.or(ors.join(','));
    }
    const { data, error, count } = await query;
    if (error) { setErr('Could not load deposits.'); return; }
    setRows((data ?? []) as unknown as DepositRow[]);
    setTotal(count ?? 0);
  }, [page, filter, q, site]);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    await Promise.all([loadOverview(), loadRows()]);
    setLoading(false);
  }, [loadOverview, loadRows]);

  useEffect(() => { void loadGateway(); }, [loadGateway]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Quiet auto-refresh while the tab is visible — deposits settle in the background.
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshRef.current(); }, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setPage(0); }, [filter, q, site]);

  async function checkAllNow() {
    setBusy('all'); setNotice(null); setErr(null);
    const { data, error } = await supabase.functions.invoke('megapay-reconcile', { body: {} });
    setBusy(null);
    if (error) { setErr('Could not run the check. Try again in a minute.'); return; }
    const d = data as Record<string, number>;
    setNotice(`Checked ${d.checked ?? 0} with Mega Pay — ${d.credited ?? 0} credited, ${d.failed ?? 0} failed, ${d.pending ?? 0} still waiting${d.errors ? `, ${d.errors} could not be reached` : ''}.`);
    await refresh();
  }

  async function checkOne(r: DepositRow) {
    setBusy(r.id); setNotice(null); setErr(null);
    const { data, error } = await supabase.functions.invoke('megapay-status', { body: { id: r.id } });
    setBusy(null);
    if (error) { setErr('Could not check this deposit.'); return; }
    const s = (data as { status?: string })?.status ?? r.status;
    setNotice(`Deposit ${r.id.slice(0, 8)}: ${STATUS_META[s as DepositRow['status']]?.label ?? s}.`);
    await refresh();
  }

  async function testConnection() {
    setTesting(true);
    await loadGateway('test');
    setTesting(false);
  }

  const k = useMemo<Record<string, number>>(() => ov?.kpis ?? {}, [ov]);
  const h = ov?.health;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const tiles = useMemo(() => [
    { label: 'Credited today', value: fmtKES(k.today_completed_kes), sub: `${k.today_completed_count ?? 0} deposits · ${k.today_started ?? 0} started`, tone: 'up' },
    { label: 'Success rate (7 days)', value: successRate(k.week_completed ?? 0, k.week_started ?? 0), sub: `${k.week_completed ?? 0} of ${k.week_started ?? 0} · ${fmtKES(k.week_completed_kes)}`, tone: 'ink' },
    { label: 'Waiting for PIN', value: String(k.pending_count ?? 0), sub: fmtKES(k.pending_kes), tone: 'brand' },
    { label: 'Unconfirmed', value: String(k.timeout_count ?? 0), sub: `${fmtKES(k.timeout_kes)} · still checked for 3 days`, tone: 'warn' },
    { label: 'Needs attention', value: String(k.attention_count ?? 0), sub: 'orphans, stale, mismatches', tone: (k.attention_count ?? 0) > 0 ? 'down' : 'ink' },
  ], [k]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deposits"
        subtitle="M-Pesa deposits through Mega Pay — live status, checks and hand confirmation"
        actions={<>
          <Button variant="primary" onClick={checkAllNow} disabled={busy === 'all'} data-testid="deposits-check-all">
            {busy === 'all' ? <Spin /> : <RefreshCw size={14} />} Check waiting deposits now
          </Button>
          <Button onClick={() => void refresh()} loading={loading}>Refresh</Button>
        </>}
      />

      {err && <ErrorState message={err} />}
      {notice && <Notice onClose={() => setNotice(null)}>{notice}</Notice>}

      {/* Gateway health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" data-testid="gateway-health">
        <Card title="Gateway" action={<PlugZap size={15} className="text-faint" />}>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${gw?.configured ? 'bg-up' : 'bg-down'}`} />
            <span className="text-[15px] font-semibold text-ink">Mega Pay</span>
            <Badge>{gw?.env ?? '…'}</Badge>
          </div>
          <p className="mt-1.5 text-[13px] text-muted">Account {gw?.email ?? '—'} · {h?.provider === 'megapay' ? 'taking player deposits' : `deposits routed to ${h?.provider ?? '…'}`}</p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Button onClick={testConnection} disabled={testing} data-testid="gateway-test">{testing ? <Spin /> : <ShieldCheck size={14} />} Test connection</Button>
            {gw?.test && (
              <span className={`text-[13px] ${gw.test.ok ? 'text-up' : 'text-down'}`} data-testid="gateway-test-result">
                {gw.test.ok ? 'Connected — Mega Pay accepted the key and email.' : (gw.test.message ?? 'Mega Pay refused the credentials.')}
              </span>
            )}
          </div>
        </Card>

        <Card title="Automatic checks" action={<Clock size={15} className="text-faint" />}>
          {h && (h.auto_check_scheduled && h.auto_check_ready ? (
            <>
              <p className="flex items-center gap-2 text-[15px] font-semibold text-ink"><CheckCircle2 size={15} className="text-up" /> Every minute</p>
              <p className="mt-1.5 text-[13px] text-muted">Last run {relTime(h.auto_check_last_run)}{h.auto_check_last_status && h.auto_check_last_status !== 'succeeded' ? ` · ${h.auto_check_last_status}` : ''}. Deposits are settled even if the player closes the app.</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[15px] font-semibold text-warn" data-testid="auto-check-off"><AlertTriangle size={15} /> Not running yet</p>
              <p className="mt-1.5 text-[13px] text-muted">
                {h.auto_check_scheduled ? 'The schedule exists but its two vault secrets are not set.' : 'The schedule is missing.'} Deposits still settle while the player waits in the app, and when you press “Check waiting deposits now”.
              </p>
            </>
          ))}
        </Card>

        <GatewaySettings h={h} onSaved={refresh} />
      </div>

      {/* KPIs */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{ov?.scope === 'all' ? 'All brands' : 'This brand'}</h2>
          {loading && <span className="text-faint"><Spin /></span>}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <StatCard key={t.label} label={t.label} value={ov ? t.value : '…'} sub={t.sub} tone={t.tone} />
          ))}
        </div>
      </section>

      {/* List */}
      <Card pad={false} className="overflow-hidden">
        <div className="p-4 flex items-center gap-3 flex-wrap border-b border-line">
          <Pills
            label="Deposit filter"
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((f) => ({
              value: f.v,
              label: <>{f.label}{f.v === 'attention' && (k.attention_count ?? 0) > 0 && <span className="ml-1.5"><Badge tone="down">{k.attention_count}</Badge></span>}</>,
            }))}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Phone, receipt or deposit id" label="Search deposits" className="ml-auto w-full sm:w-[260px]" />
        </div>

        <TableWrap testId="deposits-table" minWidth={0}>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th>Time</Th>
              <Th>Player</Th>
              {isPlatform && <Th className="hidden lg:table-cell">Brand</Th>}
              <Th className="hidden md:table-cell">Phone</Th>
              <Th numeric>Amount</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">Receipt</Th>
              <Th className="hidden xl:table-cell">Checked</Th>
              <Th numeric>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10}><Empty title="No deposits match." /></td></tr>
            )}
            {rows.map((r) => {
              const why = attentionReason(r);
              const meta = STATUS_META[r.status] ?? STATUS_META.pending;
              const expanded = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={`transition-colors hover:bg-white/[0.03] ${why ? 'bg-down/5' : ''}`} data-testid="deposit-row">
                    <td className="pl-2">
                      <button onClick={() => setOpen(expanded ? null : r.id)} aria-label={expanded ? 'Hide details' : 'Show details'} className={ICON_BTN}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <Td className="text-muted whitespace-nowrap tabular-nums" title={new Date(r.created_at).toLocaleString()}>{new Date(r.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                    <Td><Link to={`/admin/users/${r.user_id}`} className="font-medium text-ink hover:text-brand">{r.profiles?.username ?? r.user_id.slice(0, 8)}</Link></Td>
                    {isPlatform && <Td className="text-muted hidden lg:table-cell">{r.sites?.name ?? '—'}</Td>}
                    <Td className="font-mono !text-[12px] text-muted hidden md:table-cell">{maskPhone(r.phone_number)}</Td>
                    <Td numeric className="font-medium text-ink">{fmtKES(r.amount)}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Badge tone={STATUS_TONE[r.status] ?? 'brand'}>{meta.label}</Badge>
                        {why && <AlertTriangle size={13} className="text-down" aria-label="Needs attention" />}
                      </span>
                    </Td>
                    <Td className="font-mono !text-[12px] text-muted hidden lg:table-cell">{r.mpesa_receipt_number ?? '—'}</Td>
                    <Td className="!text-[12px] text-faint tabular-nums hidden xl:table-cell whitespace-nowrap">{r.check_count ?? 0}× · {relTime(r.last_checked_at)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-2">
                        {canCheckNow(r) && (
                          <Button size="sm" variant="ghost" onClick={() => void checkOne(r)} disabled={busy === r.id}>
                            {busy === r.id ? 'Checking…' : 'Check now'}
                          </Button>
                        )}
                        {canConfirmByHand(r) && h?.can_manual_credit && (
                          <Button size="sm" variant="warn" onClick={() => setConfirming(r)} data-testid="confirm-by-hand">Confirm payment</Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                  {expanded && (
                    <tr className="bg-raised/40">
                      <td />
                      <td colSpan={9} className="px-3 py-4">
                        {why && <p className="mb-3 flex items-center gap-2 text-[13px] text-down"><AlertTriangle size={13} /> {why}</p>}
                        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                          <Detail k="Deposit id" v={r.id} mono />
                          <Detail k="Mega Pay id" v={r.checkout_request_id.startsWith('mp-pending:') ? 'none (no answer)' : r.checkout_request_id} mono />
                          <Detail k="Merchant request" v={r.merchant_request_id} mono />
                          <Detail k="Account reference" v={r.reference} />
                          <Detail k="Mega Pay status" v={r.provider_status} />
                          <Detail k="Result" v={r.result_description} />
                          <Detail k="Completed" v={r.completed_at ? new Date(r.completed_at).toLocaleString() : null} />
                          <Detail k="Phone" v={r.phone_number} mono />
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </TableWrap>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-muted">
          <span className="tabular-nums">{total.toLocaleString()} deposits</span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
            <span className="tabular-nums">{page + 1} / {pages}</span>
            <Button size="sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages}>Next</Button>
          </div>
        </div>
      </Card>

      {confirming && <ConfirmDialog row={confirming} onClose={() => setConfirming(null)} onDone={async (msg) => { setConfirming(null); setNotice(msg); await refresh(); }} />}
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-faint">{k}</dt>
      <dd className={`break-all text-ink ${mono ? 'font-mono text-[12px]' : 'text-[13px]'}`}>{v || '—'}</dd>
    </div>
  );
}

function GatewaySettings({ h, onSaved }: { h: Overview['health'] | undefined; onSaved: () => Promise<void> }) {
  const [provider, setProvider] = useState('megapay');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!h) return;
    setProvider(h.provider); setMin(String(h.min_deposit)); setMax(String(h.max_deposit));
  }, [h]);

  async function save() {
    setSaving(true); setMsg(null);
    const { error } = await supabase.rpc('fn_admin_set_payment_settings', { p_provider: provider, p_min: Number(min), p_max: Number(max) });
    setSaving(false);
    if (error) { setMsg({ ok: false, text: adminDepositError(error.message) }); return; }
    setMsg({ ok: true, text: 'Saved. Players see the new limits at once.' });
    await onSaved();
  }

  return (
    <Card title="Deposit limits">
      {!h ? <p className="text-[12px] text-faint">…</p> : h.can_edit_gateway ? (
        <div className="space-y-3" data-testid="gateway-settings">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Gateway">
              <Select<string> value={provider} onChange={setProvider} label="Gateway" className="h-9 w-full"
                options={[{ value: 'megapay', label: 'Mega Pay' }, { value: 'daraja', label: 'Daraja (off)' }]} />
            </Field>
            <Field label="Min (KES)">
              <input value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={inputCls + ' tabular-nums'} />
            </Field>
            <Field label="Max (KES)">
              <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={inputCls + ' tabular-nums'} />
            </Field>
          </div>
          {provider === 'daraja' && <p className="text-[12px] text-warn">Daraja has no credentials configured — choosing it stops all deposits.</p>}
          <div className="flex items-center gap-3">
            <Button onClick={save} loading={saving}>Save for all brands</Button>
            {msg && <span className={`text-[13px] ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</span>}
          </div>
        </div>
      ) : (
        <>
          <p className="text-[22px] font-semibold leading-tight tabular-nums tracking-[-0.02em] text-ink">{fmtKES(h.min_deposit)} – {fmtKES(h.max_deposit)}</p>
          <p className="mt-1.5 text-[12px] text-faint">Per deposit. Set by the platform owner for every brand.</p>
        </>
      )}
    </Card>
  );
}

function ConfirmDialog({ row, onClose, onDone }: { row: DepositRow; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [receipt, setReceipt] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = normaliseReceipt(receipt) !== null && note.trim().length >= 5 && checked;

  async function submit() {
    const rc = normaliseReceipt(receipt);
    if (!rc) { setErr(adminDepositError('INVALID_RECEIPT')); return; }
    setSaving(true); setErr(null);
    const { error } = await supabase.rpc('fn_admin_megapay_manual_credit', { p_id: row.id, p_receipt: rc, p_note: note.trim() });
    setSaving(false);
    if (error) { setErr(adminDepositError(error.message)); return; }
    await onDone(`Credited ${fmtKES(row.amount)} to ${row.profiles?.username ?? 'the player'} (receipt ${rc}).`);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-[fadeIn_0.15s_ease]" role="dialog" aria-modal="true" aria-label="Confirm payment">
      <div className="w-full max-w-[460px] space-y-4 rounded-2xl bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10 animate-[menuIn_0.2s_cubic-bezier(0.32,0.72,0,1)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Confirm a Mega Pay payment</h2>
            <p className="mt-1 text-[13px] text-muted">Only after you have found this payment in the Mega Pay portal or the player's M-Pesa SMS.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised text-muted hover:text-ink"><X size={13} strokeWidth={2.75} /></button>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-raised/60 p-3">
          <Detail k="Player" v={row.profiles?.username ?? row.user_id} />
          <Detail k="Amount" v={fmtKES(row.amount)} />
          <Detail k="Phone" v={row.phone_number} mono />
          <Detail k="Started" v={new Date(row.created_at).toLocaleString()} />
        </dl>
        <Field label="M-Pesa receipt">
          <input value={receipt} onChange={(e) => setReceipt(e.target.value.toUpperCase())} placeholder="e.g. TIR4K2LMN8" maxLength={12}
            className={inputCls + ' font-mono uppercase'} aria-label="M-Pesa receipt" />
        </Field>
        <Field label="Reason">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Where you confirmed it"
            className={TEXTAREA} aria-label="Reason" />
        </Field>
        <label className="flex items-start gap-2.5 text-[13px] text-muted">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
          I confirmed {fmtKES(row.amount)} from {maskPhone(row.phone_number)} was received. This credits the player once and is logged under my name.
        </label>
        {err && <p role="alert" className="text-[13px] text-down">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="warn" onClick={submit} disabled={!valid} loading={saving} data-testid="confirm-credit">
            Credit {fmtKES(row.amount)}
          </Button>
        </div>
      </div>
    </div>
  );
}
