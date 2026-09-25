// The edge Worker's routing decisions (health probe, canonical-host redirects), with the
// Cloudflare runtime stubbed: no HTMLRewriter is needed for these paths.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';

const SITE = '22222222-2222-2222-2222-222222222222';
const payload = (host: string) => {
  if (host === 'www.lucky.co.ke') return { site_id: SITE, slug: 'lucky', matched: 'domain', host: { hostname: 'lucky.co.ke', redirect_to: 'lucky.co.ke' }, theme_tokens: {}, config: {} };
  if (host === 'lucky.co.ke') return { site_id: SITE, slug: 'lucky', matched: 'domain', host: { hostname: 'lucky.co.ke', redirect_to: null }, theme_tokens: {}, config: {} };
  if (host === 'old-lucky.com') return { site_id: SITE, slug: 'lucky', matched: 'domain', host: { hostname: 'old-lucky.com', redirect_to: 'lucky.co.ke' }, theme_tokens: {}, config: {} };
  return { site_id: '00000000-0000-0000-0000-000000000001', slug: 'aviator', matched: 'default', host: null, theme_tokens: {}, config: {} };
};
const env = {
  ASSETS: { fetch: vi.fn(async () => new Response('js', { headers: { 'content-type': 'application/javascript' } })) },
  SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
};
const ctx = { waitUntil: () => {} };
const call = (url: string, method = 'GET') => worker.fetch(new Request(url, { method }), env, ctx);

beforeEach(() => {
  (globalThis as unknown as { caches: unknown }).caches = { default: { match: async () => undefined, put: async () => {} } };
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => new Response(JSON.stringify(payload(JSON.parse(String(init.body)).p_host)))));
  env.ASSETS.fetch.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('edge worker', () => {
  it('/__brand tells which brand a host serves (never redirected)', async () => {
    const r = await call('https://www.lucky.co.ke/__brand');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ site_id: SITE, slug: 'lucky', matched: 'domain', host: 'lucky.co.ke' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('www redirects to the apex with path and query', async () => {
    const r = await call('https://www.lucky.co.ke/legal/terms?ref=abc');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://lucky.co.ke/legal/terms?ref=abc');
  });
  it('a secondary domain redirects to the primary when asked', async () => {
    const r = await call('https://old-lucky.com/');
    expect(r.headers.get('location')).toBe('https://lucky.co.ke/');
  });
  it('the canonical host is served, not redirected', async () => {
    const r = await call('https://lucky.co.ke/app.js');
    expect(r.status).toBe(200);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
  it('POST is never redirected', async () => {
    const r = await call('https://www.lucky.co.ke/x', 'POST');
    expect(r.status).toBe(200);
  });
  it('unknown hosts fall back to the default brand without redirecting', async () => {
    const r = await call('https://aviatorv2.example.workers.dev/robots.txt');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Sitemap: https://aviatorv2.example.workers.dev/sitemap.xml');
  });
  it('looks the brand up once per request', async () => {
    await call('https://lucky.co.ke/robots.txt');
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
