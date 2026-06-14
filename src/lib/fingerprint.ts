// ============================================================================
// Device fingerprint - dependency-free, privacy-respecting.
// ----------------------------------------------------------------------------
// Combines stable, non-PII browser characteristics into a short, stable hash
// used solely to detect multi-accounting / collusion in the server risk engine
// (assess_player_risk -> device_fingerprints). Best-effort: any signal that is
// unavailable is simply skipped, and fingerprinting NEVER blocks authentication.
// No third-party library and no network calls.
// ============================================================================

interface NavigatorExtras {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  languages?: readonly string[];
}

async function sha256Hex(input: string): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
  } catch { /* fall through to cheap hash */ }
  // Fallback djb2 hash for non-secure contexts where SubtleCrypto is missing.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function canvasSignature(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 40;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#069';
    ctx.fillText('Aviator-fp-7g', 2, 2);
    ctx.fillStyle = 'rgba(102,200,0,0.6)';
    ctx.fillText('Aviator-fp-7g', 4, 6);
    return c.toDataURL().slice(-72);
  } catch { return ''; }
}

function webglSignature(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch { return ''; }
}

/** Compute a stable device fingerprint hash for the current browser/device. */
export async function getDeviceFingerprint(): Promise<string> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & NavigatorExtras;
  const scr = typeof screen !== 'undefined' ? screen : ({} as Screen);
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }

  const parts = [
    nav.userAgent || '',
    nav.language || '',
    (nav.languages || []).join(','),
    String(nav.hardwareConcurrency ?? ''),
    String(nav.deviceMemory ?? ''),
    String(nav.maxTouchPoints ?? ''),
    `${scr.width ?? ''}x${scr.height ?? ''}x${scr.colorDepth ?? ''}`,
    String(typeof window !== 'undefined' ? window.devicePixelRatio : ''),
    tz,
    canvasSignature(),
    webglSignature(),
  ];
  return sha256Hex(parts.join('|'));
}
