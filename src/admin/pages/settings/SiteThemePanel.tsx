import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { errMsg } from '../../../lib/errors';
import { useAdmin } from '../../roleContext';
import { Spin } from '../../components/Spin';
import { planeSrcFor } from '../../../hooks/useSiteTheme';
import { Check, Palette } from 'lucide-react';

// ============================================================================
// SiteThemePanel — super-admin per-site theme + plane-skin picker.
// Borrows invest254's ThemeGallery idea: a curated set of plane skins rendered
// live, applied in one click via admin_set_site_theme (audited). Palette tokens
// come from a small curated theme set; semantic win/loss hues stay fixed.
// ============================================================================

interface SiteRow { id: string; slug: string; name: string; plane_skin: string | null; color_primary: string | null; }

const PLANE_SKINS: { id: string; label: string; blurb: string }[] = [
  { id: 'crimson', label: 'Crimson Jet',  blurb: 'The classic red fighter — default.' },
  { id: 'gold',    label: 'Gold Executive', blurb: 'White & gold private jet — premium feel.' },
  { id: 'rocket',  label: 'Rocket',       blurb: 'Cyan retro rocket — playful, high-energy.' },
  { id: 'prop',    label: 'Vintage Prop', blurb: 'Sunset-orange prop plane — nostalgic.' },
];

// Curated brand palettes (seed → identity tokens). Neutral chrome + semantic
// up/down stay fixed so a falling round is always red. Mirrors derivePalette.
const THEMES: { id: string; label: string; tokens: Record<string, string> }[] = [
  { id: 'aviator-red',  label: 'Aviator Red',  tokens: { brand: '#e8123c', accent: '#ff5d7e', bg: '#0d0d1a', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
  { id: 'exec-gold',    label: 'Executive Gold', tokens: { brand: '#e0a80b', accent: '#f3c94b', bg: '#0b0f14', surface: '#141b24', border: '#26303c', fg: '#e6eaf0', muted: '#9aa6b2' } },
  { id: 'rocket-cyan',  label: 'Rocket Cyan',  tokens: { brand: '#06b6d4', accent: '#38e0f5', bg: '#0a0a14', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
  { id: 'sunset-orange',label: 'Sunset Orange', tokens: { brand: '#f97316', accent: '#fb9c4b', bg: '#0d0d1a', surface: '#11111f', border: '#2a2a45', fg: '#e2e8f0', muted: '#9aa6b2' } },
];

export default function SiteThemePanel() {
  const { isSuperAdmin } = useAdmin();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [skin, setSkin] = useState<string>('crimson');
  const [theme, setTheme] = useState<string>('aviator-red');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('sites').select('id, slug, name, plane_skin, color_primary').order('created_at', { ascending: true });
    if (!error && data) {
      setSites(data as SiteRow[]);
      if (!sel && data.length) { setSel(data[0].id); setSkin(data[0].plane_skin ?? 'crimson'); }
    }
  }, [sel]);

  useEffect(() => { void load(); }, [load]);

  const current = sites.find((s) => s.id === sel) ?? null;

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
      setMsg(`Applied ${skin} + ${theme} to ${current.name}. Live on next load.`);
      await load();
    } catch (e) { setErr(errMsg(e, 'Apply failed')); }
    finally { setSaving(false); }
  }

  if (!isSuperAdmin) {
    return <div className="rounded-xl border border-line bg-surface px-5 py-4 text-[13px] text-muted">Only a super admin can change site theme & plane.</div>;
  }

  return (
    <div className="rounded-2xl border border-line bg-surface overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line bg-white/[0.02] flex items-center gap-2">
        <Palette size={14} className="text-brand" />
        <span className="text-[13px] font-semibold text-ink">Site theme & plane</span>
      </div>
      <div className="p-5 space-y-5">
        {/* site selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[12px] text-muted">Site</label>
          <select value={sel ?? ''} onChange={(e) => { const s = sites.find((x) => x.id === e.target.value); setSel(e.target.value); setSkin(s?.plane_skin ?? 'crimson'); }}
            className="px-3 py-2 bg-canvas border border-line rounded-lg text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>)}
          </select>
          {msg && <span className="text-[12px] text-up">{msg}</span>}
          {err && <span className="text-[12px] text-down">{err}</span>}
        </div>

        {/* plane skins */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2.5">Plane</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLANE_SKINS.map((p) => (
              <button key={p.id} onClick={() => setSkin(p.id)}
                className={'rounded-xl border p-3 text-left transition ' + (skin === p.id ? 'border-brand bg-brand/[0.06]' : 'border-line bg-canvas hover:border-brand/40')}>
                <div className="h-16 flex items-center justify-center rounded-lg bg-[#111118] mb-2 overflow-hidden">
                  <img src={planeSrcFor(p.id)} alt={p.label} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex items-center gap-1.5">
                  {skin === p.id && <Check size={13} className="text-brand" />}
                  <span className="text-[12px] font-semibold text-ink">{p.label}</span>
                </div>
                <div className="text-[10px] text-faint mt-0.5">{p.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {/* palettes */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2.5">Palette</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)}
                className={'rounded-xl border p-3 text-left transition ' + (theme === t.id ? 'border-brand bg-brand/[0.06]' : 'border-line bg-canvas hover:border-brand/40')}>
                <div className="flex gap-1 mb-2">
                  {[t.tokens.bg, t.tokens.surface, t.tokens.brand, t.tokens.accent].map((c) => (
                    <span key={c} className="h-4 flex-1 rounded" style={{ background: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {theme === t.id && <Check size={13} className="text-brand" />}
                  <span className="text-[12px] font-semibold text-ink">{t.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={apply} disabled={saving || !current}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-lg transition-colors disabled:opacity-40">
            {saving && <Spin />}Apply to {current?.name ?? 'site'}
          </button>
        </div>
      </div>
    </div>
  );
}
