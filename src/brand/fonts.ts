// ============================================================================
// Per-brand typography (ported from invest254 lib/brand/fonts.ts). A brand carries a title, body
// and mono (numbers) family; the runtime loads them from Google Fonts and exposes --font-title /
// --font-body / --font-mono. Curated, free, embeddable families only. The server keeps the same
// list (public._brand_fonts()) and refuses anything else; fonts.test.ts pins the two together.
// ============================================================================

export const BRAND_FONTS = [
  'Inter', 'DM Sans', 'Manrope', 'Poppins', 'Montserrat', 'Sora', 'Space Grotesk', 'Onest', 'Hanken Grotesk',
  'IBM Plex Sans', 'Rajdhani', 'Titillium Web', 'Work Sans', 'Archivo', 'Chivo', 'Barlow', 'Red Hat Display', 'Figtree',
  'Plus Jakarta Sans', 'Outfit', 'Exo 2', 'Rubik', 'Roboto', 'Fraunces', 'Lora', 'Space Mono', 'JetBrains Mono',
  'IBM Plex Mono', 'Roboto Mono',
  // Display faces for game wordmarks and the multiplier.
  'Bebas Neue', 'Oswald', 'Russo One', 'Orbitron', 'Teko', 'Saira',
] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

const SERIF = new Set<string>(['Fraunces', 'Lora']);
const MONO = new Set<string>(['Space Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Roboto Mono']);
const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function isBrandFont(f: unknown): f is BrandFont {
  return typeof f === 'string' && (BRAND_FONTS as readonly string[]).includes(f);
}

/** A CSS font-family stack for `family`, with the right generic fallback. */
export function fontStack(family: string): string {
  const generic = MONO.has(family) ? MONO_FALLBACK : SERIF.has(family) ? SERIF_FALLBACK : SANS_FALLBACK;
  return `"${family}", ${generic}`;
}

// Weights each family really publishes: asking Google for a missing weight 400s the WHOLE sheet.
const FAMILY_WEIGHTS: Record<string, number[]> = {
  Inter: [400, 500, 600, 700, 800], 'DM Sans': [400, 500, 700], Manrope: [400, 500, 600, 700, 800],
  Poppins: [400, 500, 600, 700, 800], Montserrat: [400, 500, 600, 700, 800], Sora: [400, 500, 600, 700, 800],
  'Space Grotesk': [400, 500, 600, 700], Onest: [400, 500, 600, 700, 800], 'Hanken Grotesk': [400, 500, 600, 700, 800],
  'IBM Plex Sans': [400, 500, 600, 700], Rajdhani: [400, 500, 600, 700], 'Titillium Web': [400, 600, 700],
  'Work Sans': [400, 500, 600, 700, 800], Archivo: [400, 500, 600, 700, 800], Chivo: [400, 500, 600, 700, 800],
  Barlow: [400, 500, 600, 700, 800], 'Red Hat Display': [400, 500, 600, 700, 800], Figtree: [400, 500, 600, 700, 800],
  'Plus Jakarta Sans': [400, 500, 600, 700, 800], Outfit: [400, 500, 600, 700, 800], 'Exo 2': [400, 500, 600, 700, 800],
  Rubik: [400, 500, 600, 700, 800], Roboto: [400, 500, 700], Fraunces: [400, 500, 600, 700, 800], Lora: [400, 500, 600, 700],
  'Space Mono': [400, 700], 'JetBrains Mono': [400, 500, 600, 700, 800], 'IBM Plex Mono': [400, 500, 600, 700],
  'Roboto Mono': [400, 500, 600, 700], 'Bebas Neue': [400], Oswald: [400, 500, 600, 700], 'Russo One': [400],
  Orbitron: [400, 500, 600, 700, 800], Teko: [400, 500, 600, 700], Saira: [400, 500, 600, 700, 800],
};
const DESIRED = [400, 500, 600, 700, 800];

function weightsFor(family: string): number[] {
  const have = FAMILY_WEIGHTS[family] ?? [400, 700];
  const set = new Set(DESIRED.filter((w) => have.includes(w)));
  set.add(have.includes(400) ? 400 : have[0]);
  if (have.includes(700)) set.add(700);
  return Array.from(set).sort((a, b) => a - b);
}

/** One Google Fonts CSS2 URL for the families (deduped, only published weights). '' if none. */
export function googleFontsHref(families: string[]): string {
  const uniq = Array.from(new Set(families.filter((f) => isBrandFont(f))));
  if (uniq.length === 0) return '';
  const specs = uniq.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${weightsFor(f).join(';')}`);
  return `https://fonts.googleapis.com/css2?${specs.join('&')}&display=swap`;
}
