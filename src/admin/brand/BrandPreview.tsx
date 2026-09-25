import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Plus } from 'lucide-react';
import { tokensToCssVars, completeTokens } from '../../brand/tokens';
import { googleFontsHref } from '../../brand/fonts';
import { drawPlaneModel, PLANE_MAP } from '../../brand/planes';
import { canvasThemeFor } from '../../components/game/canvasTheme';
import { drawSky } from '../../components/game/sky';
import { BIRD_MAP, DEFAULT_BIRD, drawBird } from '../../components/game/birds';
import { BRAND_SETTING_DEFAULTS, type BrandSettings } from '../../brand/settings.generated';
import PlaneMark from '../../components/brand/PlaneMark';
import type { Json } from './api';

// Live phone preview of a brand draft: the real theme variables applied to a scoped container
// (so the same Tailwind classes the player app uses render in the brand's colours), the real sky
// renderer and plane library on a small canvas, and the brand's copy. Toggle to see what a
// marketer streams (bird, no "x").

export function useBrandFonts(tokens: Record<string, string>) {
  useEffect(() => {
    const t = completeTokens(tokens);
    const href = googleFontsHref([t.fontTitle, t.fontBody, t.fontMono]);
    let el = document.getElementById('admin-brand-fonts') as HTMLLinkElement | null;
    if (!href) { el?.remove(); return; }
    if (!el) { el = document.createElement('link'); el.id = 'admin-brand-fonts'; el.rel = 'stylesheet'; document.head.appendChild(el); }
    if (el.href !== href) el.href = href;
  }, [tokens]);
}

