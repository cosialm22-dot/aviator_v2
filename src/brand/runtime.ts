// ============================================================================
// Brand runtime — one deployment, many branded sites (invest254's brand.ts + BrandProvider, for a
// Vite SPA). On load the host resolves to its brand (public_site_by_host), and the brand is applied:
//   * theme tokens -> CSS custom properties (the whole player UI re-skins; see tokens.ts),
//   * fonts (Google Fonts), page title, description, robots, theme-color, favicon, web-app manifest,
//   * analytics tags the brand configured,
//   * typed public settings (settings.generated.ts) for every screen via useBrand().
// First paint: the Worker (worker/index.ts) already rendered the brand's CSS variables, title and
// icons into the HTML and hands the resolved brand over as window.__BRAND__, so there is no flash
// of the default look and no wait. A save in the brand console is pushed on the "config"
// broadcast topic and open pages re-skin within a second.
// ============================================================================
import { supabase } from '../lib/supabase';
import { BRAND_SETTING_DEFAULTS, type BrandSettings } from './settings.generated';
import { CLASSIC_TOKENS, completeTokens, tokensToCssVars, type ThemeTokens } from './tokens';
import { googleFontsHref } from './fonts';
import { faviconDataUri } from './mark';
import { onConfigEvent } from '../lib/configChannel';

export const DEFAULT_SITE_ID = '00000000-0000-0000-0000-000000000001';

export interface Brand {
  site_id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'disabled' | string;
  /** How this page found its brand: its domain, a ?brand= preview, or the default. */
  matched: 'domain' | 'preview' | 'default' | string;
  version: number;
  wordmark_text: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  currency: string;
  locale: string;
  licence_line: string | null;
  support_email: string | null;
  primary_domain: string | null;
  theme_tokens: Partial<ThemeTokens>;
  config: BrandSettings;
}

export const DEFAULT_BRAND: Brand = {
  site_id: DEFAULT_SITE_ID, slug: 'aviator', name: 'Aviator', status: 'active', matched: 'default', version: 0,
  wordmark_text: null, logo_url: null, favicon_url: null, currency: 'KES', locale: 'en-KE', licence_line: null,
  support_email: null, primary_domain: null, theme_tokens: {}, config: BRAND_SETTING_DEFAULTS,
};

const CACHE_KEY = 'aviator_brand_v2';
const PREVIEW_KEY = 'aviator_brand_preview';

// ── state ────────────────────────────────────────────────────────────────────
function normalise(raw: unknown): Brand | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Brand> & { config?: Partial<BrandSettings> };
  if (typeof r.site_id !== 'string') return null;
  return {
    ...DEFAULT_BRAND, ...r,
    theme_tokens: (r.theme_tokens && typeof r.theme_tokens === 'object') ? r.theme_tokens : {},
    config: { ...BRAND_SETTING_DEFAULTS, ...(r.config ?? {}) } as BrandSettings,
  } as Brand;
}

function readCache(): Brand | null {
  try { return normalise(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); } catch { return null; }
}

// The Worker renders the host's brand into the page as window.__BRAND__ (see worker/index.ts);
// otherwise the last brand this browser saw; otherwise the default.
function fromEdge(): Brand | null {
  try { return normalise((window as unknown as { __BRAND__?: unknown }).__BRAND__); } catch { return null; }
}
let current: Brand = (typeof window !== 'undefined' && (fromEdge() || readCache())) || DEFAULT_BRAND;
const listeners = new Set<() => void>();

export function getBrand(): Brand { return current; }
export function subscribeBrand(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

function set(b: Brand) {
  current = b;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch { /* private mode */ }
  applyBrand(b);
  listeners.forEach((fn) => fn());
}

/** The ?brand=<slug> preview for this tab (owner/marketer checks a brand on the shared host). */
export function previewSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('brand')) {
      const v = (q.get('brand') || '').trim().toLowerCase();
      if (v) sessionStorage.setItem(PREVIEW_KEY, v); else sessionStorage.removeItem(PREVIEW_KEY);
      return v || null;
    }
    return sessionStorage.getItem(PREVIEW_KEY);
  } catch { return null; }
}

let inflight: Promise<Brand> | null = null;
/** Resolve this host's brand (network), apply and cache it. Falls back to the cached/current brand. */
export function loadBrand(force = false): Promise<Brand> {
  if (inflight && !force) return inflight;
  const host = typeof window !== 'undefined' ? window.location.host : '';
  inflight = Promise.resolve(supabase.rpc('public_site_by_host', { p_host: host, p_slug: previewSlug() }))
    .then(({ data, error }) => {
      const b = error ? null : normalise(data);
      if (b) set(b);
      return current;
    }, () => current)
    .finally(() => { inflight = null; });
  return inflight;
}

let started = false;
/** Apply the cached brand now, fetch the live one, and follow brand saves pushed on "config". */
export function startBrandRuntime() {
  if (started || typeof window === 'undefined') return;
  started = true;
  applyBrand(current);
  void loadBrand();
  onConfigEvent('brand', (p) => {
    const sid = (p as { site_id?: string })?.site_id;
    if (sid && sid === current.site_id) void loadBrand(true);
  });
  // A page left open for hours still converges even if a push was missed.
  setInterval(() => { if (document.visibilityState === 'visible') void loadBrand(true); }, 10 * 60_000);
}

