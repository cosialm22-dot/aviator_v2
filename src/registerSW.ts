// Registers the PWA service worker after load. Production-only so it never
// interferes with Vite dev/HMR. Best-effort: the app works without it.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration is best-effort */
    });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
