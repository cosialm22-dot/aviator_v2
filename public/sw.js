/* Aviator service worker — offline shell + safe runtime caching.
 * Borrowed from invest254 (0-PWA), adapted for aviator's Vite SPA.
 * Strategy:
 *   - Precache a minimal offline shell (static offline.html + manifest + icons).
 *   - Navigations: NETWORK-FIRST, falling back to the cached offline page only
 *     when the network is unavailable (the live game/wallet always need fresh
 *     data, so we never serve a stale page while online).
 *   - Same-origin static build assets (/assets/, icons, manifest, favicons):
 *     stale-while-revalidate.
 *   - CROSS-ORIGIN traffic (Supabase REST/Auth/Realtime = the money/game path)
 *     is NEVER intercepted — it must always hit the network directly.
 */
const VERSION = 'aviator-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = '/offline';   // Cloudflare Assets serves offline.html here (strips .html)
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||   // Vite build output (hashed)
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.png' ||
    url.pathname === '/favicon-32.png' ||
    url.pathname === '/apple-touch-icon.png'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase API/Auth/Realtime or any CDN

  // App navigations: network-first with an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
