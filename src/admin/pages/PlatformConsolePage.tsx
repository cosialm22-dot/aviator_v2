import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Building2, Plus, X, Users, TrendingUp, Banknote, Clock, Check, AlertCircle } from 'lucide-react';

// ============================================================================
// Platform Console (platform_superadmin only) - the cross-brand control room.
// All brands share one game engine/config (by design); this console governs
// each brand's identity, status, payouts toggle, and shows per-brand KPIs.
// Every figure & write is served by platform_* SECURITY DEFINER RPCs which are
// themselves gated on _is_platform_superadmin(); this page is the UI over them.
// ============================================================================

interface SiteRow {
  site_id: string;
  name: string;
  slug: string;
  status: string;
  withdrawals_enabled: boolean;
  default_marketer_id: string | null;
  default_marketer_username: string | null;
  created_at: string;
  player_count: number;
  marketer_count: number;
  deposit_total: number;
  ggr: number;
  withdrawal_pending_count: number;
  withdrawal_pending_total: number;
  withdrawal_paid_total: number;
  net_cashflow: number;
}

const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';

function fmtKES(n: number): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}KSh ${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}KSh ${(a / 1_000).toFixed(1)}K`;
  return `${sign}KSh ${a.toLocaleString('en-KE')}`;
}

// Friendly text for the RPC RAISE codes.
const ERR_TEXT: Record<string, string> = {
  FORBIDDEN: 'You do not have platform permissions.',
  INVALID_SLUG: 'Slug must be 3-40 chars: lowercase letters, numbers, hyphens.',
  SLUG_TAKEN: 'That slug is already in use by another brand.',
  NAME_REQUIRED: 'Brand name is required.',
  INVALID_STATUS: 'Invalid status.',
  NOT_FOUND: 'Brand not found.',
  INVALID_DEFAULT_MARKETER: 'Default marketer must be a marketer of this brand.',
};
function friendly(msg: string | undefined): string {
  if (!msg) return 'Something went wrong.';
  for (const key of Object.keys(ERR_TEXT)) if (msg.includes(key)) return ERR_TEXT[key];
  return msg;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-up/15 text-up',
  suspended: 'bg-gold/15 text-gold',
  archived: 'bg-white/10 text-muted',
};

export default function PlatformConsolePage() {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const { data, error } = await supabase.rpc('platform_sites_overview');
    if (error) { setErr(friendly(error.message)); setLoading(false); return; }
    setRows((data ?? []) as SiteRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Platform-wide roll-ups across every brand.
  const totals = rows.reduce(
    (a, r) => ({
      brands: a.brands + 1,
      players: a.players + Number(r.player_count),
      deposits: a.deposits + Number(r.deposit_total),
      ggr: a.ggr + Number(r.ggr),
      pending: a.pending + Number(r.withdrawal_pending_count),
      pendingAmt: a.pendingAmt + Number(r.withdrawal_pending_total),
    }),
    { brands: 0, players: 0, deposits: 0, ggr: 0, pending: 0, pendingAmt: 0 },
  );

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand/15 flex items-center justify-center">
            <Building2 size={20} className="text-brand" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink tracking-tight">Platform Console</h1>
            <p className="text-[13px] text-muted">All brands run on one shared game engine. Manage each brand below.</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-[13px] font-medium transition-colors self-start"
        >
          <Plus size={16} strokeWidth={2} /> New Brand
        </button>
      </div>

      {/* Platform roll-up */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <SummaryCard label="Brands" value={totals.brands.toLocaleString('en-KE')} icon={<Building2 size={15} />} />
        <SummaryCard label="Players" value={totals.players.toLocaleString('en-KE')} icon={<Users size={15} />} />
        <SummaryCard label="Deposits" value={fmtKES(totals.deposits)} icon={<Banknote size={15} />} />
        <SummaryCard label="GGR" value={fmtKES(totals.ggr)} icon={<TrendingUp size={15} />} tone={totals.ggr >= 0 ? 'up' : 'down'} />
        <SummaryCard label="Pending payouts" value={`${totals.pending} · ${fmtKES(totals.pendingAmt)}`} icon={<Clock size={15} />} />
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-down/10 border border-down/30 text-down text-[13px]">
          <AlertCircle size={15} /> {err}
        </div>
      )}

      {/* Brands table */}
      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className={HEAD}>Brands</span>
          <span className="text-[12px] text-muted tabular-nums">{rows.length}</span>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted text-[13px]">No brands yet. Create your first brand.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left border-b border-line">
                  {['Brand', 'Status', 'Players', 'Marketers', 'Deposits', 'GGR', 'Pending', 'Payouts', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-2.5 font-medium ${CAP} ${i >= 2 && i <= 6 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.site_id} className="border-b border-line/60 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{r.name}</div>
                      <div className="text-[11px] text-faint">/{r.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${STATUS_STYLE[r.status] ?? 'bg-white/10 text-muted'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{Number(r.player_count).toLocaleString('en-KE')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{Number(r.marketer_count).toLocaleString('en-KE')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{fmtKES(r.deposit_total)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${Number(r.ggr) >= 0 ? 'text-up' : 'text-down'}`}>{fmtKES(r.ggr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {Number(r.withdrawal_pending_count) > 0
                        ? <span className="text-gold">{r.withdrawal_pending_count} · {fmtKES(r.withdrawal_pending_total)}</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {r.withdrawals_enabled
                        ? <span className="inline-flex items-center gap-1 text-up text-[12px]"><Check size={13} /> On</span>
                        : <span className="inline-flex items-center gap-1 text-down text-[12px]"><X size={13} /> Off</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(r)} className="px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-brand text-[12px] transition-colors">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && <CreateBrandModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); void load(); }} />}
      {editing && <EditBrandModal site={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function SummaryCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-muted mb-1.5">{icon}<span className={CAP}>{label}</span></div>
      <div className={`text-lg font-semibold tabular-nums ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 bg-canvas border border-line rounded-lg text-ink text-[13px] focus:outline-none focus:border-brand';
const labelCls = 'block text-[12px] font-medium text-muted mb-1.5';

function CreateBrandModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-suggest a slug from the name until the user edits the slug directly.
  const [slugTouched, setSlugTouched] = useState(false);
  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const finalSlug = slugTouched ? slug.trim() : slugify(name);
    const { error } = await supabase.rpc('platform_create_site', { p_slug: finalSlug, p_name: name.trim() });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    onDone();
  }

  return (
    <ModalShell title="New Brand" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Brand name</label>
          <input className={inputCls} value={name} autoFocus placeholder="e.g. Tamu Traders"
            onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Slug</label>
          <input className={inputCls} value={slugTouched ? slug : slugify(name)}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
            placeholder="tamu-traders" required />
          <p className="text-[11px] text-faint mt-1">Lowercase letters, numbers, hyphens. 3-40 chars. Used at signup to attribute players.</p>
        </div>
        {err && <div className="flex items-center gap-2 text-down text-[12px]"><AlertCircle size={14} /> {err}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-muted hover:text-ink text-[13px] transition-colors">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand/90 text-white font-medium text-[13px] transition-colors disabled:opacity-50">
            {busy ? 'Creating…' : 'Create brand'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditBrandModal({ site, onClose, onDone }: { site: SiteRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(site.name);
  const [status, setStatus] = useState(site.status);
  const [withdrawals, setWithdrawals] = useState(site.withdrawals_enabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('platform_update_site', {
      p_site: site.site_id,
      p_name: name.trim(),
      p_status: status,
      p_withdrawals_enabled: withdrawals,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    onDone();
  }

  return (
    <ModalShell title={`Edit · ${site.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Brand name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="suspended">Suspended (blocks new signups)</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <label className="flex items-center justify-between py-2 px-3 rounded-lg bg-canvas border border-line cursor-pointer">
          <span className="text-[13px] text-ink">Withdrawals enabled</span>
          <input type="checkbox" checked={withdrawals} onChange={(e) => setWithdrawals(e.target.checked)} className="h-4 w-4 accent-brand" />
        </label>
        <p className="text-[11px] text-faint">Slug <span className="text-muted">/{site.slug}</span> is permanent. Game config is shared across all brands.</p>
        {err && <div className="flex items-center gap-2 text-down text-[12px]"><AlertCircle size={14} /> {err}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-muted hover:text-ink text-[13px] transition-colors">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand/90 text-white font-medium text-[13px] transition-colors disabled:opacity-50">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