export default function BrandPreview({ tokens, value, name, wordmark, logoUrl, width = 300 }: {
  tokens: Record<string, string>; value: (k: string) => Json; name: string; wordmark: string | null; logoUrl: string | null; width?: number;
}) {
  const [stream, setStream] = useState(false);
  useBrandFonts(tokens);
  const vars = useMemo(() => tokensToCssVars(tokens), [tokens]);
  const cfg = useMemo(() => {
    const c: Record<string, Json> = { ...(BRAND_SETTING_DEFAULTS as unknown as Record<string, Json>) };
    for (const k of Object.keys(c)) c[k] = value(k);
    return c as unknown as BrandSettings;
  }, [value]);
  const word = (wordmark && wordmark.trim()) || name;
  const chips = Array.isArray(cfg['limits.bet_chips']) ? cfg['limits.bet_chips'].slice(0, 4) : [50, 100, 200, 500];
  const bet = Number(cfg['limits.default_bet']) || 100;

  return (
    <div className="select-none" data-testid="brand-preview">
      <div className="mx-auto overflow-hidden rounded-[28px] border-[6px] border-[#1c1c1e] shadow-[0_20px_60px_rgba(0,0,0,0.5)]" style={{ width, ...(vars as React.CSSProperties) }}>
        <div className="bg-g-bg text-g-fg" style={{ fontFamily: 'var(--font-body)' }}>
          <div className="flex h-10 items-center justify-between border-b border-g-line bg-g-bar px-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {stream ? (
                <span className="truncate text-[14px] font-extrabold text-g-accent" style={{ fontFamily: 'var(--font-title)' }}>{cfg['stream.show_domain'] ? 'yourbrand.com' : word}</span>
              ) : cfg['look.header_mark'] === 'logo' && logoUrl ? (
                <img src={logoUrl} alt="" className="h-6 w-auto max-w-[120px] object-contain" />
              ) : (
                <>
                  {cfg['look.header_mark'] === 'plane' && <PlaneMark model={cfg['plane.model']} body={cfg['plane.body']} accent={cfg['plane.accent']} canopy={cfg['plane.canopy']} imageUrl={cfg['plane.image_url']} width={28} className="-rotate-12" />}
                  <span className="truncate text-[15px] tracking-tight text-g-accent" style={{ fontFamily: 'var(--font-title)', fontWeight: 'var(--heading-weight)' as unknown as number }}>{word}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="flex h-7 items-center gap-1 rounded-full bg-g-money-bg pl-2 pr-0.5 text-[11px] font-bold tabular-nums text-g-money">1,250.00<span className="grid h-5 w-5 place-items-center rounded-full bg-g-cta text-g-cta-fg"><Plus size={12} strokeWidth={3} /></span></span>
              <Menu size={16} className="text-g-mute" />
            </div>
          </div>
          <div className="space-y-1.5 p-1.5">
            {cfg['copy.announcement'] && !stream && <div className="truncate rounded-lg bg-g-accent/15 px-2 py-1 text-[10px] font-medium">{cfg['copy.announcement']}</div>}
            <PreviewSky cfg={cfg} tokens={tokens} stream={stream} />
            <div className="rounded-xl border border-g-line bg-g-panel p-1.5" style={{ borderRadius: 'calc(var(--brand-radius) + 4px)' }}>
              <div className="mb-1.5 flex justify-center"><div className="flex w-24 rounded-full bg-g-bar p-0.5 text-[10px]"><span className="flex-1 rounded-full bg-g-chip py-0.5 text-center">Bet</span>{cfg['features.autobet'] && <span className="flex-1 py-0.5 text-center text-g-mute">Auto</span>}</div></div>
              <div className="flex gap-1.5">
                <div className="flex w-[46%] flex-col gap-1">
                  <div className="flex h-7 items-center justify-between rounded-full bg-g-inset px-1 text-[12px] font-bold tabular-nums"><span className="grid h-5 w-5 place-items-center rounded-full border border-g-line-hi text-g-text">−</span>{bet}<span className="grid h-5 w-5 place-items-center rounded-full border border-g-line-hi text-g-text">+</span></div>
                  <div className="grid grid-cols-2 gap-1">{chips.map((c) => <span key={c} className="rounded-full bg-g-bar py-0.5 text-center text-[10px] tabular-nums text-g-mute">{c}</span>)}</div>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center border border-g-cta-edge bg-g-cta text-g-cta-fg shadow-[0_0_14px_-4px_rgb(var(--g-cta)/0.8)]" style={{ borderRadius: 'calc(var(--brand-radius) + 4px)' }}>
                  <span className="text-[14px] font-medium leading-tight">{stream ? 'Enter' : 'Bet'}</span>
                  <span className="text-[12px] tabular-nums leading-tight">{bet}{stream ? '' : ' KES'}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-1.5 text-[10px]">
              <span className="flex-1 rounded-lg bg-g-down py-1 text-center font-semibold text-white">Cancel</span>
              <span className="flex-1 rounded-lg bg-g-warn py-1 text-center font-semibold text-white">Cash out</span>
              <span className="flex-1 rounded-lg bg-ios-cta py-1 text-center font-semibold text-ios-cta-fg">Deposit</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-center">
        <div role="tablist" aria-label="Preview as" className="inline-flex rounded-[9px] bg-raised p-[2px] text-[12px]">
          {([['player', 'Player'], ['stream', 'Marketer live']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={(k === 'stream') === stream} onClick={() => setStream(k === 'stream')}
              className={`h-6 rounded-[7px] px-3 font-medium ${(k === 'stream') === stream ? 'bg-[#636366] text-white' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewSky({ cfg, tokens, stream }: { cfg: BrandSettings; tokens: Record<string, string>; stream: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useMemo(() => canvasThemeFor({ ...cfg }, { ...tokens }, stream), [cfg, tokens, stream]);
  const img = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const url = cfg['plane.model'] === 'custom' ? cfg['plane.image_url'] : cfg['plane.model'] === 'classic' ? '/plane.png' : null;
    if (!url) { img.current = null; return; }
    const i = new Image(); i.src = url; img.current = i;
  }, [cfg]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    let raf = 0;
    const frame = () => {
      const now = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky(ctx, W, H, now, theme);
      // a fixed flight at ~1.84x
      const pts: [number, number][] = [];
      for (let i = 0; i <= 40; i++) { const f = i / 40, xn = 0.62 * f; pts.push([xn * W, H - (H * 0.9) * Math.pow(xn, 1.78)]); }
      const grad = ctx.createLinearGradient(0, H * 0.1, 0, H);
      grad.addColorStop(0, theme.fillTop); grad.addColorStop(1, theme.fillBottom);
      ctx.beginPath(); ctx.moveTo(0, H); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(pts[pts.length - 1][0], H); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.strokeStyle = theme.curve; ctx.lineWidth = 2.5; ctx.stroke();
      const [tx, ty] = pts[pts.length - 1]; const [px, py] = pts[pts.length - 3];
      const ang = Math.atan2(ty - py, tx - px);
      const pw = 64 * theme.plane.scale;
      if (stream) {
        drawBird(ctx, BIRD_MAP[String(cfg['stream.bird'])] ?? BIRD_MAP[DEFAULT_BIRD], tx, ty, ang, pw, now);
      } else {
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(Math.max(-0.18, Math.min(0.05, ang * 0.35)));
        const spec = PLANE_MAP[theme.plane.model];
        if (spec) drawPlaneModel(ctx, spec, theme.plane.colors, pw, now, theme.plane.exhaust ? 1 : 0);
        else if (img.current?.complete && img.current.naturalWidth) { const ar = img.current.naturalWidth / img.current.naturalHeight; ctx.drawImage(img.current, -pw / 2, -pw / ar * 0.55, pw, pw / ar); }
        ctx.restore();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${theme.weight} 34px ${theme.font}`; ctx.fillStyle = theme.multiplier;
      ctx.fillText(stream ? '1.84' : '1.84x', W / 2, H * 0.4);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [theme, stream, cfg]);
  return <canvas ref={ref} className="block h-[150px] w-full rounded-xl" aria-label="Game screen preview" />;
}
