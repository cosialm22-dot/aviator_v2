// ============================================================================
// Colour maths for brand theming (ported from invest254 lib/brand/derivePalette.ts): hex <-> HSL,
// WCAG relative luminance / contrast, the readable ink for a fill, and simple mixing. Pure; used by
// the runtime (CSS variables), the palette editor and the canvas.
// ============================================================================

export type Hex = string;

export function isHex(v: unknown): v is Hex {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function hexToRgb(hex: Hex): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): Hex {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** "r g b" — the channel triplet Tailwind's `rgb(var(--x) / <alpha-value>)` colours need. */
export function triplet(hex: Hex): string {
  return hexToRgb(hex).join(' ');
}

export function hexToHsl(hex: Hex): [number, number, number] {
  const [r0, g0, b0] = hexToRgb(hex);
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return [hue, s, l];
}

export function hsl(hue: number, s: number, l: number): Hex {
  hue = ((hue % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
export const lighten = (c: Hex, t: number) => mix(c, '#ffffff', t);
export const darken = (c: Hex, t: number) => mix(c, '#000000', t);

export function relLum(hex: Hex): number {
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21). */
export function contrast(a: Hex, b: Hex): number {
  const la = relLum(a), lb = relLum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The ink (near-black or white) with the higher contrast on `bg` — never a threshold guess. */
export function readableInk(bg: Hex): Hex {
  return contrast(bg, '#0b0f14') >= contrast(bg, '#ffffff') ? '#0b0f14' : '#ffffff';
}

/** rgba() string for canvas use. */
export function rgba(hex: Hex, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
