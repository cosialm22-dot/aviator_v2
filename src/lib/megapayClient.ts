// ============================================================================
// Mega Pay deposit client — pure logic, no React, no supabase import, so it is
// unit-tested with fakes (megapayClient.test.ts).
//
// Flow: megapay-stk-push {amount, phone} → {id}. The player types the PIN on
// the phone; we poll megapay-status {id}. The server asks Mega Pay and credits
// the wallet exactly once (fn_megapay_settle). If the player closes the tab,
// the reconcile job finishes the job — polling is only for instant feedback.
// ============================================================================

export type DepositStatus = 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/** The live bonus offer (amounts in KES); zeros when a part is switched off. */
export interface BonusOffer { welcome: number; matchPct: number; matchCap: number; wagerX: number }

export interface PaymentConfig {
  depositProvider: 'megapay' | 'daraja';
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  minBet: number;
  maxBet: number;
  maxPayout: number;
  /** Pre-filled stake and the four quick stakes (brand settings). */
  defaultBet: number;
  betChips: number[];
  /** Brand's own deposit chips (null = chosen from the limits). */
  depositChips: number[] | null;
  /** Per-request and per-day withdrawal caps (null = none). */
  maxWithdrawal: number | null;
  dailyWithdrawal: number | null;
  /** The brand's deposit / withdrawal switches (maintenance included). */
  depositsOpen: boolean;
  withdrawalsOpen: boolean;
  /** Approved withdrawals are paid by M-Pesa automatically (the brand's payment owner has a B2C account). */
  payoutsAutomatic: boolean;
  offer: BonusOffer | null;
}

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  depositProvider: 'megapay', minDeposit: 100, maxDeposit: 150_000, minWithdrawal: 100,
  minBet: 50, maxBet: 100_000, maxPayout: 500_000, defaultBet: 100, betChips: [50, 100, 200, 500], depositChips: null,
  maxWithdrawal: null, dailyWithdrawal: null, depositsOpen: true, withdrawalsOpen: true, payoutsAutomatic: false, offer: null,
};

/** Coerce the fn_public_payment_config() payload; anything missing or odd falls back to the defaults. */
export function parsePaymentConfig(raw: unknown): PaymentConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : d;
  };
  const min = num(r.min_deposit, DEFAULT_PAYMENT_CONFIG.minDeposit);
  const max = Math.max(min, num(r.max_deposit, DEFAULT_PAYMENT_CONFIG.maxDeposit));
  const o = (r.offer && typeof r.offer === 'object' ? r.offer : null) as Record<string, unknown> | null;
  const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const offer: BonusOffer | null = o
    ? { welcome: Math.round(n0(o.welcome)), matchPct: Math.round(n0(o.match_pct)), matchCap: Math.round(n0(o.match_cap)), wagerX: n0(o.wager_x) }
    : null;
  const minBet = num(r.min_bet, DEFAULT_PAYMENT_CONFIG.minBet);
  const maxBet = Math.max(minBet, num(r.max_bet, DEFAULT_PAYMENT_CONFIG.maxBet));
  const list = (v: unknown): number[] | null => Array.isArray(v) && v.length > 0 && v.every((x) => Number.isFinite(Number(x)) && Number(x) > 0) ? v.map((x) => Math.round(Number(x))) : null;
  const clampBet = (n: number) => Math.min(maxBet, Math.max(minBet, n));
  const chips = (list(r.bet_chips) ?? [minBet, minBet * 2, minBet * 4, minBet * 10]).map(clampBet).slice(0, 4);
  const opt = (v: unknown) => { const n = Number(v); return v != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  return {
    depositProvider: r.deposit_provider === 'daraja' ? 'daraja' : 'megapay',
    minDeposit: min,
    maxDeposit: max,
    minWithdrawal: num(r.min_withdrawal, DEFAULT_PAYMENT_CONFIG.minWithdrawal),
    minBet,
    maxBet,
    maxPayout: num(r.max_payout, DEFAULT_PAYMENT_CONFIG.maxPayout),
    defaultBet: clampBet(num(r.default_bet, Math.max(minBet, DEFAULT_PAYMENT_CONFIG.defaultBet))),
    betChips: chips.length === 4 ? chips : DEFAULT_PAYMENT_CONFIG.betChips.map(clampBet),
    depositChips: (list(r.deposit_chips) ?? null)?.filter((q) => q >= min && q <= max) ?? null,
    maxWithdrawal: opt(r.max_withdrawal),
    dailyWithdrawal: opt(r.daily_withdrawal),
    depositsOpen: r.deposits !== false,
    withdrawalsOpen: r.withdrawals !== false,
    payoutsAutomatic: r.payouts_automatic === true,
    offer: offer && (offer.welcome > 0 || (offer.matchPct > 0 && offer.matchCap > 0)) ? offer : null,
  };
}

