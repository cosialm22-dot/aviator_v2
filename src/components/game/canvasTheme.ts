// The game canvas palette, derived from the brand's look.* / plane.* / stream.* settings and theme
// fonts. Defaults reproduce the reference look exactly. Pure (unit-tested in canvasTheme.test.ts).
import { isHex, mix, rgba, type Hex } from '../../brand/color';
import { BRAND_SETTING_DEFAULTS, type BrandSettings } from '../../brand/settings.generated';
import { isBrandFont } from '../../brand/fonts';
import type { PlaneColors } from '../../brand/planes';

export interface CanvasTheme {
  style: BrandSettings['look.canvas_style'];
  bg: string; bgFade: string; ray: string; rayDark: string;
  curve: string; curveDead: string; glow1: string; glow2: string;
  fillTop: string; fillBottom: string; fillDeadTop: string; fillDeadBottom: string;
  wait: string; waitClear: string; multiplier: string; crash: string; crashGlow: string;
  glow: boolean; flewAway: string; font: string; weight: string;
  plane: { model: string; colors: PlaneColors; image: string | null; scale: number; exhaust: boolean };
}

const hex = (v: unknown, d: Hex): Hex => (isHex(v) ? v : d);
let last: { cfg: unknown; tokens: unknown; streamer: boolean; theme: CanvasTheme } | null = null;

export function canvasThemeFor(cfg: BrandSettings | null, tokens: Record<string, unknown> | null, streamer = false): CanvasTheme {
  if (last && last.cfg === cfg && last.tokens === tokens && last.streamer === streamer) return last.theme;
  const c = cfg ?? BRAND_SETTING_DEFAULTS;
  const d = BRAND_SETTING_DEFAULTS;
  const bg = hex(c['look.canvas_bg'], d['look.canvas_bg']);
  const ray = hex(c['look.canvas_ray'], d['look.canvas_ray']);
  const curve = hex(streamer && c['stream.curve'] ? c['stream.curve'] : c['look.curve'], d['look.curve']);
  const crash = hex(c['look.crash'], d['look.crash']);
  const wait = hex(c['look.wait_bar'], d['look.wait_bar']);
  const classicCurve = curve.toLowerCase() === '#e51e3c';
  const font = tokens && isBrandFont(tokens.fontTitle) ? `"${tokens.fontTitle}", Inter, "Arial Black", Arial, sans-serif` : 'Inter, "Arial Black", Arial, sans-serif';
  const theme: CanvasTheme = {
    style: c['look.canvas_style'] ?? 'sunburst',
    bg, bgFade: rgba(bg, 0.85), ray,
    // the darker of the two alternating wedges (#101010 in the reference look)
    rayDark: mix(bg, ray, 0.2),
    curve,
    curveDead: classicCurve ? '#7a2030' : mix(curve, bg, 0.55),
    glow1: rgba(curve, 0.22), glow2: rgba(curve, 0.35),
    fillTop: classicCurve ? 'rgba(229, 30, 60, 0.60)' : rgba(curve, 0.6),
    fillBottom: classicCurve ? 'rgba(140, 10, 32, 0.28)' : rgba(mix(curve, '#000000', 0.4), 0.28),
    fillDeadTop: classicCurve ? 'rgba(120, 16, 34, 0.38)' : rgba(mix(curve, '#000000', 0.5), 0.38),
    fillDeadBottom: classicCurve ? 'rgba(60, 6, 16, 0.20)' : rgba(mix(curve, '#000000', 0.75), 0.2),
    wait, waitClear: rgba(wait, 0),
    multiplier: hex(c['look.multiplier'], d['look.multiplier']),
    crash, crashGlow: rgba(crash, 0.55),
    glow: c['look.glow'] !== false,
    flewAway: (c['copy.flew_away'] || d['copy.flew_away']).slice(0, 24),
    font,
    weight: tokens && typeof tokens.headingWeight === 'string' && /^[4-9]00$/.test(tokens.headingWeight) ? tokens.headingWeight : '800',
    plane: {
      model: c['plane.model'] ?? 'classic',
      colors: { body: hex(c['plane.body'], d['plane.body']), accent: hex(c['plane.accent'], d['plane.accent']), canopy: hex(c['plane.canopy'], d['plane.canopy']) },
      image: c['plane.image_url'] ?? null,
      scale: Math.min(1.5, Math.max(0.7, Number(c['plane.scale']) || 1)),
      exhaust: c['plane.exhaust'] !== false,
    },
  };
  last = { cfg, tokens, streamer, theme };
  return theme;
}
