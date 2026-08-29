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

// New cents-model columns (migration 20260829000000_bonus_wagering_engine).
interface BonusRow {
  amount: number;      // cents granted
  wagering_x: number;  // wager multiple
  wagered: number;     // cents staked toward this bonus
  status: string;      // active | cleared | void
}

// Map the engine status onto the hook's stable public status vocabulary.
const STATUS_MAP: Record<string, FirstDepositBonus['status']> = {
  active: 'active', cleared: 'released', void: 'forfeited',
};

export function useBonus(userId: string | undefined) {
  const [bonus, setBonus] = useState<FirstDepositBonus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setBonus(null); setLoading(false); return; }
    const { data } = await supabase
      .from('bonuses')
      .select('amount, wagering_x, wagered, status')
      .eq('user_id', userId)
      .eq('type', 'first_deposit_match')
      .maybeSingle();
    const row = data as BonusRow | null;
    // Engine tracks cents + wagering_x/wagered; convert to the KES + required/progress
    // shape the UI already expects (amount/wageringRequired/wageringProgress in KES).
    const requiredCents = row ? Math.floor(Number(row.amount) * Number(row.wagering_x)) : 0;
    setBonus(row ? {
      amount: Number(row.amount) / 100,
      wageringRequired: requiredCents / 100,
      wageringProgress: Math.min(Number(row.wagered), requiredCents) / 100,
      status: STATUS_MAP[row.status] ?? 'active',
      expiresAt: null,
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