/** Client-side check before anything is sent (the server re-checks everything). Returns an error or null. */
export function validateDepositAmount(amount: number, cfg: PaymentConfig): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount.';
  if (!Number.isInteger(amount)) return 'Enter a whole number of shillings.';
  if (amount < cfg.minDeposit) return `The smallest deposit is KES ${cfg.minDeposit.toLocaleString('en-KE')}.`;
  if (amount > cfg.maxDeposit) return `The largest single deposit is KES ${cfg.maxDeposit.toLocaleString('en-KE')}.`;
  return null;
}

/** Server error codes → player copy. Unknown codes never leak through. */
export function depositErrorCopy(code: string, message?: string): string {
  const c = (code || '').split(':')[0];
  switch (c) {
    case 'AUTH_REQUIRED': return 'Please sign in to continue.';
    case 'BELOW_MIN': case 'ABOVE_MAX': case 'INVALID_AMOUNT': case 'INVALID_PHONE':
    case 'RATE_LIMITED': case 'DEPOSITS_DISABLED': case 'MEGAPAY_DISABLED':
    case 'ACCOUNT_BANNED': case 'OPERATOR_CANNOT_DEPOSIT': case 'MEGAPAY_REJECTED':
    case 'MEGAPAY_UNREACHABLE': case 'MEGAPAY_NOT_CONFIGURED':
      // These messages are written by our own edge function for players.
      return message || 'Deposit could not be started. Please try again.';
    case 'network': return 'Connection error. Check your internet and try again.';
    default: return 'Deposit could not be started. Please try again.';
  }
}

/** Minimal shape of supabase.functions.invoke, so tests can pass a fake. */
export type Invoke = (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;

async function fnError(error: unknown): Promise<{ code: string; message?: string }> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
    if (ctx?.json) {
      const b = (await ctx.json()) as { error?: string; message?: string };
      return { code: String(b?.error || 'network'), message: b?.message };
    }
  } catch { /* fall through */ }
  return { code: 'network' };
}

/** Send the prompt. Resolves to the deposit id; throws an Error whose message is player copy. */
export async function startDeposit(invoke: Invoke, amount: number, phone: string): Promise<string> {
  const { data, error } = await invoke('megapay-stk-push', { body: { amount, phone } });
  if (error) {
    const e = await fnError(error);
    throw new Error(depositErrorCopy(e.code, e.message));
  }
  const d = (data ?? {}) as { success?: boolean; id?: string; error?: string; message?: string };
  if (!d.success || !d.id) throw new Error(depositErrorCopy(String(d.error || ''), d.message));
  return d.id;
}

export type PollOutcome =
  | { kind: 'completed'; receipt: string | null }
  | { kind: 'failed' }
  | { kind: 'waiting' };   // not settled before the deadline; the server keeps checking

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStatus?: (s: DepositStatus) => void;
  signal?: { aborted: boolean };
}

/**
 * Poll megapay-status until the deposit is final or the deadline passes.
 * Network blips are ignored (the next tick retries). "timeout" is NOT failure:
 * Mega Pay can still confirm a late payment, and the reconcile job will credit it.
 */
export async function pollDeposit(invoke: Invoke, id: string, o: PollOptions = {}): Promise<PollOutcome> {
  const interval = o.intervalMs ?? 3000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const deadline = now() + (o.timeoutMs ?? 120_000);
  while (now() < deadline) {
    if (o.signal?.aborted) return { kind: 'waiting' };
    await sleep(interval);
    let res: { data: unknown; error: unknown };
    try { res = await invoke('megapay-status', { body: { id } }); } catch { continue; }
    if (res.error) continue;
    const d = (res.data ?? {}) as { status?: DepositStatus; receipt?: string | null };
    if (d.status) o.onStatus?.(d.status);
    if (d.status === 'completed') return { kind: 'completed', receipt: d.receipt ?? null };
    if (d.status === 'failed' || d.status === 'cancelled') return { kind: 'failed' };
  }
  return { kind: 'waiting' };
}

/** Quick-pick chips that respect the brand's limits. */
export function quickDepositAmounts(cfg: PaymentConfig): number[] {
  if (cfg.depositChips && cfg.depositChips.length) return cfg.depositChips.slice(0, 6);
  const base = [100, 250, 500, 1000, 2000, 5000];
  const ok = base.filter((q) => q >= cfg.minDeposit && q <= cfg.maxDeposit);
  if (ok.length >= 3) return ok.slice(0, 6);
  const out = [cfg.minDeposit];
  for (const m of [2, 5, 10, 20]) if (cfg.minDeposit * m <= cfg.maxDeposit) out.push(cfg.minDeposit * m);
  return out;
}
