import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { generateReference } from '../lib/formatters';

export function useWallet(userId: string | undefined, onRefresh: () => Promise<void>) {
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const deposit = useCallback(async (amount: number, method: 'mpesa' | 'card', _details: Record<string, string>) => {
    if (!userId) throw new Error('Not authenticated');
    setDepositing(true);
    try {
      // Simulate payment processing delay
      await new Promise(res => setTimeout(res, 2000));

      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!wallet) throw new Error('Wallet not found');

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
    } finally {
      setDepositing(false);
    }
  }, [userId, onRefresh]);

  const withdraw = useCallback(async (amount: number, method: 'mpesa' | 'bank', _details: Record<string, string>) => {
    if (!userId) throw new Error('Not authenticated');
    setWithdrawing(true);
    try {
      await new Promise(res => setTimeout(res, 1500));

      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!wallet) throw new Error('Wallet not found');
      if (Number(wallet.balance) < amount) throw new Error('Insufficient balance');

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
    } finally {
      setWithdrawing(false);
    }
  }, [userId, onRefresh]);

  return { deposit, withdraw, depositing, withdrawing };
}
