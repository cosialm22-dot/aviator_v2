import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toDarajaMsisdn } from '../lib/phone';
import { pollDeposit, startDeposit, type Invoke } from '../lib/megapayClient';

// ============================================================================
// useWallet - SERVER-AUTHORITATIVE CASHIER (Phase 5b)
// ----------------------------------------------------------------------------
// No direct writes to wallets/transactions (those are READ-ONLY for clients
// after the security lockdown). Money moves only through the deployed M-Pesa
// rails and the request_withdrawal RPC:
//   • deposit  -> megapay-stk-push edge fn (Mega Pay M-Pesa prompt). We poll
//                 megapay-status, which asks Mega Pay and credits the wallet once;
//                 the megapay_reconcile job settles anything the browser misses.
//   • withdraw -> request_withdrawal RPC holds the amount and creates the request
//                 (approved at once when small and low-risk); the payouts-worker
//                 sends it by M-Pesa B2C, or staff pay it by hand (migration 20260930097000).
// The public API ({ deposit, withdraw, depositing, withdrawing }) is unchanged.
// ============================================================================

const DEPOSIT_POLL_MS = 3000;
const DEPOSIT_TIMEOUT_MS = 120_000; // the prompt expires after ~60s; Mega Pay can confirm a little later

export type DepositStage = 'sending' | 'awaiting_pin';

const invoke: Invoke = (name, opts) =>
  supabase.functions.invoke(name, opts as { body: Record<string, unknown> }) as Promise<{ data: unknown; error: unknown }>;

/** What the player is told after a withdrawal request: paid automatically, or reviewed first. */
export interface WithdrawalResult { status: 'approved' | 'pending'; automatic: boolean }

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
    INCORRECT_PASSWORD: 'Incorrect password. Please try again.',
    PASSWORD_REQUIRED: 'Enter your password to confirm this withdrawal.',
    SESSION_EXPIRED: 'Your session expired. Please sign in again.',
    WITHDRAWAL_PENDING: 'You already have a withdrawal in progress. Wait for it, or cancel it in Profile → Payments.',
    WITHDRAWALS_DISABLED: 'Withdrawals are paused right now. Please try again later.',
    MAINTENANCE_MODE: 'We are doing maintenance. Please try again shortly.',
    ACCOUNT_BANNED: 'This account cannot withdraw. Contact support.',
    DAILY_LIMIT: 'This is more than your daily withdrawal limit allows.',
    AMOUNT_TOO_HIGH: 'Amount is above the maximum for one withdrawal.',
    MARKETER_DEMO_NON_WITHDRAWABLE: 'Marketer demo balance cannot be withdrawn.',
    RATE_LIMIT: 'Too many attempts - please wait a minute and try again.',
    network: 'Connection error. Check your internet and try again.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return op === 'deposit'
    ? 'Deposit could not be started. Please try again.'
    : 'Withdrawal request failed. Please try again.';
}

export function useWallet(userId: string | undefined, onRefresh: () => Promise<void>) {
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  /**
   * Mega Pay M-Pesa deposit: send the prompt, then poll until the server confirms it.
   * @param onStage  optional progress callback for the cashier UI.
   * @returns true if the deposit was CONFIRMED (wallet credited) before the poll deadline,
   *          false if the prompt went out but Mega Pay has not confirmed yet (the server keeps
   *          checking and credits it automatically).
   */
  const deposit = useCallback(async (
    amount: number,
    method: 'mpesa' | 'card',
    details: Record<string, string>,
    onStage?: (stage: DepositStage) => void,
  ): Promise<boolean> => {
    if (!userId) throw new Error('Please sign in to continue.');
    if (method !== 'mpesa') throw new Error('Only M-Pesa is currently supported.');
    const phone = toDarajaMsisdn(details.phone || '');
    if (!phone) throw new Error('Enter a valid M-Pesa phone number.');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a whole-number amount.');

    setDepositing(true);
    try {
      onStage?.('sending');
      const id = await startDeposit(invoke, amount, phone);
      onStage?.('awaiting_pin');
      const r = await pollDeposit(invoke, id, { intervalMs: DEPOSIT_POLL_MS, timeoutMs: DEPOSIT_TIMEOUT_MS });
      await onRefresh();
      if (r.kind === 'failed') {
        throw new Error('The M-Pesa payment was not completed (cancelled, wrong PIN or not enough balance). Please try again.');
      }
      return r.kind === 'completed';
    } finally {
      setDepositing(false);
    }
  }, [userId, onRefresh]);

  /**
   * Create a pending withdrawal request (payout handled server-side).
   *
   * SECURITY (step-up auth): a withdrawal moves money, so we re-verify the
   * account password immediately before issuing the request. This blocks anyone
   * who finds an unlocked/abandoned session from cashing out. We re-authenticate
   * with supabase.auth.signInWithPassword against the SESSION's own email (the
   * password is never stored, never sent anywhere except Supabase Auth, and the
   * call simply re-issues a session for the same user on success). Only on a
   * verified password do we call request_withdrawal.
   */
  const withdraw = useCallback(async (
    amount: number,
    method: 'mpesa' | 'bank',
    details: Record<string, string>,
  ): Promise<WithdrawalResult> => {
    if (!userId) throw new Error('Please sign in to continue.');
    if (method !== 'mpesa') throw new Error('Only M-Pesa withdrawals are currently supported.');
    const phone = toDarajaMsisdn(details.phone || '');
    if (!phone) throw new Error('Enter a valid M-Pesa phone number.');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a whole-number amount.');

    const password = (details.password || '').trim();
    if (!password) throw new Error(friendly('PASSWORD_REQUIRED', 'withdrawal'));

    setWithdrawing(true);
    try {
      // Resolve the current account's email from the live session (do not trust
      // the form's phone field for identity - identity comes from the session).
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      const email = user?.email;
      if (userErr || !email) throw new Error(friendly('SESSION_EXPIRED', 'withdrawal'));

      // Step-up re-authentication. A failure here means the wrong password.
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) throw new Error(friendly('INCORRECT_PASSWORD', 'withdrawal'));

      const { data, error } = await supabase.rpc('request_withdrawal', { p_amount: amount, p_phone: phone });
      if (error) throw new Error(friendly(error.message, 'withdrawal'));
      await onRefresh();
      const r = (data ?? {}) as { status?: string; automatic_payout?: boolean };
      return { status: r.status === 'approved' ? 'approved' : 'pending', automatic: r.automatic_payout === true };
    } finally {
      setWithdrawing(false);
    }
  }, [userId, onRefresh]);

  return { deposit, withdraw, depositing, withdrawing };
}
