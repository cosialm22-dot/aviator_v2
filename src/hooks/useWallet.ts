import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// useWallet - SERVER-AUTHORITATIVE CASHIER (Phase 5b)
// ----------------------------------------------------------------------------
// No direct writes to wallets/transactions (those are READ-ONLY for clients
// after the security lockdown). Money moves only through the deployed M-Pesa
// rails and the request_withdrawal RPC:
//   • deposit  -> mpesa-stk-push edge fn; the STK callback credits the wallet.
//                 We poll mpesa_stk_requests for confirmation.
//   • withdraw -> request_withdrawal RPC creates a pending withdrawal_request;
//                 payout (mpesa-b2c) is triggered by admin/auto-approve.
// The public API ({ deposit, withdraw, depositing, withdrawing }) is unchanged.
// ============================================================================

const DEPOSIT_POLL_MS = 3000;
const DEPOSIT_TIMEOUT_MS = 90_000; // Daraja STK prompts expire ~60s; allow margin

/** Normalise a Kenyan MSISDN to Daraja format 254XXXXXXXXX, or null if invalid. */
function normalizePhone(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  let n: string;
  if (d.length === 9) n = '254' + d;                          // 7XXXXXXXX
  else if (d.length === 10 && d.startsWith('0')) n = '254' + d.slice(1); // 07XXXXXXXX
  else if (d.length === 12 && d.startsWith('254')) n = d;      // 2547XXXXXXXX
  else return null;
  return /^254[0-9]{9}$/.test(n) ? n : null;
}

/** Map raw backend error codes to safe, user-facing copy. Never leak internals. */
function friendly(code: string, op: 'deposit' | 'withdrawal'): string {
  const map: Record<string, string> = {
    AUTH_REQUIRED: 'Please sign in to continue.',
    INVALID_PHONE: 'Enter a valid M-Pesa phone number.',
    INVALID_AMOUNT: 'Enter a valid amount.',
    AMOUNT_TOO_LOW: 'Amount is below the minimum.',
    AMOUNT_NOT_INTEGER: 'Enter a whole-number amount.',
    INSUFFICIENT_BALANCE: 'Insufficient balance.',
    NO_WALLET: 'Wallet error. Please refresh and try again.',
    WITHDRAWAL_PENDING: 'You already have a withdrawal being processed.',
    RATE_LIMIT: 'Too many attempts - please wait a minute and try again.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return op === 'deposit'
    ? 'Deposit could not be started. Please try again.'
    : 'Withdrawal request failed. Please try again.';
}

async function extractFnError(error: unknown): Promise<string> {
  // supabase-js wraps non-2xx Edge responses; the body holds { error, message }.
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
    if (ctx?.json) {
      const body = (await ctx.json()) as { error?: string; message?: string };
      return String(body?.error || body?.message || 'network');
    }
  } catch { /* fall through */ }
  return 'network';
}

export function useWallet(userId: string | undefined, onRefresh: () => Promise<void>) {
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  /**
   * Initiate an M-Pesa STK-push deposit.
   * @returns true if the deposit was CONFIRMED (wallet credited) before timeout,
   *          false if the prompt was sent but is still awaiting confirmation.
   */
  const deposit = useCallback(async (
    amount: number,
    method: 'mpesa' | 'card',
    details: Record<string, string>,
  ): Promise<boolean> => {
    if (!userId) throw new Error('Please sign in to continue.');
    if (method !== 'mpesa') throw new Error('Only M-Pesa is currently supported.');
    const phone = normalizePhone(details.phone || '');
    if (!phone) throw new Error('Enter a valid M-Pesa phone number.');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a whole-number amount.');

    setDepositing(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { amount, phone_number: phone, user_id: userId },
      });
      if (error) throw new Error(friendly(await extractFnError(error), 'deposit'));
      if (!data?.success) throw new Error(friendly(String(data?.error || ''), 'deposit'));

      const checkoutId: string | undefined = data.checkout_request_id;
      const deadline = Date.now() + DEPOSIT_TIMEOUT_MS;
      while (checkoutId && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, DEPOSIT_POLL_MS));
        const { data: row } = await supabase
          .from('mpesa_stk_requests').select('status')
          .eq('checkout_request_id', checkoutId).maybeSingle();
        const s = row?.status;
        if (s === 'completed') { await onRefresh(); return true; }
        if (s === 'failed' || s === 'cancelled' || s === 'timeout') {
          throw new Error('Payment was not completed.');
        }
      }
      await onRefresh(); // may already be credited; reflect latest balance
      return false;      // still pending confirmation
    } catch (e) {
      // Every throw inside this block is already user-facing copy.
      throw e instanceof Error ? e : new Error(friendly('', 'deposit'));
    } finally {
      setDepositing(false);
    }
  }, [userId, onRefresh]);

  /** Create a pending withdrawal request (payout handled server-side). */
  const withdraw = useCallback(async (
    amount: number,
    method: 'mpesa' | 'bank',
    details: Record<string, string>,
  ): Promise<void> => {
    if (!userId) throw new Error('Please sign in to continue.');
    if (method !== 'mpesa') throw new Error('Only M-Pesa withdrawals are currently supported.');
    const phone = normalizePhone(details.phone || '');
    if (!phone) throw new Error('Enter a valid M-Pesa phone number.');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a whole-number amount.');

    setWithdrawing(true);
    try {
      const { error } = await supabase.rpc('request_withdrawal', { p_amount: amount, p_phone: phone });
      if (error) throw new Error(friendly(error.message, 'withdrawal'));
      await onRefresh();
    } finally {
      setWithdrawing(false);
    }
  }, [userId, onRefresh]);

  return { deposit, withdraw, depositing, withdrawing };
}
