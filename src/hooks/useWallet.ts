import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { generateReference } from '../lib/formatters';

/**
 * Sanitize wallet operation errors for user display.
 * Never expose raw backend details.
 */
function sanitizeWalletError(e: unknown, operation: 'deposit' | 'withdrawal'): string {
  const msg = e instanceof Error ? e.message.toLowerCase() : '';

  if (msg.includes('insufficient') || msg.includes('balance')) {
    return 'Insufficient balance.';
  }
  if (msg.includes('not authenticated') || msg.includes('auth')) {
    return 'Please sign in to continue.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'Connection error. Check your internet and try again.';
  }
  if (msg.includes('wallet not found')) {
    return 'Wallet error. Please refresh and try again.';
  }

  // Generic fallback — never expose raw message
  console.error(`[Wallet] ${operation} failed:`, e);
  return operation === 'deposit' ? 'Deposit failed. Please try again.' : 'Withdrawal failed. Please try again.';
}

export function useWallet(userId: string | undefined, onRefresh: () => Promise<void>) {
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const deposit = useCallback(async (amount: number, method: 'mpesa' | 'card', _details: Record<string, string>) => {
    if (!userId) throw new Error('Please sign in to continue.');
    setDepositing(true);
    try {
      // Simulate payment processing delay
      await new Promise(res => setTimeout(res, 2000));

      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!wallet) throw new Error('Wallet error. Please refresh and try again.');

      const newBalance = Number(wallet.balance) + amount;
      await supabase
        .from('wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      await supabase.from('transactions').insert({
        user_id: userId,
        type: 'deposit',
        amount,
        payment_method: method,
        reference: generateReference(),
        description: `Deposit via ${method === 'mpesa' ? 'M-Pesa' : 'Card'}`,
        status: 'completed',
      });

      await onRefresh();
    } catch (e) {
      throw new Error(sanitizeWalletError(e, 'deposit'));
    } finally {
      setDepositing(false);
    }
  }, [userId, onRefresh]);

  const withdraw = useCallback(async (amount: number, method: 'mpesa' | 'bank', _details: Record<string, string>) => {
    if (!userId) throw new Error('Please sign in to continue.');
    setWithdrawing(true);
    try {
      await new Promise(res => setTimeout(res, 1500));

      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!wallet) throw new Error('Wallet error. Please refresh and try again.');
      if (Number(wallet.balance) < amount) throw new Error('Insufficient balance.');

      const newBalance = Number(wallet.balance) - amount;
      await supabase
        .from('wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      await supabase.from('transactions').insert({
        user_id: userId,
        type: 'withdrawal',
        amount,
        payment_method: method,
        reference: generateReference(),
        description: `Withdrawal via ${method === 'mpesa' ? 'M-Pesa' : 'Bank Transfer'}`,
        status: 'completed',
      });

      await onRefresh();
    } catch (e) {
      throw new Error(sanitizeWalletError(e, 'withdrawal'));
    } finally {
      setWithdrawing(false);
    }
  }, [userId, onRefresh]);

  return { deposit, withdraw, depositing, withdrawing };
}
