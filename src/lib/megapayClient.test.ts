import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAYMENT_CONFIG, depositErrorCopy, parsePaymentConfig, pollDeposit, quickDepositAmounts,
  startDeposit, validateDepositAmount, type Invoke,
} from './megapayClient';

const cfg = DEFAULT_PAYMENT_CONFIG;

/** A fake supabase.functions.invoke that answers from a script, recording every call. */
function fake(script: Array<{ data?: unknown; error?: unknown } | Error>) {
  const calls: Array<{ name: string; body: unknown }> = [];
  const invoke: Invoke = async (name, { body }) => {
    calls.push({ name, body });
    const next = script.shift();
    if (!next) throw new Error('script exhausted');
    if (next instanceof Error) throw next;
    return { data: next.data ?? null, error: next.error ?? null };
  };
  return { invoke, calls };
}
const httpErr = (body: unknown) => ({ context: { json: async () => body } });
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

describe('payment config', () => {
  it('reads the server payload', () => {
    expect(parsePaymentConfig({ deposit_provider: 'megapay', min_deposit: 200, max_deposit: 70000, min_withdrawal: 150 }))
      .toEqual({ depositProvider: 'megapay', minDeposit: 200, maxDeposit: 70000, minWithdrawal: 150 });
  });
  it('falls back to safe defaults for missing or junk values', () => {
    expect(parsePaymentConfig(null)).toEqual(cfg);
    expect(parsePaymentConfig({ min_deposit: 'x', max_deposit: -5 })).toEqual(cfg);
  });
  it('never lets max fall below min', () => {
    expect(parsePaymentConfig({ min_deposit: 500, max_deposit: 100 }).maxDeposit).toBe(500);
  });
});

describe('amount validation', () => {
  it('accepts whole amounts inside the limits', () => {
    expect(validateDepositAmount(100, cfg)).toBeNull();
    expect(validateDepositAmount(150000, cfg)).toBeNull();
  });
  it('refuses empty, fractional, too small and too large', () => {
    expect(validateDepositAmount(0, cfg)).toMatch(/Enter an amount/);
    expect(validateDepositAmount(NaN, cfg)).toMatch(/Enter an amount/);
    expect(validateDepositAmount(100.5, cfg)).toMatch(/whole number/);
    expect(validateDepositAmount(99, cfg)).toMatch(/smallest deposit is KES 100/);
    expect(validateDepositAmount(150001, cfg)).toMatch(/largest single deposit is KES 150,000/);
  });
  it('quick amounts stay inside the limits', () => {
    expect(quickDepositAmounts(cfg)).toEqual([100, 250, 500, 1000, 2000, 5000]);
    const high = { ...cfg, minDeposit: 3000, maxDeposit: 100000 };
    expect(quickDepositAmounts(high).every((q) => q >= 3000 && q <= 100000)).toBe(true);
    expect(quickDepositAmounts(high)[0]).toBe(3000);
  });
});

describe('startDeposit', () => {
  it('sends only amount and phone (the player comes from the session) and returns the id', async () => {
    const f = fake([{ data: { success: true, id: 'dep-1' } }]);
    await expect(startDeposit(f.invoke, 500, '254712345678')).resolves.toBe('dep-1');
    expect(f.calls).toEqual([{ name: 'megapay-stk-push', body: { amount: 500, phone: '254712345678' } }]);
  });
  it('shows the server\'s player-facing message for known refusals', async () => {
    const f = fake([{ error: httpErr({ error: 'BELOW_MIN', message: 'The smallest deposit is KES 100.' }) }]);
    await expect(startDeposit(f.invoke, 50, '254712345678')).rejects.toThrow('The smallest deposit is KES 100.');
  });
  it('never leaks unknown server text', async () => {
    const f = fake([{ error: httpErr({ error: 'INTERNAL_ERROR', message: 'relation "x" does not exist' }) }]);
    await expect(startDeposit(f.invoke, 500, '254712345678')).rejects.toThrow('Deposit could not be started. Please try again.');
  });
  it('reports connection problems', async () => {
    const f = fake([{ error: new Error('fetch failed') }]);
    await expect(startDeposit(f.invoke, 500, '254712345678')).rejects.toThrow(/Connection error/);
  });
  it('treats a 200 without success as a failure', async () => {
    const f = fake([{ data: { success: false } }]);
    await expect(startDeposit(f.invoke, 500, '254712345678')).rejects.toThrow(/could not be started/);
  });
  it('maps codes to copy', () => {
    expect(depositErrorCopy('AUTH_REQUIRED')).toMatch(/sign in/);
    expect(depositErrorCopy('RATE_LIMITED', 'Too many deposit prompts.')).toBe('Too many deposit prompts.');
  });
});

describe('pollDeposit', () => {
  it('returns completed with the receipt as soon as the server says so', async () => {
    const c = clock(); const seen: string[] = [];
    const f = fake([{ data: { status: 'pending' } }, { data: { status: 'completed', receipt: 'TK12AB' } }]);
    const r = await pollDeposit(f.invoke, 'dep-1', { ...c, onStatus: (s) => seen.push(s) });
    expect(r).toEqual({ kind: 'completed', receipt: 'TK12AB' });
    expect(seen).toEqual(['pending', 'completed']);
    expect(f.calls.every((x) => x.name === 'megapay-status')).toBe(true);
  });
  it('returns failed on failed or cancelled', async () => {
    expect(await pollDeposit(fake([{ data: { status: 'failed' } }]).invoke, 'd', clock())).toEqual({ kind: 'failed' });
    expect(await pollDeposit(fake([{ data: { status: 'cancelled' } }]).invoke, 'd', clock())).toEqual({ kind: 'failed' });
  });
  it('does not treat "timeout" as a failure — a late payment can still be credited', async () => {
    const c = clock();
    const f = fake(Array.from({ length: 50 }, () => ({ data: { status: 'timeout' } })));
    expect(await pollDeposit(f.invoke, 'd', { ...c, intervalMs: 3000, timeoutMs: 9000 })).toEqual({ kind: 'waiting' });
  });
  it('rides out network errors and keeps polling', async () => {
    const c = clock();
    const f = fake([new Error('offline'), { error: httpErr({ error: 'INTERNAL_ERROR' }) }, { data: { status: 'completed', receipt: null } }]);
    expect(await pollDeposit(f.invoke, 'd', c)).toEqual({ kind: 'completed', receipt: null });
  });
  it('gives up at the deadline without claiming failure', async () => {
    const c = clock();
    const f = fake(Array.from({ length: 50 }, () => ({ data: { status: 'pending' } })));
    const r = await pollDeposit(f.invoke, 'd', { ...c, intervalMs: 3000, timeoutMs: 12000 });
    expect(r).toEqual({ kind: 'waiting' });
    expect(f.calls.length).toBe(4);
  });
  it('stops when aborted', async () => {
    const c = clock(); const signal = { aborted: false };
    const f = fake([{ data: { status: 'pending' } }, { data: { status: 'pending' } }]);
    const r = await pollDeposit(f.invoke, 'd', { ...c, signal, onStatus: () => { signal.aborted = true; } });
    expect(r).toEqual({ kind: 'waiting' });
    expect(f.calls.length).toBe(1);
  });
});
