// ============================================================================
// Theme-aware favicon (invest254 lib/brand/mark.ts): the brand's plane on a tile filled with the
// brand colour, baked into an SVG data URI (a browser tab cannot read page CSS variables).
// Regenerated whenever the brand changes; an uploaded favicon always wins.
// ============================================================================
import { darken, lighten, readableInk, type Hex } from './color';
import { PLANE_MAP, planeSvg, type PlaneColors } from './planes';

function b64(s: string): string {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, 'utf8').toString('base64');
}

export function faviconSvg(tile: Hex, model: string, colors: PlaneColors): string {
  const m = PLANE_MAP[model] ? model : 'jet';
  const ink = readableInk(tile);
  // On a coloured tile the plane is drawn in the tile's ink, with the brand colour as its accent.
  const plane = planeSvg(m, { body: ink, accent: darken(tile, 0.35), canopy: lighten(tile, 0.5) }, { idSuffix: 'fav', size: 200 })
    .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">', '').replace('</svg>', '');
  void colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(tile, 0.12)}"/><stop offset="1" stop-color="${darken(tile, 0.18)}"/></linearGradient></defs>` +
    `<rect x="2" y="2" width="60" height="60" rx="15" fill="url(#t)"/>` +
    `<g transform="translate(5 22) scale(0.27) rotate(-14 100 50)">${plane}</g></svg>`;
}

export function faviconDataUri(tile: Hex, model: string, colors: PlaneColors): string {
  return `data:image/svg+xml;base64,${b64(faviconSvg(tile, model, colors))}`;
}
