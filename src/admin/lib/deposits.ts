// Pure helpers for the operator Deposits screen (Mega Pay). Unit-tested in deposits.test.ts.

export type DepositStatus = 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface DepositRow {
  id: string;
  created_at: string;
  user_id: string;
  phone_number: string | null;
  amount: number;
  status: DepositStatus;
  provider_status: string | null;
  result_description: string | null;
  mpesa_receipt_number: string | null;
  checkout_request_id: string;
  merchant_request_id: string | null;
  check_count: number | null;
  last_checked_at: string | null;
  completed_at: string | null;
  reference: string | null;
  site_id: string | null;
  profiles?: { username: string | null } | null;
  sites?: { name: string | null } | null;
}

export const ORPHAN_REASON = 'No Mega Pay response';
const HOUR = 3_600_000;

export function isAmountMismatch(r: Pick<DepositRow, 'provider_status'>): boolean {
  return (r.provider_status ?? '').startsWith('AMOUNT_MISMATCH');
}

/** Why a row needs a human, or null. Mirrors attention_count in fn_admin_megapay_overview. */
export function attentionReason(r: DepositRow, now = Date.now()): string | null {
  if (r.status === 'completed') return null;
  if (isAmountMismatch(r)) return 'Mega Pay reported a different amount — not credited. Investigate.';
  if (r.status === 'failed' && r.result_description === ORPHAN_REASON) {
    return 'The prompt call got no answer from Mega Pay. Check the Mega Pay portal for a payment from this number.';
  }
  if (r.status === 'timeout' && now - Date.parse(r.created_at) > HOUR) {
    return 'Unconfirmed for over an hour. Still checked automatically for 3 days.';
  }
  return null;
}

/** Can staff confirm this deposit by hand? Mirrors fn_admin_megapay_manual_credit's eligibility. */
export function canConfirmByHand(r: DepositRow): boolean {
  if (isAmountMismatch(r)) return false;
  return r.status === 'timeout' || (r.status === 'failed' && r.result_description === ORPHAN_REASON);
}

/** Can the row be re-checked with Mega Pay right now? Needs a Mega Pay id and a non-final status. */
export function canCheckNow(r: DepositRow): boolean {
  return (r.status === 'pending' || r.status === 'timeout') && !r.checkout_request_id.startsWith('mp-pending:');
}

/** M-Pesa receipt codes are 10 upper-case letters/digits today; accept 8–12 like the server. */
export function normaliseReceipt(raw: string): string | null {
  const v = (raw || '').trim().toUpperCase();
  return /^[A-Z0-9]{8,12}$/.test(v) ? v : null;
}

/** 254712345678 → 0712 •••678. Staff see enough to match an SMS, not the whole number. */
export function maskPhone(p: string | null | undefined): string {
  const d = (p || '').replace(/\D/g, '');
  const local = d.startsWith('254') ? '0' + d.slice(3) : d;
  if (local.length < 7) return local || '—';
  return `${local.slice(0, 4)} •••${local.slice(-3)}`;
}

export const STATUS_META: Record<DepositStatus, { label: string; cls: string }> = {
  initiated: { label: 'Sending', cls: 'bg-white/[0.06] text-muted border-line' },
  pending:   { label: 'Waiting for PIN', cls: 'bg-brand/10 text-brand border-brand/30' },
  completed: { label: 'Credited', cls: 'bg-up/10 text-up border-up/30' },
  failed:    { label: 'Failed', cls: 'bg-down/10 text-down border-down/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-down/10 text-down border-down/30' },
  timeout:   { label: 'Unconfirmed', cls: 'bg-amber-400/10 text-amber-300 border-amber-400/30' },
};

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function successRate(completed: number, started: number): string {
  if (!started) return '—';
  return `${Math.round((completed / started) * 100)}%`;
}

/** Server error codes from the operator RPCs → staff copy. */
export function adminDepositError(msg: string): string {
  const c = (msg || '').split(':')[0].trim();
  const map: Record<string, string> = {
    NOT_AUTHORIZED: 'Your role cannot do this.',
    AUTH_REQUIRED: 'Your session expired. Sign in again.',
    INVALID_RECEIPT: 'Enter the M-Pesa receipt code (8–12 letters and digits).',
    NOTE_REQUIRED: 'Write a short reason (at least 5 characters).',
    DEPOSIT_NOT_FOUND: 'Deposit not found on your brand.',
    ALREADY_CREDITED: 'This deposit is already credited.',
    NOT_ELIGIBLE: 'Only unconfirmed deposits, or prompts that never got a Mega Pay answer, can be confirmed by hand.',
    AMOUNT_MISMATCH: 'Mega Pay reported a different amount for this deposit. It cannot be confirmed by hand.',
    RECEIPT_ALREADY_USED: 'That M-Pesa receipt is already attached to another deposit.',
    INVALID_PROVIDER: 'Choose a supported gateway.',
    INVALID_AMOUNT: 'Limits must be whole shillings.',
    INVALID_RANGE: msg.includes(':') ? msg.slice(msg.indexOf(':') + 1).trim() : 'Those limits are out of range.',
  };
  return map[c] ?? 'Something went wrong. Please try again.';
}
