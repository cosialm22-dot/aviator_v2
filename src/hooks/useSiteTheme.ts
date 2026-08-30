import { useEffect, useState } from 'react';
import { resolveSiteBrand, getCachedSiteBrand, type SiteBrand } from '../lib/siteBrand';

// ============================================================================
// useSiteTheme — resolve the current host's brand and expose its plane skin +
// theme tokens, applying the palette as CSS custom properties so the whole UI
// re-skins per domain (borrowed from invest254's brand engine). The plane skin
// selects which curated sprite the canvas/header render.
// ============================================================================

export interface SiteTheme {
  brand: SiteBrand | null;
  /** Curated plane-skin key; 'crimson' is the classic default. */
  planeSkin: string;
  /** Public path to the plane sprite for the current site. */
  planeSrc: string;
  /** Raw per-site palette tokens (may be empty). */
  tokens: Record<string, string>;
}

const PLANE_DIR = '/planes';
const DEFAULT_SKIN = 'crimson';
// The classic red plane lives at /plane.png (not under /planes) for back-compat.
const SKIN_SRC: Record<string, string> = {
  crimson: '/plane.png',
  gold: `${PLANE_DIR}/plane_gold.png`,
  rocket: `${PLANE_DIR}/plane_rocket.png`,
  prop: `${PLANE_DIR}/plane_prop.png`,
};

export function planeSrcFor(skin: string | null | undefined): string {
  const k = (skin || DEFAULT_SKIN).toLowerCase();
  return SKIN_SRC[k] ?? SKIN_SRC[DEFAULT_SKIN];
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

  const planeSkin = (brand?.plane_skin as string | null) ?? DEFAULT_SKIN;
  return { brand, planeSkin, planeSrc: planeSrcFor(planeSkin), tokens };
}
