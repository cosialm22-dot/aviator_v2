import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import { Badge, Button, Empty, ErrorState, Field, Modal, Notice, PageHeader, Pills, SearchInput, Select, Skeleton, inputCls } from '../ui/kit';
import { kesCompact, num, ROLE_LABEL } from '../ui/format';
import { useAdmin } from '../roleContext';
import { assignMarketer, brandError, createBrand, findUsers, listBrands, listPlatforms, type BrandRow, type FoundUser, type Platform } from '../brand/api';
import { BRAND_LOOKS, lookToConfig } from '../../brand/themes';
import { completeTokens } from '../../brand/tokens';
import { readableInk } from '../../brand/color';
import PlaneMark from '../../components/brand/PlaneMark';
import { PLANE_MAP } from '../../brand/planes';

// ============================================================================
// Brands — every site the platform runs, each drawn in its own colours with its own plane, and the
// "new brand" flow: name → look → marketer → create (then add a domain on the brand's page).
// Brand owners go straight to their own brand.
// ============================================================================

const STATUS_TONE: Record<string, string> = { active: 'up', suspended: 'warn', disabled: 'down' };

function BrandCard({ b, onOpen }: { b: BrandRow; onOpen: () => void }) {
  const t = completeTokens(b.theme_tokens);
  const classic = Object.keys(b.theme_tokens ?? {}).length === 0;
  const model = PLANE_MAP[b.plane_model] ? b.plane_model : 'jet';
  return (
    <button type="button" onClick={onOpen} data-testid={`brand-card-${b.slug}`}
      className="group overflow-hidden rounded-2xl bg-surface text-left ring-1 ring-white/[0.06] transition hover:ring-white/20">
      <div className="flex h-20 items-center gap-2.5 px-4" style={{ background: t.bg }}>
        {b.plane_model === 'classic' ? <img src="/plane.png" alt="" className="h-5 -rotate-12" /> : <PlaneMark model={model} body={t.brand} accent={t.brandHover} canopy="#dbeafe" width={44} className="-rotate-12" />}
        <span className="truncate text-[18px]" style={{ color: classic ? '#e51e3c' : t.accent, fontFamily: classic ? 'Georgia, serif' : `"${t.fontTitle}", Inter, sans-serif`, fontWeight: Number(t.headingWeight), fontStyle: classic ? 'italic' : 'normal' }}>{b.name}</span>
        <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: t.brand, color: readableInk(t.brand) }}>Bet</span>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-muted">{b.primary_domain ?? `?brand=${b.slug}`}</span>
          <span className="ml-auto"><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></span>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-[12px]">
          <div><dt className="text-faint">Players</dt><dd className="tabular-nums text-ink">{num(b.player_count)}</dd></div>
          <div><dt className="text-faint">Deposits</dt><dd className="tabular-nums text-ink">{kesCompact(b.deposit_total)}</dd></div>
          <div><dt className="text-faint">GGR</dt><dd className={`tabular-nums ${b.ggr >= 0 ? 'text-up' : 'text-down'}`}>{kesCompact(b.ggr)}</dd></div>
        </dl>
        <div className="truncate text-[12px] text-faint">{b.default_marketer_username ? `Marketer: ${b.default_marketer_username}` : 'No marketer yet'}</div>
      </div>
    </button>
  );
}

