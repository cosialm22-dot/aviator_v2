// ============================================================================
// Edge brand renderer — the Cloudflare Worker in front of the static app (invest254 renders the
// brand server-side for the same reasons). Many domains point at ONE deployment; for each HTML
// page the Worker looks up the host's brand (public_site_by_host, cached 60 s at the edge) and
// rewrites the shell before it leaves Cloudflare:
//   * the brand's CSS variables, fonts, title, description, theme colour, favicon and canonical
//     link are in the HTML — no flash of the default look, correct link previews and tab icons;
//   * window.__BRAND__ carries the resolved brand so the app does not wait for a round trip;
//   * /manifest.webmanifest and /robots.txt are generated per brand.
// Everything else (JS, CSS, images, sounds) is served straight from static assets — the Worker only
// runs for the paths listed in wrangler.jsonc `run_worker_first`.
// ============================================================================
import { tokensToCssVars, completeTokens, CLASSIC_TOKENS } from '../src/brand/tokens';
import { googleFontsHref } from '../src/brand/fonts';
import { faviconDataUri } from '../src/brand/mark';

interface Env {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

type Brand = {
  site_id: string; slug: string; name: string; status: string; version: number;
  wordmark_text: string | null; logo_url: string | null; favicon_url: string | null; primary_domain: string | null;
  theme_tokens: Record<string, string>; config: Record<string, unknown>;
};

const DEFAULT_SITE = '00000000-0000-0000-0000-000000000001';
const TTL = 60;

async function brandFor(host: string, slug: string | null, env: Env, ctx: Ctx): Promise<Brand | null> {
  const key = new Request(`https://brand.cache/${encodeURIComponent(host)}?b=${encodeURIComponent(slug ?? '')}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return hit.json();
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/public_site_by_host`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_host: host, p_slug: slug }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Brand | null;
    if (b) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${TTL}` } })));
    return b;
  } catch { return null; }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isClassic = (t: Record<string, string>) =>
  !t || Object.keys(t).length === 0 || JSON.stringify(completeTokens(t)) === JSON.stringify(CLASSIC_TOKENS);

function headFor(b: Brand, url: URL): { title: string; themeColor: string; html: string; icon: string | null } {
  const c = b.config;
  const classic = isClassic(b.theme_tokens);
  const t = completeTokens(b.theme_tokens);
  const title = str(c['seo.title']) ?? (b.site_id === DEFAULT_SITE ? 'Aviator' : b.name);
  const desc = str(c['seo.description']);
  const og = str(c['seo.og_image']);
  const parts: string[] = [];
  if (!classic) {
    const vars = Object.entries(tokensToCssVars(b.theme_tokens)).map(([k, v]) => `${k}:${v}`).join(';');
    parts.push(`<style id="brand-vars">:root{${vars}}</style>`);
    const fonts = [t.fontTitle, t.fontBody, t.fontMono].filter((f) => f !== 'Inter');
    if (fonts.length) parts.push(`<link id="brand-fonts" rel="stylesheet" href="${esc(googleFontsHref(fonts))}">`);
  }
  if (desc) parts.push(`<meta name="description" content="${esc(desc)}"><meta property="og:description" content="${esc(desc)}">`);
  parts.push(`<meta property="og:title" content="${esc(title)}"><meta property="og:type" content="website">`);
  if (og) parts.push(`<meta property="og:image" content="${esc(og)}"><meta name="twitter:card" content="summary_large_image">`);
  if (c['seo.indexing'] === 'noindex') parts.push('<meta name="robots" content="noindex, nofollow">');
  if (b.primary_domain && url.hostname !== b.primary_domain) parts.push(`<link rel="canonical" href="https://${esc(b.primary_domain)}${esc(url.pathname)}">`);
  const model = String(c['plane.model'] ?? 'classic');
  const icon = str(b.favicon_url) ?? (!classic || model !== 'classic'
    ? faviconDataUri(t.brand, model === 'classic' || model === 'custom' ? 'jet' : model,
        { body: String(c['plane.body'] ?? '#e51e3c'), accent: String(c['plane.accent'] ?? '#b3122e'), canopy: String(c['plane.canopy'] ?? '#bfe6ff') })
    : null);
  if (icon) parts.push(`<link id="brand-icon" rel="icon" href="${esc(icon)}"${icon.startsWith('data:image/svg') ? ' type="image/svg+xml"' : ''}>`);
  const touch = str(c['pwa.icon_url']) ?? str(b.logo_url);
  if (touch) parts.push(`<link id="brand-touch-icon" rel="apple-touch-icon" href="${esc(touch)}">`);
  // The resolved brand for the app (no extra round trip). "<" is escaped so it can never close the tag.
  parts.push(`<script>window.__BRAND__=${JSON.stringify(b).replace(/</g, '\\u003c')}</script>`);
  return { title, themeColor: classic ? '#0e0e0e' : t.bg, html: parts.join(''), icon };
}

function manifest(b: Brand | null, url: URL): Response {
  const c = b?.config ?? {};
  const classic = !b || isClassic(b.theme_tokens);
  const bg = classic ? '#0e0e0e' : completeTokens(b!.theme_tokens).bg;
  const name = b?.name ?? 'Aviator';
  const icon = str(c['pwa.icon_url']);
  const body = {
    name, short_name: str(c['pwa.short_name']) ?? name.slice(0, 12), start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: bg, theme_color: bg,
    icons: icon ? [{ src: icon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      : [{ src: `${url.origin}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${url.origin}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
         { src: `${url.origin}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } });
}

function robots(b: Brand | null, url: URL): Response {
  const hide = b?.config?.['seo.indexing'] === 'noindex';
  const txt = `User-agent: *\n${hide ? 'Disallow: /\n' : 'Disallow: /admin\nDisallow: /profile\nDisallow: /marketer\n'}` + (hide ? '' : `\nSitemap: ${url.origin}/sitemap.xml\n`);
  return new Response(txt, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    const slug = url.searchParams.get('brand');
    if (url.pathname === '/manifest.webmanifest') return manifest(await brandFor(url.host, slug, env, ctx), url);
    if (url.pathname === '/robots.txt') return robots(await brandFor(url.host, slug, env, ctx), url);
    if (url.pathname === '/sitemap.xml') {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(url.origin)}/</loc></url></urlset>`,
        { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
    }

    const res = await env.ASSETS.fetch(req);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html') || url.pathname.startsWith('/admin')) return res;

    const b = await brandFor(url.host, slug, env, ctx);
    if (!b) return res;
    const h = headFor(b, url);
    const out = new HTMLRewriter()
      .on('title', { element(e) { e.setInnerContent(h.title); } })
      .on('meta[name="theme-color"]', { element(e) { e.setAttribute('content', h.themeColor); } })
      .on('link[rel="icon"]', { element(e) { if (h.icon) e.remove(); } })
      .on('head', { element(e) { e.append(h.html, { html: true }); } })
      .transform(res);
    const headers = new Headers(out.headers);
    headers.set('Cache-Control', 'no-cache');
    headers.set('Vary', 'Host');
    return new Response(out.body, { status: out.status, headers });
  },
};
