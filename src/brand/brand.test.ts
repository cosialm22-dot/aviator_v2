import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, readableInk } from './color';
import { CLASSIC_TOKENS, COLOR_TOKENS, completeTokens, derivePalette, tokensToCssVars } from './tokens';
import { BRAND_FONTS, googleFontsHref } from './fonts';
import { BRAND_LOOKS, lookToConfig } from './themes';
import { PLANES, PLANE_MODELS, planeSvg } from './planes';
import { SEED_PRESETS } from './presets';
import { BRAND_SETTING_DEFAULTS, BRAND_SETTING_OPTIONS, SERVER_FONTS } from './settings.generated';
import { BIRD_MAP } from '../components/game/birds';
import { canvasThemeFor } from '../components/game/canvasTheme';
import { parsePaymentConfig } from '../lib/megapayClient';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const rootVars = Array.from(css.match(/:root\s*{([^}]*)}/)![1].matchAll(/(--[a-z0-9-]+)\s*:/g)).map((m) => m[1]);

describe('theme tokens → CSS variables', () => {
  it('a brand theme sets every variable the classic :root defines (nothing stays un-themed)', () => {
    const vars = tokensToCssVars(derivePalette('#8b5cf6'));
    for (const v of rootVars) expect(Object.keys(vars), v).toContain(v);
  });
  it('colours are "r g b" triplets, fonts are stacks', () => {
    const vars = tokensToCssVars(CLASSIC_TOKENS);
    expect(vars['--g-bg']).toBe('14 14 14');
    expect(vars['--g-cta']).toBe('40 169 9');
    expect(vars['--font-body']).toMatch(/^"Inter", /);
  });
  it('completeTokens drops invalid values and fills from classic', () => {
    const t = completeTokens({ bg: 'red', brand: '#ABCDEF', fontTitle: 'Comic Sans', radius: '99px' });
    expect(t.bg).toBe(CLASSIC_TOKENS.bg);
    expect(t.brand).toBe('#abcdef');
    expect(t.fontTitle).toBe(CLASSIC_TOKENS.fontTitle);
    expect(t.radius).toBe(CLASSIC_TOKENS.radius);
  });
  it('the call-to-action ink is readable on every seed', () => {
    for (const p of SEED_PRESETS) {
      const t = derivePalette(p.seed);
      expect(contrast(t.brand, readableInk(t.brand)), p.label).toBeGreaterThanOrEqual(4.3);
      expect(contrast(t.fg, t.bg), p.label).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('brand looks', () => {
  it('24 complete, distinct looks', () => {
    expect(BRAND_LOOKS.length).toBe(24);
    expect(new Set(BRAND_LOOKS.map((l) => l.id)).size).toBe(24);
    expect(new Set(BRAND_LOOKS.map((l) => l.tokens.brand)).size).toBeGreaterThanOrEqual(22);
  });
  it('every look passes the server rules (colours, fonts, enums, birds, planes)', () => {
    for (const l of BRAND_LOOKS) {
      for (const k of COLOR_TOKENS) expect(l.tokens[k], `${l.id}.${k}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const f of [l.tokens.fontTitle, l.tokens.fontBody, l.tokens.fontMono]) expect(SERVER_FONTS, `${l.id} font ${f}`).toContain(f);
      const cfg = lookToConfig(l);
      for (const [k, v] of Object.entries(cfg)) {
        const opts = BRAND_SETTING_OPTIONS[k as keyof typeof BRAND_SETTING_OPTIONS];
        if (opts) expect(opts, `${l.id} ${k}=${v}`).toContain(v);
        if (typeof v === 'string' && v.startsWith('#')) expect(v, `${l.id} ${k}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(BIRD_MAP[l.bird], l.id).toBeTruthy();
      expect(contrast(l.tokens.fg, l.tokens.bg), `${l.id} text contrast`).toBeGreaterThanOrEqual(10);
      expect(contrast(l.tokens.brand, readableInk(l.tokens.brand)), `${l.id} CTA ink`).toBeGreaterThanOrEqual(4.3);
    }
  });
  it('the classic look reproduces the reference canvas exactly', () => {
    const t = canvasThemeFor(null, null);
    expect(t.bg).toBe('#0d0d0d');
    expect(t.rayDark).toBe('#101010');
    expect(t.curve).toBe('#e51e3c');
    expect(t.curveDead).toBe('#7a2030');
    expect(t.fillTop).toBe('rgba(229, 30, 60, 0.60)');
    expect(t.wait).toBe('#e8123c');
    expect(t.flewAway).toBe('FLEW AWAY!');
    expect(t.plane.model).toBe('classic');
  });
  it('streamer mode can use its own flight-line colour', () => {
    const cfg = { ...BRAND_SETTING_DEFAULTS, 'stream.curve': '#38bdf8' };
    expect(canvasThemeFor(cfg, {}, true).curve).toBe('#38bdf8');
    expect(canvasThemeFor(cfg, {}, false).curve).toBe('#e51e3c');
  });
});

describe('fonts', () => {
  it('the web app and the server accept the same fonts', () => {
    expect([...BRAND_FONTS].sort()).toEqual([...SERVER_FONTS].sort());
  });
  it('builds one Google Fonts URL with only published weights', () => {
    const u = googleFontsHref(['Bebas Neue', 'Poppins', 'Poppins', 'Nope']);
    expect(u).toBe('https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&family=Poppins:wght@400;500;600;700;800&display=swap');
    expect(googleFontsHref([])).toBe('');
  });
});

describe('plane library', () => {
  it('every model the server offers has a renderer (classic = sprite, custom = upload)', () => {
    const server = BRAND_SETTING_OPTIONS['plane.model']!;
    expect(PLANE_MODELS.map((m) => m.id).sort()).toEqual([...server].sort());
    for (const p of PLANES) {
      expect(p.body.length + p.accent.length).toBeGreaterThan(1);
      for (const d of [...p.body, ...p.accent, ...p.canopy, ...p.shade]) expect(d).toMatch(/^M[\d.\s\-a-zA-Z]+$/);
    }
  });
  it('renders an SVG with the brand colours baked in', () => {
    const svg = planeSvg('jet', { body: '#123456', accent: '#abcdef', canopy: '#ffffff' }, { idSuffix: 't' });
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg).toContain('url(#b-t)');
    expect(svg.match(/<path/g)!.length).toBe(PLANES[0].body.length + PLANES[0].accent.length + PLANES[0].canopy.length + PLANES[0].shade.length);
  });
});

describe('payment config from the brand', () => {
  it('chips and the starting bet are clamped into the brand limits', () => {
    const c = parsePaymentConfig({ min_bet: 100, max_bet: 1000, bet_chips: [50, 200, 500, 5000], default_bet: 20, deposits: false });
    expect(c.betChips).toEqual([100, 200, 500, 1000]);
    expect(c.defaultBet).toBe(100);
    expect(c.depositsOpen).toBe(false);
    expect(c.withdrawalsOpen).toBe(true);
  });
  it('deposit chips outside the limits are dropped', () => {
    const c = parsePaymentConfig({ min_deposit: 200, max_deposit: 1000, deposit_chips: [100, 200, 500, 2000] });
    expect(c.depositChips).toEqual([200, 500]);
  });
});
