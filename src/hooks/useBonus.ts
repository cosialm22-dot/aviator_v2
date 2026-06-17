import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// useBonus - the player's first-deposit match bonus (read-only).
// ----------------------------------------------------------------------------
// Reads the player's first_deposit_match bonus row (granted + tracked entirely
// server-side; see migration 20260617020000). Used to:
//   * advertise the offer to players who have not deposited yet (eligible), and
//   * show wagering progress + the locked amount while a bonus is active.
// All money logic stays in the DB; this hook never writes.
// ============================================================================

export interface FirstDepositBonus {
  amount: number;             // locked bonus credit granted
  wageringRequired: number;
  wageringProgress: number;
  status: 'active' | 'released' | 'forfeited' | 'expired';
  expiresAt: string | null;
}

interface BonusRow {
  amount: number;
  wagering_required: number;
  wagering_progress: number;
  status: string;
  expires_at: string | null;
}

export function useBonus(userId: string | undefined) {
  const [bonus, setBonus] = useState<FirstDepositBonus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setBonus(null); setLoading(false); return; }
    const { data } = await supabase
      .from('bonuses')
      .select('amount, wagering_required, wagering_progress, status, expires_at')
      .eq('user_id', userId)
      .eq('type', 'first_deposit_match')
      .maybeSingle();
    const row = data as BonusRow | null;
    setBonus(row ? {
      amount: Number(row.amount),
      wageringRequired: Number(row.wagering_required),
      wageringProgress: Number(row.wagering_progress),
      status: row.status as FirstDepositBonus['status'],
      expiresAt: row.expires_at,
    } : null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    if (!userId) return;
    const ch = supabase
      .channel(`rt-bonus-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bonuses', filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [userId, load]);

  // A player is eligible for the offer until a first-deposit bonus exists.
  const eligibleForFirstDeposit = !loading && bonus === null;
  // An active bonus still locked for withdrawal.
  const activeLocked = bonus && bonus.status === 'active' ? bonus : null;

  return { bonus, activeLocked, eligibleForFirstDeposit, loading, reload: load };
}
