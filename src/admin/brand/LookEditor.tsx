import { useMemo, useState } from 'react';
import { Check, Wand2 } from 'lucide-react';
import { Card, Notice } from '../ui/kit';
import { BRAND_LOOKS, lookToConfig, type BrandLook } from '../../brand/themes';
import { SEED_PRESETS } from '../../brand/presets';
import { CLASSIC_TOKENS, completeTokens, derivePalette, type ThemeTokens } from '../../brand/tokens';
import { contrast, readableInk } from '../../brand/color';
import PlaneMark from '../../components/brand/PlaneMark';
import { SettingsGrid } from './SettingField';
import type { BrandDraft } from './useBrandDraft';
import type { Json } from './api';

// Look: pick a complete look from the gallery, or start from one colour, then fine-tune every
// token, the type and the game screen. Everything lands in the page's draft (saved together).

const GROUPS: { title: string; keys: (keyof ThemeTokens)[] }[] = [
  { title: 'Surfaces', keys: ['bg', 'surface', 'surface2', 'border'] },
  { title: 'Text', keys: ['fg', 'muted'] },
  { title: 'Brand', keys: ['brand', 'brandHover', 'brandText', 'accent', 'accentFg'] },
  { title: 'Signals', keys: ['up', 'down', 'warn', 'info'] },
];
const LABEL: Record<string, string> = {
  bg: 'Background', surface: 'Panels', surface2: 'Controls', border: 'Lines', fg: 'Text', muted: 'Secondary text',
  brand: 'Call to action', brandHover: 'Call to action (pressed)', brandText: 'Brand text', accent: 'Accent', accentFg: 'Text on accent',
  up: 'Money won', down: 'Cancel / loss', warn: 'Cash out', info: 'Info',
};

function LookCard({ look, current, onApply, disabled }: { look: BrandLook; current: boolean; onApply: () => void; disabled: boolean }) {
  const t = look.tokens;
  return (
    <button type="button" onClick={onApply} disabled={disabled} data-testid={`look-${look.id}`} aria-pressed={current}
      className={`group relative overflow-hidden rounded-xl text-left ring-1 transition disabled:cursor-not-allowed ${current ? 'ring-2 ring-brand' : 'ring-white/[0.08] hover:ring-white/25'}`}
      style={{ background: t.bg }}>
      <div className="flex items-center gap-1.5 px-2.5 pt-2.5">
        <PlaneMark model={look.plane.model} body={look.plane.body} accent={look.plane.accent} canopy={look.plane.canopy} width={30} className="-rotate-12" />
        <span className="truncate text-[12px]" style={{ color: t.accent === '#ffffff' ? t.fg : t.accent, fontFamily: `"${t.fontTitle}", Inter, sans-serif`, fontWeight: Number(t.headingWeight) }}>{look.label}</span>
      </div>
      <div className="mx-2.5 my-2 h-8 overflow-hidden rounded-md" style={{ background: look.canvas.bg }}>
        <svg viewBox="0 0 100 32" className="h-full w-full" preserveAspectRatio="none" aria-hidden><path d="M0 32 C35 31 60 22 72 8" fill="none" stroke={look.canvas.curve} strokeWidth="2.2" /></svg>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
        <span className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ background: t.brand, color: readableInk(t.brand), borderRadius: t.radius }}>Bet</span>
        <span className="h-3 flex-1 rounded-sm" style={{ background: t.surface }} />
        <span className="h-3 w-3 rounded-full" style={{ background: t.up }} />
      </div>
      {current && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand text-white"><Check size={12} strokeWidth={3} /></span>}
    </button>
  );
}