export default function BrandsPage() {
  const me = useAdmin();
  const navigate = useNavigate();
  const [rows, setRows] = useState<BrandRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended' | 'disabled'>('all');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => { setErr(null); try { setRows(await listBrands()); } catch (e) { setErr(brandError(e)); } }, []);
  useEffect(() => { if (me.isPlatformTier) void load(); }, [load, me.isPlatformTier]);
  const shown = useMemo(() => (rows ?? []).filter((b) => (status === 'all' || b.status === status)
    && (!q.trim() || [b.name, b.slug, b.primary_domain, b.default_marketer_username].some((x) => (x ?? '').toLowerCase().includes(q.trim().toLowerCase())))), [rows, q, status]);

  if (!me.isPlatformTier) return me.siteId ? <Navigate to={`/admin/brands/${me.siteId}`} replace /> : <Navigate to="/admin" replace />;

  return (
    <div className="space-y-5">
      <PageHeader title="Brands" subtitle="Every site you run — each with its own look, plane, marketer, limits and domain."
        actions={<Button variant="primary" onClick={() => setCreating(true)} data-testid="new-brand"><Plus size={14} />New brand</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search brands, domains, marketers" label="Search brands" className="min-w-[240px] flex-1 sm:max-w-sm" />
        <Pills label="Status" value={status} onChange={setStatus} items={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'disabled', label: 'Disabled' }]} />
      </div>
      {err ? <ErrorState message={err} onRetry={load} />
        : !rows ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full rounded-2xl" />)}</div>
        : shown.length === 0 ? <Empty title={rows.length ? 'No brand matches' : 'No brands yet'} body={rows.length ? 'Try another search.' : 'Create the first brand for a marketer.'} />
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map((b) => <BrandCard key={b.site_id} b={b} onOpen={() => navigate(`/admin/brands/${b.site_id}`)} />)}</div>}
      {creating && <NewBrand onClose={() => setCreating(false)} onCreated={(id) => navigate(`/admin/brands/${id}?tab=domains`)} />}
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function NewBrand({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const me = useAdmin();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [platform, setPlatform] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [look, setLook] = useState(BRAND_LOOKS[1].id);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<FoundUser[]>([]);
  const [marketer, setMarketer] = useState<FoundUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (me.isPlatform) listPlatforms().then(setPlatforms).catch(() => {}); }, [me.isPlatform]);
  useEffect(() => { if (!slugTouched) setSlug(slugify(name)); }, [name, slugTouched]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { findUsers(q).then((r) => { if (live) setFound(r); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const slugOk = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
  const steps = ['Name', 'Look', 'Marketer'];
  const chosen = BRAND_LOOKS.find((l) => l.id === look)!;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createBrand({ slug, name: name.trim(), platform: platform || null,
        tokens: chosen.id === 'classic' ? null : { ...chosen.tokens } as unknown as Record<string, string>, config: lookToConfig(chosen) });
      if (marketer) {
        try { await assignMarketer(r.site_id, marketer.id); }
        catch (e) { setErr(`Brand created, but the marketer was not assigned: ${brandError(e)}`); setBusy(false); setTimeout(() => onCreated(r.site_id), 1800); return; }
      }
      onCreated(r.site_id);
    } catch (e) { setErr(brandError(e)); setBusy(false); }
  };

  return (
    <Modal title="New brand" subtitle={`Step ${step + 1} of ${steps.length} · ${steps[step]}`} onClose={onClose} width={760}
      footer={<>
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < steps.length - 1
          ? <Button variant="primary" disabled={step === 0 && (!name.trim() || !slugOk)} onClick={() => setStep(step + 1)} data-testid="wizard-next">Next</Button>
          : <Button variant="primary" loading={busy} onClick={create} data-testid="wizard-create">Create brand</Button>}
      </>}>
      {err && <Notice tone="error">{err}</Notice>}
      {step === 0 && (
        <div className="space-y-4">
          <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="e.g. Jet Kenya" data-testid="wizard-name" autoFocus /></Field>
          <Field label="Address name" hint={slugOk ? `Preview at ?brand=${slug}` : '3–40 lowercase letters, numbers or hyphens.'}>
            <input value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} maxLength={40} className={`${inputCls} font-mono`} data-testid="wizard-slug" />
          </Field>
          {me.isPlatform && (
            <Field label="Platform" hint="Who runs it. The System runs brands with no platform.">
              <Select value={platform} onChange={setPlatform} label="Platform" className="w-full" options={[{ value: '', label: 'System (no platform)' }, ...platforms.map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
          )}
        </div>
      )}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BRAND_LOOKS.map((l) => (
            <button key={l.id} type="button" onClick={() => setLook(l.id)} aria-pressed={look === l.id} data-testid={`wizard-look-${l.id}`}
              className={`relative overflow-hidden rounded-xl p-2.5 text-left ring-1 ${look === l.id ? 'ring-2 ring-brand' : 'ring-white/[0.08] hover:ring-white/25'}`} style={{ background: l.tokens.bg }}>
              <PlaneMark model={l.plane.model} body={l.plane.body} accent={l.plane.accent} canopy={l.plane.canopy} width={40} className="-rotate-12" />
              <div className="mt-1 truncate text-[12px]" style={{ color: l.tokens.fg, fontFamily: `"${l.tokens.fontTitle}", Inter` }}>{l.label}</div>
              <span className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: l.tokens.brand, color: readableInk(l.tokens.brand) }}>Bet</span>
              {look === l.id && <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-brand text-white"><Check size={10} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">The marketer who owns this site's audience. Players who arrive without a referral link are credited to them. You can add one later.</p>
          <SearchInput value={q} onChange={setQ} placeholder="Find a marketer or player by name or phone" label="Find marketer" />
          <ul className="max-h-60 divide-y divide-line/60 overflow-y-auto">
            {found.map((u) => {
              const blocked = !['marketer', 'player'].includes(u.role) || !!u.owns_brand;
              return (
                <li key={u.id}>
                  <button type="button" disabled={blocked} onClick={() => setMarketer(u)} aria-pressed={marketer?.id === u.id}
                    className={`flex w-full items-center gap-3 px-1 py-2 text-left disabled:opacity-40 ${marketer?.id === u.id ? 'text-brand' : 'text-ink'}`}>
                    <span className="min-w-0 flex-1 text-[13px]">{u.username} <Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></span>
                    <span className="text-[12px] text-faint">{u.owns_brand ? `owns ${u.owns_brand}` : u.site_name}</span>
                    {marketer?.id === u.id && <Check size={14} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {marketer && <Notice tone="ok">{marketer.username} will own this brand's audience.</Notice>}
        </div>
      )}
    </Modal>
  );
}
