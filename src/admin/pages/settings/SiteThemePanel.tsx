import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { errMsg } from '../../../lib/errors';
import { useAdmin } from '../../roleContext';
import { Button, Card, SearchInput, Select } from '../../ui/kit';
import BirdMark from '../../../components/game/BirdMark';
import { BIRDS } from '../../../components/game/birds';
import { Check } from 'lucide-react';

// ============================================================================
// SiteThemePanel — super-admin per-site theme + BIRD picker. Twenty curated,
// procedurally-animated species rendered LIVE (flapping) so the owner sees the
// exact bird in motion before applying. Applied via admin_set_site_theme
// (audited). Palette tokens come from a curated set; win/loss hues stay fixed.
// ============================================================================

interface SiteRow { id: string; slug: string; name: string; plane_skin: string | null; color_primary: string | null; }

const THEMES: { id: string; label: string; tokens: Record<string, string> }[] = [
  { id: 'aviator-red',  label: 'Aviator Red',   tokens: { brand: '#e8123c', accent: '#ff5d7e', bg: '#0d0d1a', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
  { id: 'exec-gold',    label: 'Executive Gold', tokens: { brand: '#e0a80b', accent: '#f3c94b', bg: '#0b0f14', surface: '#141b24', border: '#26303c', fg: '#e6eaf0', muted: '#9aa6b2' } },
  { id: 'rocket-cyan',  label: 'Rocket Cyan',   tokens: { brand: '#06b6d4', accent: '#38e0f5', bg: '#0a0a14', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
  { id: 'sunset-orange',label: 'Sunset Orange', tokens: { brand: '#f97316', accent: '#fb9c4b', bg: '#0d0d1a', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
];

const ARCH_LABEL: Record<string, string> = { swift: 'Swift', soar: 'Soaring', song: 'Songbird', exotic: 'Exotic' };

export default function SiteThemePanel() {
  const { isSuperAdmin, isPlatform, siteId: ownSite } = useAdmin();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [skin, setSkin] = useState<string>('fisheagle');
  const [theme, setTheme] = useState<string>('aviator-red');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('sites').select('id, slug, name, plane_skin, color_primary').order('created_at', { ascending: true });
    if (error) { setErr('Could not load brands.'); return; }
    // A brand owner themes only their own brand (the server enforces this too).
    const mine = ((data ?? []) as SiteRow[]).filter((s) => isPlatform || s.id === ownSite);
    setSites(mine);
    if (!sel && mine.length) { setSel(mine[0].id); setSkin(mine[0].plane_skin ?? 'fisheagle'); }
  }, [sel, isPlatform, ownSite]);

  useEffect(() => { void load(); }, [load]);

  const current = sites.find((s) => s.id === sel) ?? null;
  const list = q.trim() ? BIRDS.filter((b) => b.label.toLowerCase().includes(q.toLowerCase()) || b.id.includes(q.toLowerCase())) : BIRDS;

  async function apply() {
    if (!current) return;
    setSaving(true); setErr(null); setMsg(null);
    const tokens = THEMES.find((t) => t.id === theme)?.tokens ?? null;
    try {
      const { error } = await supabase.rpc('admin_set_site_theme', {
        p_site_id: current.id,
        p_theme_tokens: tokens,
        p_plane_skin: skin,
      });
      if (error) throw error;
      const bird = BIRDS.find((b) => b.id === skin);
      setMsg(`Applied ${bird?.label ?? skin} + ${theme} to ${current.name}. Live on next load.`);
      await load();
    } catch (e) { setErr(errMsg(e, 'Apply failed')); }
    finally { setSaving(false); }
  }

  if (!isSuperAdmin) {
    return <Card><p className="text-[13px] text-muted">Only a super admin can change site theme & bird.</p></Card>;
  }

  return (
    <Card title="Site theme & bird">
      <div className="space-y-6">
        {/* site selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[13px] font-medium text-muted">Site</label>
          <Select<string> value={sel ?? ''} label="Site"
            onChange={(v) => { const s = sites.find((x) => x.id === v); setSel(v); setSkin(s?.plane_skin ?? 'fisheagle'); }}
            options={sites.map((s) => ({ value: s.id, label: `${s.name} (${s.slug})` }))} />
          {msg && <span className="text-[13px] text-up">{msg}</span>}
          {err && <span className="text-[13px] text-down">{err}</span>}
        </div>

        {/* bird picker */}
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-medium text-muted">Bird · {BIRDS.length} species</div>
            <SearchInput value={q} onChange={setQ} placeholder="Search birds…" label="Search birds" className="w-48 max-w-full" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {list.map((b) => (
              <button key={b.id} onClick={() => setSkin(b.id)} aria-pressed={skin === b.id}
                className={'rounded-xl p-3 text-left transition-colors ' + (skin === b.id ? 'bg-raised ring-2 ring-brand' : 'bg-raised/60 hover:bg-raised')}>
                <div className="mb-2 flex h-16 items-center justify-center overflow-hidden rounded-lg bg-canvas">
                  <BirdMark skin={b.id} width={76} />
                </div>
                <div className="flex items-center gap-1.5">
                  {skin === b.id && <Check size={13} className="text-brand" />}
                  <span className="text-[13px] font-medium leading-tight text-ink">{b.label}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-faint">{ARCH_LABEL[b.archetype]}</div>
              </button>
            ))}
          </div>
        </div>

        {/* palettes */}
        <div>
          <div className="mb-3 text-[13px] font-medium text-muted">Palette</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}
                className={'rounded-xl p-3 text-left transition-colors ' + (theme === t.id ? 'bg-raised ring-2 ring-brand' : 'bg-raised/60 hover:bg-raised')}>
                <div className="mb-2 flex gap-1">
                  {[t.tokens.bg, t.tokens.surface, t.tokens.brand, t.tokens.accent].map((c) => (
                    <span key={c} className="h-4 flex-1 rounded" style={{ background: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {theme === t.id && <Check size={13} className="text-brand" />}
                  <span className="text-[13px] font-medium text-ink">{t.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={apply} disabled={!current} loading={saving}>
            Apply to {current?.name ?? 'site'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
