import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, PlugZap, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Spin } from '../components/Spin';
import { useAdmin } from '../roleContext';
import { fmtKES } from './settings/shared';
import {
  adminDepositError, attentionReason, canCheckNow, canConfirmByHand, maskPhone, normaliseReceipt,
  ORPHAN_REASON, relTime, STATUS_META, successRate, type DepositRow,
} from '../lib/deposits';

// ============================================================================
// DEPOSITS — Mega Pay M-Pesa deposits for operators.
//   • Gateway health: connection test, automatic-check schedule, limits
//   • KPIs for the brand (platform owner: all brands or one)
//   • Every deposit with triage filters, "check now" and hand confirmation
// Scope is enforced server-side: RLS (admin_read_site) for the list,
// fn_admin_megapay_overview / fn_admin_megapay_manual_credit for the rest.
// ============================================================================

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
const BTN = 'inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50';
const INPUT = 'h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40';
const PAGE = 50;

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
  const { isPlatform } = useAdmin();
  const [ov, setOv] = useState<Overview | null>(null);
  const [gw, setGw] = useState<Gateway | null>(null);
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [site, setSite] = useState<string>('');
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DepositRow | null>(null);
  const [testing, setTesting] = useState(false);

  // Platform owner can focus on one brand.
  useEffect(() => {
    if (!isPlatform) return;
    supabase.from('sites').select('id, name').order('name').then(({ data }) => setSites((data ?? []) as { id: string; name: string }[]));
  }, [isPlatform]);

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
    { label: 'Credited today', value: fmtKES(k.today_completed_kes), sub: `${k.today_completed_count ?? 0} deposits · ${k.today_started ?? 0} started`, tone: 'text-up' },
    { label: 'Success rate (7 days)', value: successRate(k.week_completed ?? 0, k.week_started ?? 0), sub: `${k.week_completed ?? 0} of ${k.week_started ?? 0} · ${fmtKES(k.week_completed_kes)}`, tone: 'text-ink' },
    { label: 'Waiting for PIN', value: String(k.pending_count ?? 0), sub: fmtKES(k.pending_kes), tone: 'text-brand' },
    { label: 'Unconfirmed', value: String(k.timeout_count ?? 0), sub: `${fmtKES(k.timeout_kes)} · still checked for 3 days`, tone: 'text-amber-300' },
    { label: 'Needs attention', value: String(k.attention_count ?? 0), sub: 'orphans, stale, mismatches', tone: (k.attention_count ?? 0) > 0 ? 'text-down' : 'text-ink' },
  ], [k]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Deposits</h1>
          <p className="text-[13px] text-muted mt-1">M-Pesa deposits through Mega Pay — live status, checks and hand confirmation</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isPlatform && (
            <select value={site} onChange={(e) => setSite(e.target.value)} aria-label="Brand" className={INPUT}>
              <option value="">All brands</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={checkAllNow} disabled={busy === 'all'} className={BTN} data-testid="deposits-check-all">
            {busy === 'all' ? <Spin /> : <RefreshCw size={14} />} Check waiting deposits now
          </button>
          <button onClick={() => void refresh()} disabled={loading} className={BTN}>{loading && <Spin />}Refresh</button>
        </div>
      </div>

      {err && <div role="alert" className="px-4 py-2.5 bg-down/10 border border-down/30 rounded-lg text-down text-[13px]">{err}</div>}
      {notice && <div role="status" className="px-4 py-2.5 bg-brand/10 border border-brand/30 rounded-lg text-ink text-[13px] flex items-center justify-between gap-3"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button></div>}

      {/* Gateway health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" data-testid="gateway-health">
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between"><span className={HEAD}>Gateway</span><PlugZap size={15} className="text-faint" /></div>
          <div className="mt-3 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${gw?.configured ? 'bg-up' : 'bg-down'}`} />
            <span className="text-ink font-semibold">Mega Pay</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded border border-line text-muted uppercase">{gw?.env ?? '…'}</span>
          </div>
          <p className="text-[12px] text-muted mt-1.5">Account {gw?.email ?? '—'} · {h?.provider === 'megapay' ? 'taking player deposits' : `deposits routed to ${h?.provider ?? '…'}`}</p>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button onClick={testConnection} disabled={testing} className={BTN} data-testid="gateway-test">{testing ? <Spin /> : <ShieldCheck size={14} />} Test connection</button>
            {gw?.test && (
              <span className={`text-[12px] ${gw.test.ok ? 'text-up' : 'text-down'}`} data-testid="gateway-test-result">
                {gw.test.ok ? 'Connected — Mega Pay accepted the key and email.' : (gw.test.message ?? 'Mega Pay refused the credentials.')}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between"><span className={HEAD}>Automatic checks</span><Clock size={15} className="text-faint" /></div>
          {h && (h.auto_check_scheduled && h.auto_check_ready ? (
            <>
              <p className="mt-3 text-ink font-semibold flex items-center gap-2"><CheckCircle2 size={15} className="text-up" /> Every minute</p>
              <p className="text-[12px] text-muted mt-1.5">Last run {relTime(h.auto_check_last_run)}{h.auto_check_last_status && h.auto_check_last_status !== 'succeeded' ? ` · ${h.auto_check_last_status}` : ''}. Deposits are settled even if the player closes the app.</p>
            </>
          ) : (
            <>
              <p className="mt-3 text-amber-300 font-semibold flex items-center gap-2" data-testid="auto-check-off"><AlertTriangle size={15} /> Not running yet</p>
              <p className="text-[12px] text-muted mt-1.5">
                {h.auto_check_scheduled ? 'The schedule exists but its two vault secrets are not set.' : 'The schedule is missing.'} Deposits still settle while the player waits in the app, and when you press “Check waiting deposits now”.
              </p>
            </>
          ))}
        </div>

        <GatewaySettings h={h} onSaved={refresh} />
      </div>

      {/* KPIs */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-5 pt-4 pb-1 flex items-center justify-between">
          <span className={HEAD}>{ov?.scope === 'all' ? 'All brands' : 'This brand'}</span>
          {loading && <Spin />}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-line">
          {tiles.map((t) => (
            <div key={t.label} className="p-5 min-w-0">
              <div className={HEAD}>{t.label}</div>
              <div className={`mt-2.5 text-[20px] leading-none font-semibold tabular-nums tracking-tight break-words ${t.tone}`}>{ov ? t.value : '…'}</div>
              <div className="mt-2 text-[11px] text-faint">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="p-4 flex items-center gap-3 flex-wrap border-b border-line">
          <div className="inline-flex gap-1 bg-white/[0.06] border border-line rounded-lg p-1 flex-wrap" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.v} role="tab" aria-selected={filter === f.v} onClick={() => setFilter(f.v)}
                className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (filter === f.v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {f.label}{f.v === 'attention' && (k.attention_count ?? 0) > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-down/20 text-down text-[11px]">{k.attention_count}</span>}
              </button>
            ))}
          </div>
          <label className="relative ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, receipt or deposit id" aria-label="Search deposits" className={INPUT + ' pl-8 w-[260px]'} />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="deposits-table">
            <thead>
              <tr className="text-[11px] text-muted uppercase tracking-wider border-b border-line">
                <th className="w-8" />
                <th className="text-left px-3 py-3 font-medium">Time</th>
                <th className="text-left px-3 py-3 font-medium">Player</th>
                {isPlatform && <th className="text-left px-3 py-3 font-medium hidden lg:table-cell">Brand</th>}
                <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Phone</th>
                <th className="text-right px-3 py-3 font-medium">Amount</th>
                <th className="text-left px-3 py-3 font-medium">Status</th>
                <th className="text-left px-3 py-3 font-medium hidden lg:table-cell">Receipt</th>
                <th className="text-left px-3 py-3 font-medium hidden xl:table-cell">Checked</th>
                <th className="text-right px-3 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-12 text-center text-faint text-[13px]">No deposits match.</td></tr>
              )}
              {rows.map((r) => {
                const why = attentionReason(r);
                const meta = STATUS_META[r.status] ?? STATUS_META.pending;
                const expanded = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-b border-line/60 hover:bg-white/[0.02] ${why ? 'bg-down/[0.03]' : ''}`} data-testid="deposit-row">
                      <td className="pl-3">
                        <button onClick={() => setOpen(expanded ? null : r.id)} aria-label={expanded ? 'Hide details' : 'Show details'} className="text-faint hover:text-ink">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-muted text-xs whitespace-nowrap" title={new Date(r.created_at).toLocaleString()}>{new Date(r.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="px-3 py-3"><Link to={`/admin/users/${r.user_id}`} className="text-ink hover:text-brand">{r.profiles?.username ?? r.user_id.slice(0, 8)}</Link></td>
                      {isPlatform && <td className="px-3 py-3 text-muted text-xs hidden lg:table-cell">{r.sites?.name ?? '—'}</td>}
                      <td className="px-3 py-3 text-muted text-xs font-mono hidden md:table-cell">{maskPhone(r.phone_number)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink font-medium whitespace-nowrap">{fmtKES(r.amount)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                        {why && <AlertTriangle size={13} className="inline ml-1.5 text-down" aria-label="Needs attention" />}
                      </td>
                      <td className="px-3 py-3 text-xs font-mono text-muted hidden lg:table-cell">{r.mpesa_receipt_number ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-faint hidden xl:table-cell whitespace-nowrap">{r.check_count ?? 0}× · {relTime(r.last_checked_at)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {canCheckNow(r) && (
                          <button onClick={() => void checkOne(r)} disabled={busy === r.id} className="text-[12px] text-brand hover:underline disabled:opacity-50 mr-3">
                            {busy === r.id ? 'Checking…' : 'Check now'}
                          </button>
                        )}
                        {canConfirmByHand(r) && h?.can_manual_credit && (
                          <button onClick={() => setConfirming(r)} className="text-[12px] text-amber-300 hover:underline" data-testid="confirm-by-hand">Confirm payment</button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-line/60 bg-white/[0.02]">
                        <td />
                        <td colSpan={9} className="px-3 py-4">
                          {why && <p className="text-[12px] text-down mb-3 flex items-center gap-2"><AlertTriangle size={13} /> {why}</p>}
                          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-[12px]">
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
          </table>
        </div>
        <div className="px-5 py-3 border-t border-line flex items-center justify-between text-[12px] text-muted">
          <span className="tabular-nums">{total.toLocaleString()} deposits</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={BTN}>Previous</button>
            <span className="tabular-nums">{page + 1} / {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages} className={BTN}>Next</button>
          </div>
        </div>
      </div>

      {confirming && <ConfirmDialog row={confirming} onClose={() => setConfirming(null)} onDone={async (msg) => { setConfirming(null); setNotice(msg); await refresh(); }} />}
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{k}</dt>
      <dd className={`text-ink break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{v || '—'}</dd>
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
    <div className="rounded-xl border border-line bg-surface p-5">
      <span className={HEAD}>Deposit limits</span>
      {!h ? <p className="mt-3 text-faint text-[12px]">…</p> : h.can_edit_gateway ? (
        <div className="mt-3 space-y-3" data-testid="gateway-settings">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] text-muted">Gateway
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className={INPUT + ' w-full mt-1'}>
                <option value="megapay">Mega Pay</option>
                <option value="daraja">Daraja (off)</option>
              </select>
            </label>
            <label className="text-[11px] text-muted">Min (KES)
              <input value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={INPUT + ' w-full mt-1'} />
            </label>
            <label className="text-[11px] text-muted">Max (KES)
              <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={INPUT + ' w-full mt-1'} />
            </label>
          </div>
          {provider === 'daraja' && <p className="text-[11px] text-amber-300">Daraja has no credentials configured — choosing it stops all deposits.</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className={BTN}>{saving && <Spin />}Save for all brands</button>
            {msg && <span className={`text-[12px] ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</span>}
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-ink font-semibold tabular-nums">{fmtKES(h.min_deposit)} – {fmtKES(h.max_deposit)}</p>
          <p className="text-[12px] text-muted mt-1.5">Per deposit. Set by the platform owner for every brand.</p>
        </>
      )}
    </div>
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirm payment">
      <div className="w-full max-w-[460px] rounded-xl border border-line bg-surface p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink font-semibold">Confirm a Mega Pay payment</h2>
            <p className="text-[12px] text-muted mt-1">Only after you have found this payment in the Mega Pay portal or the player's M-Pesa SMS.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink"><X size={16} /></button>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[12px] rounded-lg border border-line p-3">
          <Detail k="Player" v={row.profiles?.username ?? row.user_id} />
          <Detail k="Amount" v={fmtKES(row.amount)} />
          <Detail k="Phone" v={row.phone_number} mono />
          <Detail k="Started" v={new Date(row.created_at).toLocaleString()} />
        </dl>
        <label className="block text-[12px] text-ink">M-Pesa receipt
          <input value={receipt} onChange={(e) => setReceipt(e.target.value.toUpperCase())} placeholder="e.g. TIR4K2LMN8" maxLength={12}
            className={INPUT + ' w-full mt-1 font-mono uppercase'} aria-label="M-Pesa receipt" />
        </label>
        <label className="block text-[12px] text-ink">Reason
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Where you confirmed it"
            className="w-full mt-1 px-3 py-2 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label="Reason" />
        </label>
        <label className="flex items-start gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
          I confirmed {fmtKES(row.amount)} from {maskPhone(row.phone_number)} was received. This credits the player once and is logged under my name.
        </label>
        {err && <p role="alert" className="text-[12px] text-down">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={BTN}>Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className={BTN + ' !text-ink !border-amber-400/50'} data-testid="confirm-credit">
            {saving && <Spin />}Credit {fmtKES(row.amount)}
          </button>
        </div>
      </div>
    </div>
  );
}
