import { useEffect, useState } from 'react';
import { resolveSiteBrand, getCachedSiteBrand, type SiteBrand } from '../lib/siteBrand';
import { BIRD_MAP, DEFAULT_BIRD } from '../components/game/birds';

// ============================================================================
// useSiteTheme — resolve the current host's brand and expose its bird skin +
// theme tokens, applying the palette as CSS custom properties so the whole UI
// re-skins per domain (borrowed from invest254's brand engine). The bird skin
// selects which species the canvas/header render (procedural, animated).
// ============================================================================

export interface SiteTheme {
  brand: SiteBrand | null;
  /** Curated bird-skin key (a species id); DEFAULT_BIRD when unset. */
  planeSkin: string;
  /** Resolved species id (validated against BIRD_MAP). */
  birdId: string;
  /** Raw per-site palette tokens (may be empty). */
  tokens: Record<string, string>;
}

// Back-compat shim: the canvas/header used to render an image at a path. Now
// birds are procedural, so this returns a token the <img> fallbacks ignore.
export function planeSrcFor(skin: string | null | undefined): string {
  const k = (skin || DEFAULT_BIRD).toLowerCase();
  return BIRD_MAP[k] ? `bird:${k}` : `bird:${DEFAULT_BIRD}`;
}

export function birdIdFor(skin: string | null | undefined): string {
  const k = (skin || DEFAULT_BIRD).toLowerCase();
  return BIRD_MAP[k] ? k : DEFAULT_BIRD;
}

// Apply a site's palette as CSS vars (only the tokens present). Semantic hues
// (up/down) are intentionally NOT overridden so win/loss meaning stays stable.
function applyTokens(tokens: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const map: Record<string, string> = {
    brand: '--site-brand', accent: '--site-accent', bg: '--site-bg',
    surface: '--site-surface', border: '--site-border', fg: '--site-fg', muted: '--site-muted',
  };
  for (const [k, v] of Object.entries(tokens)) {
    const cssVar = map[k];
    if (cssVar && typeof v === 'string') root.style.setProperty(cssVar, v);
  }
}

export function useSiteTheme(): SiteTheme {
  const [brand, setBrand] = useState<SiteBrand | null>(() => getCachedSiteBrand());

  useEffect(() => {
    let live = true;
    void resolveSiteBrand().then((b) => { if (live && b) setBrand(b); });
    return () => { live = false; };
  }, []);

  const tokens = (brand?.theme_tokens as Record<string, string> | null) ?? {};
  useEffect(() => { applyTokens(tokens); }, [JSON.stringify(tokens)]);

  const planeSkin = (brand?.plane_skin as string | null) ?? DEFAULT_BIRD;
  return { brand, planeSkin, birdId: birdIdFor(planeSkin), tokens };
}
