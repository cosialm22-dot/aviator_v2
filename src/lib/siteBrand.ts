import { supabase } from './supabase';

// ============================================================================
// Site brand resolver - the single shared web app serves many branded domains
// (the franchise-chain model). On boot we resolve the current host -> brand via
// the anon-callable public_site_by_host RPC, so signups attribute to the right
// site (threaded to handle_new_user via the `site_slug` signup metadata) and
// theming can follow later. Falls back to the default brand for unknown hosts,
// which preserves single-brand behaviour. Cached in-memory + localStorage so
// signup has the slug synchronously and we avoid re-querying every load.
// ============================================================================

export interface SiteBrand {
  site_id: string;
  slug: string;
  name: string;
  status: string;
  theme: string | null;
  color_primary: string | null;
  color_bg: string | null;
  color_accent: string | null;
  wordmark_text: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  currency: string;
  locale: string;
  withdrawals_enabled: boolean;
}

const CACHE_KEY = 'aviator_site_brand';
let cached: SiteBrand | null = null;

// Synchronous best-effort read for the signup call (falls back to localStorage).
export function getCachedSiteBrand(): SiteBrand | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) { cached = JSON.parse(raw) as SiteBrand; return cached; }
  } catch { /* localStorage unavailable */ }
  return null;
}

export function getCachedSiteSlug(): string | undefined {
  return getCachedSiteBrand()?.slug;
}

// Resolve (and cache) the brand for the current host. Safe to call repeatedly;
// on any failure it returns the last cached value (or null) rather than throwing.
export async function resolveSiteBrand(): Promise<SiteBrand | null> {
  try {
    const host = typeof window !== 'undefined' ? window.location.host : '';
    const { data, error } = await supabase.rpc('public_site_by_host', { p_host: host });
    if (error || !data) return getCachedSiteBrand();
    cached = data as SiteBrand;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)); } catch { /* ignore */ }
    return cached;
  } catch {
    return getCachedSiteBrand();
  }
}
