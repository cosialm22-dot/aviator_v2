// ============================================================================
// Kenyan mobile phone helpers — the single source of truth for MSISDN handling.
//
// Valid Kenyan mobile numbers are Safaricom 7XX and the 1XX range, i.e. the
// canonical Daraja/M-Pesa form is 2547XXXXXXXX or 2541XXXXXXXX. Accepted input
// shapes: "7XXXXXXXX" (9), "07XXXXXXXX" (10), "2547XXXXXXXX" (12), with any
// spaces/dashes/“+” stripped.
// ============================================================================
const MSISDN = /^254(7|1)[0-9]{8}$/;

/** Best-effort normalisation to 254XXXXXXXXX. Callers must still validate. */
export function normalizeKenyanPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 9 && (d[0] === '7' || d[0] === '1')) return '254' + d;
  if (d.length === 10 && d.startsWith('0')) return '254' + d.slice(1);
  if (d.length === 12 && d.startsWith('254')) return d;
  return d;
}

/** True only for a genuine Kenyan mobile number (7XX / 1XX). */
export function isValidKenyanPhone(raw: string): boolean {
  return MSISDN.test(normalizeKenyanPhone(raw));
}

/** Strict Daraja MSISDN (254XXXXXXXXX) or null when the input is not valid. */
export function toDarajaMsisdn(raw: string): string | null {
  const n = normalizeKenyanPhone(raw);
  return MSISDN.test(n) ? n : null;
}
