// ============================================================================
// The theme-token contract (same keys as invest254's sites.theme_tokens) and how an Aviator brand
// maps onto the player UI.
//
// Two layers (invest254 docs/22): the brand owns its IDENTITY (surfaces, text, the call-to-action
// colour, fonts, corner radius); the ACTION colours players rely on stay recognisable — Cancel is
// red (down) and Cash out is amber (warn) on every brand, and money won is green (up).
// ============================================================================
import { darken, isHex, lighten, mix, readableInk, triplet, hexToHsl, hsl, type Hex } from './color';
import { fontStack, isBrandFont } from './fonts';

export interface ThemeTokens {
  bg: Hex; surface: Hex; surface2: Hex; border: Hex; fg: Hex; muted: Hex;
  brand: Hex; brandHover: Hex; brandText: Hex; accent: Hex; accentFg: Hex;
  up: Hex; down: Hex; warn: Hex; info: Hex;
  fontTitle: string; fontBody: string; fontMono: string; headingWeight: string; radius: string;
}
export const COLOR_TOKENS = ['bg', 'surface', 'surface2', 'border', 'fg', 'muted', 'brand', 'brandHover', 'brandText', 'accent', 'accentFg', 'up', 'down', 'warn', 'info'] as const;

/** Today's look. A brand with no tokens renders exactly this. */
export const CLASSIC_TOKENS: ThemeTokens = {
  bg: '#0e0e0e', surface: '#1b1c1d', surface2: '#2c2d30', border: '#2a2b2e', fg: '#ffffff', muted: '#9ea0a3',
  brand: '#28a909', brandHover: '#1f8a3a', brandText: '#5cd334', accent: '#e51e3c', accentFg: '#ffffff',
  up: '#5cd334', down: '#e51e3c', warn: '#d07206', info: '#3480e6',
  fontTitle: 'Inter', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '12px',
};

/** Fill any missing/invalid token from the classic look. */
export function completeTokens(t: Partial<Record<string, string>> | null | undefined): ThemeTokens {
  const out = { ...CLASSIC_TOKENS } as Record<string, string>;
  if (t) for (const [k, v] of Object.entries(t)) {
    if ((COLOR_TOKENS as readonly string[]).includes(k) && isHex(v)) out[k] = v.toLowerCase();
    else if ((k === 'fontTitle' || k === 'fontBody' || k === 'fontMono') && isBrandFont(v)) out[k] = v;
    else if (k === 'headingWeight' && typeof v === 'string' && /^[4-9]00$/.test(v)) out[k] = v;
    else if (k === 'radius' && typeof v === 'string' && /^([0-9]|1[0-9]|2[0-4])px$/.test(v)) out[k] = v;
  }
  return out as unknown as ThemeTokens;
}

/**
 * Derive a full dark palette from ONE seed colour (invest254 deriveMinimalPalette, tuned for a
 * crash game): near-black neutrals tinted a touch toward the seed hue so every brand feels its own,
 * the seed as the call-to-action, fixed semantic up/down/warn/info.
 */
export function derivePalette(seed: Hex): ThemeTokens {
  const [H, S] = hexToHsl(seed);
  const tint = Math.min(0.35, S * 0.4);
  const brand = hsl(H, Math.max(0.55, Math.min(0.9, S)), 0.5);
  const accent = hsl(H, Math.max(0.6, Math.min(0.95, S)), 0.64);
  return {
    bg: hsl(H, tint, 0.045), surface: hsl(H, tint * 0.9, 0.095), surface2: hsl(H, tint * 0.8, 0.15),
    border: hsl(H, tint * 0.7, 0.18), fg: hsl(H, 0.15, 0.97), muted: hsl(H, 0.1, 0.64),
    brand, brandHover: darken(brand, 0.15), brandText: lighten(brand, 0.2), accent, accentFg: readableInk(accent),
    up: '#34d058', down: '#ff4757', warn: '#ff9f0a', info: '#3b82f6',
    fontTitle: 'Inter', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '12px',
  };
}

/**
 * CSS custom properties for a token set. Colours are "r g b" triplets so Tailwind opacity modifiers
 * work (`bg-g-panel/60`). The player game screen reads --g-*, the sheets/pages read --ios-*.
 */
export function tokensToCssVars(input: Partial<Record<string, string>> | null | undefined): Record<string, string> {
  const t = completeTokens(input);
  const ctaInk = readableInk(t.brand);
  const v: Record<string, string> = {
    // game screen
    '--g-bg': triplet(t.bg),
    '--g-bar': triplet(mix(t.bg, t.surface, 0.55)),
    '--g-panel': triplet(t.surface),
    '--g-inset': triplet(mix(t.bg, '#000000', 0.15)),
    '--g-chip': triplet(t.surface2),
    '--g-chip-hi': triplet(mix(t.surface2, t.fg, 0.08)),
    '--g-line': triplet(t.border),
    '--g-line-hi': triplet(mix(t.border, t.fg, 0.2)),
    '--g-fg': triplet(t.fg),
    '--g-text': triplet(mix(t.fg, t.muted, 0.35)),
    '--g-mute': triplet(t.muted),
    '--g-dim': triplet(mix(t.muted, t.bg, 0.3)),
    '--g-money': triplet(t.up),
    '--g-money-bg': triplet(mix(t.bg, t.up, 0.12)),
    '--g-won-bg': triplet(mix(t.bg, t.up, 0.18)),
    '--g-won-edge': triplet(mix(t.bg, t.up, 0.55)),
    '--g-cta': triplet(t.brand),
    '--g-cta-hi': triplet(lighten(t.brand, 0.12)),
    '--g-cta-lo': triplet(darken(t.brand, 0.3)),
    '--g-cta-edge': triplet(lighten(t.brand, 0.55)),
    '--g-cta-fg': triplet(ctaInk),
    '--g-accent': triplet(t.accent),
    '--g-accent-fg': triplet(t.accentFg),
    '--g-down': triplet(t.down),
    '--g-down-hi': triplet(lighten(t.down, 0.1)),
    '--g-down-edge': triplet(lighten(t.down, 0.45)),
    '--g-warn': triplet(t.warn),
    '--g-warn-hi': triplet(lighten(t.warn, 0.1)),
    '--g-warn-edge': triplet(lighten(t.warn, 0.45)),
    '--g-info': triplet(t.info),
    '--g-info-hi': triplet(lighten(t.info, 0.1)),
    // sheets & pages (Apple-style grouped surfaces)
    '--ios-bg': triplet(mix(t.bg, '#000000', 0.5)),
    '--ios-elev': triplet(t.surface),
    '--ios-elev2': triplet(t.surface2),
    '--ios-elev3': triplet(mix(t.surface2, t.fg, 0.08)),
    '--ios-fg': triplet(t.fg),
    '--ios-fg2': triplet(t.fg),
    '--ios-green': triplet(t.up),
    '--ios-red': triplet(t.down),
    '--ios-orange': triplet(t.warn),
    '--ios-blue': triplet(t.info),
    '--ios-cta': triplet(t.brand),
    '--ios-cta-fg': triplet(ctaInk),
    // type + shape
    '--font-title': fontStack(t.fontTitle),
    '--font-body': fontStack(t.fontBody),
    '--font-mono': fontStack(t.fontMono),
    '--heading-weight': t.headingWeight,
    '--brand-radius': t.radius,
  };
  return v;
}