export default function LookEditor({ draft }: { draft: BrandDraft }) {
  const editable = !!draft.doc?.can.platform;
  const tokens = useMemo(() => completeTokens(draft.tokens), [draft.tokens]);
  const [seed, setSeed] = useState('#8b5cf6');
  const current = String(draft.value('look.theme_id') ?? (Object.keys(draft.tokens).length ? '' : 'classic'));

  const applyLook = (l: BrandLook) => {
    draft.setTokens(l.id === 'classic' ? {} : { ...l.tokens });
    draft.setMany(lookToConfig(l) as Record<string, Json>);
  };
  const applySeed = (hex: string, fontTitle?: string, fontBody?: string) => {
    const t = derivePalette(hex);
    draft.setTokens({ ...t, ...(fontTitle ? { fontTitle } : {}), ...(fontBody ? { fontBody } : {}) } as unknown as Record<string, string>);
    draft.setMany({ 'look.theme_id': null, 'look.curve': t.brand, 'look.wait_bar': t.brand, 'plane.body': t.brand, 'plane.accent': t.brandHover });
  };
  const setTok = (k: string, v: string) => draft.setTokens({ ...(Object.keys(draft.tokens).length ? draft.tokens : (CLASSIC_TOKENS as unknown as Record<string, string>)), [k]: v });

  const textContrast = contrast(tokens.fg, tokens.bg);
  const ctaContrast = contrast(tokens.brand, readableInk(tokens.brand));

  return (
    <div className="space-y-5">
      {!editable && <Notice tone="info">The look is set by the platform. You can edit the brand's words, contacts and legal pages.</Notice>}
      <Card title="Looks" action={<span className="text-[12px] text-muted">{BRAND_LOOKS.length} complete identities</span>}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {BRAND_LOOKS.map((l) => <LookCard key={l.id} look={l} current={current === l.id} onApply={() => applyLook(l)} disabled={!editable} />)}
        </div>
      </Card>

      <Card title="Start from one colour">
        <div className="flex flex-wrap items-center gap-2">
          {SEED_PRESETS.map((p) => (
            <button key={p.seed} type="button" disabled={!editable} onClick={() => applySeed(p.seed, p.fontTitle, p.fontBody)} title={p.label} aria-label={`Colour ${p.label}`}
              className="h-7 w-7 rounded-full ring-1 ring-white/15 transition hover:scale-110 disabled:opacity-40" style={{ background: p.seed }} />
          ))}
          <span className="mx-1 h-6 w-px bg-line" />
          <input type="color" value={seed} onChange={(e) => setSeed(e.target.value)} disabled={!editable} aria-label="Seed colour" className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-raised p-1" />
          <button type="button" disabled={!editable} onClick={() => applySeed(seed)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-raised px-3 text-[13px] font-medium text-ink hover:bg-white/[0.1] disabled:opacity-40">
            <Wand2 size={14} />Build palette
          </button>
        </div>
      </Card>

      <Card title="Colours">
        {(textContrast < 7 || ctaContrast < 4.5) && (
          <div className="mb-3"><Notice tone="warn">
            {textContrast < 7 && <>Text on the background is {textContrast.toFixed(1)}:1 — aim for 7:1 or more. </>}
            {ctaContrast < 4.5 && <>The call-to-action text is {ctaContrast.toFixed(1)}:1 — pick a lighter or darker call-to-action colour.</>}
          </Notice></div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint">{g.title}</div>
              <div className="space-y-1.5">
                {g.keys.map((k) => (
                  <label key={k} className="flex items-center gap-2.5">
                    <input type="color" value={tokens[k] as string} disabled={!editable} onChange={(e) => setTok(k, e.target.value)} aria-label={LABEL[k]}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border-0 bg-raised p-1 disabled:cursor-not-allowed" data-testid={`token-${k}`} />
                    <span className="flex-1 text-[13px] text-ink">{LABEL[k]}</span>
                    <span className="font-mono text-[12px] uppercase text-faint">{tokens[k] as string}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Type & shape">
        <div className="grid gap-4 sm:grid-cols-3">
          {(['fontTitle', 'fontBody', 'fontMono'] as const).map((k) => (
            <label key={k} className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">{k === 'fontTitle' ? 'Titles & wordmark' : k === 'fontBody' ? 'Body' : 'Numbers'}</span>
              <select value={tokens[k]} disabled={!editable} onChange={(e) => setTok(k, e.target.value)} aria-label={k}
                className="h-9 w-full rounded-lg bg-raised px-3 text-[13px] text-ink focus:outline-none" style={{ fontFamily: `"${tokens[k]}", Inter` }}>
                {(draft.schema?.fonts ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          ))}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Title weight</span>
            <select value={tokens.headingWeight} disabled={!editable} onChange={(e) => setTok('headingWeight', e.target.value)} aria-label="Title weight"
              className="h-9 w-full rounded-lg bg-raised px-3 text-[13px] text-ink focus:outline-none">
              {['400', '500', '600', '700', '800', '900'].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 flex justify-between text-[13px] font-medium text-ink"><span>Corner radius</span><span className="tabular-nums text-faint">{tokens.radius}</span></span>
            <input type="range" min={0} max={24} value={parseInt(tokens.radius, 10)} disabled={!editable} onChange={(e) => setTok('radius', `${e.target.value}px`)} aria-label="Corner radius" className="w-full accent-[#0a84ff]" />
          </label>
        </div>
      </Card>

      <Card title="Game screen">
        <SettingsGrid draft={draft} sections={['look']} keys={(draft.schema?.settings ?? []).filter((s) => s.section === 'look' && s.key !== 'look.theme_id').map((s) => s.key)} />
      </Card>
    </div>
  );
}