// ── apply ────────────────────────────────────────────────────────────────────
const isClassic = (t: Partial<ThemeTokens>) =>
  !t || Object.keys(t).length === 0 || JSON.stringify(completeTokens(t)) === JSON.stringify(CLASSIC_TOKENS);

let appliedVars: string[] = [];
function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.content = content;
}
function setLink(id: string, rel: string, href: string | null, extra: Record<string, string> = {}) {
  let el = document.getElementById(id) as HTMLLinkElement | null;
  if (!href) { el?.remove(); return; }
  if (!el) { el = document.createElement('link'); el.id = id; el.rel = rel; document.head.appendChild(el); }
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
  if (el.href !== href) el.href = href;
}

export function applyBrand(b: Brand) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const cfg = b.config;
  const classic = isClassic(b.theme_tokens);
  const tokens = completeTokens(b.theme_tokens);

  // 1. colours, type and shape
  for (const k of appliedVars) root.style.removeProperty(k);
  appliedVars = [];
  if (!classic) {
    for (const [k, v] of Object.entries(tokensToCssVars(b.theme_tokens))) { root.style.setProperty(k, v); appliedVars.push(k); }
  }
  root.dataset.brand = b.slug;

  // 2. fonts
  const fonts = classic ? [] : [tokens.fontTitle, tokens.fontBody, tokens.fontMono].filter((f) => f !== 'Inter');
  setLink('brand-fonts', 'stylesheet', fonts.length ? googleFontsHref(fonts) : null);

  // 3. head: title, description, robots, theme colour, social preview
  const title = cfg['seo.title'] || (b.site_id === DEFAULT_SITE_ID ? 'Aviator' : b.name);
  if (document.title !== title) document.title = title;
  setMeta('meta[name="description"]', 'name', 'description', cfg['seo.description']);
  setMeta('meta[name="robots"]', 'name', 'robots', cfg['seo.indexing'] === 'noindex' ? 'noindex, nofollow' : null);
  setMeta('meta[name="theme-color"]', 'name', 'theme-color', classic ? '#0e0e0e' : tokens.bg);
  setMeta('meta[property="og:title"]', 'property', 'og:title', title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', cfg['seo.description']);
  setMeta('meta[property="og:image"]', 'property', 'og:image', cfg['seo.og_image']);

  // 4. icons: an uploaded favicon wins; otherwise a generated one for any non-classic brand.
  const generated = !classic || cfg['plane.model'] !== 'classic'
    ? faviconDataUri(tokens.brand, cfg['plane.model'] === 'classic' || cfg['plane.model'] === 'custom' ? 'jet' : cfg['plane.model'],
        { body: cfg['plane.body'], accent: cfg['plane.accent'], canopy: cfg['plane.canopy'] })
    : null;
  const icon = b.favicon_url || generated;
  setLink('brand-icon', 'icon', icon, icon?.startsWith('data:image/svg') ? { type: 'image/svg+xml' } : {});
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]:not(#brand-icon)').forEach((l) => { l.disabled = !!icon; if (icon) l.remove(); });
  setLink('brand-touch-icon', 'apple-touch-icon', cfg['pwa.icon_url'] || b.logo_url || null);

  // 5. the web-app manifest is generated per brand by the Worker (/manifest.webmanifest)

  // 6. analytics (once per id; never removed mid-session)
  injectAnalytics(cfg);
}

const injected = new Set<string>();
function addScript(id: string, src: string | null, inline?: string) {
  if (injected.has(id) || document.getElementById(id)) return;
  injected.add(id);
  const s = document.createElement('script');
  s.id = id; s.async = true;
  if (src) s.src = src;
  if (inline) s.text = inline;
  document.head.appendChild(s);
}
function injectAnalytics(cfg: BrandSettings) {
  const ga = cfg['analytics.ga4'];
  if (ga && /^G-[A-Z0-9]{4,14}$/.test(ga)) {
    addScript(`ga4-lib-${ga}`, `https://www.googletagmanager.com/gtag/js?id=${ga}`);
    addScript(`ga4-${ga}`, null, `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');`);
  }
  const gtm = cfg['analytics.gtm'];
  if (gtm && /^GTM-[A-Z0-9]{4,12}$/.test(gtm)) {
    addScript(`gtm-${gtm}`, null, `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`);
  }
  const px = cfg['analytics.meta_pixel'];
  if (px && /^[0-9]{6,20}$/.test(px)) {
    addScript(`fbq-${px}`, null, `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${px}');fbq('track','PageView');`);
  }
  const tt = cfg['analytics.tiktok_pixel'];
  if (tt && /^[A-Z0-9]{10,30}$/.test(tt)) {
    addScript(`ttq-${tt}`, null, `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tt}');ttq.page();}(window,document,'ttq');`);
  }
}

/** Wordmark shown in the header: explicit wordmark, else the brand name. */
export function brandWordmark(b: Brand): string {
  return (b.wordmark_text && b.wordmark_text.trim()) || b.name;
}
