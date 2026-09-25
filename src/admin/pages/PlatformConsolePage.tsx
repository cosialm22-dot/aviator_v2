import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useScope } from '../scopeContext';
import { Badge, Button, Card, Empty, ErrorState, Field, Modal, PageHeader, StatCard, Switch, TableWrap, Td, Th, inputCls } from '../ui/kit';
import GlobalControls from '../components/GlobalControls';
import { Plus, X, Check, AlertCircle } from 'lucide-react';

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

const STATUS_TONE: Record<string, 'up' | 'warn' | 'down'> = {
  active: 'up',
  suspended: 'warn',
  disabled: 'down',
};

export default function PlatformConsolePage() {
  const scope = useScope();
  const navigate = useNavigate();
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
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Platform" title="Controls"
        subtitle="Every brand runs on one shared game engine. Switches here apply to all brands at once. Each brand's look, plane, limits and domain live under Brands."
        actions={<Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New brand</Button>} />
      <GlobalControls />

      {/* Platform roll-up */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Brands" value={totals.brands.toLocaleString('en-KE')} />
        <StatCard label="Players" value={totals.players.toLocaleString('en-KE')} />
        <StatCard label="Deposits" value={fmtKES(totals.deposits)} />
        <StatCard label="GGR" value={fmtKES(totals.ggr)} tone={totals.ggr >= 0 ? 'up' : 'down'} />
        <StatCard label="Pending payouts" value={`${totals.pending} · ${fmtKES(totals.pendingAmt)}`} />
      </div>

      {err && <ErrorState message={err} />}

      {/* Brands table */}
      <Card title="Brands" action={<span className="text-[13px] text-muted tabular-nums">{rows.length}</span>} pad={false}>
        {loading ? (
          <div className="p-10 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No brands yet. Create your first brand." />
        ) : (
          <TableWrap minWidth={860}>
            <thead>
              <tr>
                {['Brand', 'Status', 'Players', 'Marketers', 'Deposits', 'GGR', 'Pending', 'Payouts', ''].map((h, i) => (
                  <Th key={i} numeric={i >= 2 && i <= 6} className={i === 0 ? 'pl-5' : i === 8 ? 'pr-5' : ''}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.site_id} className="transition-colors hover:bg-white/[0.03]">
                  <Td className="pl-5">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="font-mono text-[12px] text-faint">/{r.slug}</div>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status] ?? 'muted'}><span className="capitalize">{r.status}</span></Badge>
                  </Td>
                  <Td numeric className="text-ink">{Number(r.player_count).toLocaleString('en-KE')}</Td>
                  <Td numeric className="text-muted">{Number(r.marketer_count).toLocaleString('en-KE')}</Td>
                  <Td numeric className="text-ink">{fmtKES(r.deposit_total)}</Td>
                  <Td numeric className={Number(r.ggr) >= 0 ? 'text-up' : 'text-down'}>{fmtKES(r.ggr)}</Td>
                  <Td numeric className="text-muted">
                    {Number(r.withdrawal_pending_count) > 0
                      ? <span className="text-warn">{r.withdrawal_pending_count} · {fmtKES(r.withdrawal_pending_total)}</span>
                      : '—'}
                  </Td>
                  <Td>
                    {r.withdrawals_enabled
                      ? <span className="inline-flex items-center gap-1 text-up"><Check size={13} /> On</span>
                      : <span className="inline-flex items-center gap-1 text-down"><X size={13} /> Off</span>}
                  </Td>
                  <Td className="pr-5 text-right">
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => { scope.setSiteId(r.site_id); navigate('/admin'); }} data-testid="open-brand">Open</Button>
                      <Button size="sm" onClick={() => navigate(`/admin/brands/${r.site_id}`)} data-testid="brand-console">Brand</Button>
                      <Button size="sm" onClick={() => setEditing(r)}>Edit</Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {showCreate && <CreateBrandModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); void load(); }} />}
      {editing && <EditBrandModal site={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

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
    <Modal title="New Brand" onClose={onClose} width={440}
      footer={<>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="create-brand" variant="primary" disabled={busy}>{busy ? 'Creating…' : 'Create brand'}</Button>
      </>}>
      <form id="create-brand" onSubmit={submit} className="space-y-4">
        <Field label="Brand name">
          <input className={inputCls} value={name} autoFocus placeholder="e.g. Tamu Traders"
            onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Slug" hint="Lowercase letters, numbers, hyphens. 3-40 chars. Used at signup to attribute players.">
          <input className={inputCls + ' font-mono'} value={slugTouched ? slug : slugify(name)}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
            placeholder="tamu-traders" required />
        </Field>
        {err && <div className="flex items-center gap-2 text-[13px] text-down"><AlertCircle size={14} /> {err}</div>}
      </form>
    </Modal>
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
    <Modal title={`Edit · ${site.name}`} onClose={onClose} width={440}
      footer={<>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="edit-brand" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </>}>
      <form id="edit-brand" onSubmit={submit} className="space-y-4">
        <Field label="Brand name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="suspended">Suspended (blocks new signups)</option>
            <option value="disabled">Disabled (brand offline)</option>
          </select>
        </Field>
        <div className="flex h-11 items-center justify-between rounded-lg bg-raised px-3">
          <span className="text-[13px] text-ink">Withdrawals enabled</span>
          <Switch checked={withdrawals} onChange={setWithdrawals} label="Withdrawals enabled" />
        </div>
        <p className="text-[12px] text-faint">Slug <span className="font-mono text-muted">/{site.slug}</span> is permanent. Game config is shared across all brands.</p>
        {err && <div className="flex items-center gap-2 text-[13px] text-down"><AlertCircle size={14} /> {err}</div>}
      </form>
    </Modal>
  );
}
