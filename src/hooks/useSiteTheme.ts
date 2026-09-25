import { useBrand } from '../brand/useBrand';
import type { Brand } from '../brand/runtime';
import { BIRD_MAP, DEFAULT_BIRD } from '../components/game/birds';

// useSiteTheme — the brand's streamer bird (marketers going live) and plane (players), read from
// the brand runtime. Kept as a small facade for the canvas, header and marketer hub.
export interface SiteTheme {
  brand: Brand;
  /** Streamer-mode bird species id (validated against BIRD_MAP). */
  birdId: string;
  /** @deprecated alias of birdId (older callers). */
  planeSkin: string;
}

export function birdIdFor(skin: string | null | undefined): string {
  const k = (skin || DEFAULT_BIRD).toLowerCase();
  return BIRD_MAP[k] ? k : DEFAULT_BIRD;
}

export function useSiteTheme(): SiteTheme {
  const brand = useBrand();
  const birdId = birdIdFor(brand.config['stream.bird']);
  return { brand, birdId, planeSkin: birdId };
}
