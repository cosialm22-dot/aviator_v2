import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { BetSlot } from './useGame';

// ============================================================================
// usePromos - player-facing promotions: FREE BETS + RAIN.
// ----------------------------------------------------------------------------
// Independent of the core round consumer (useGame). Reads the player's active
// free bets and any open rain drop via Realtime, and exposes the two money
// actions (place_free_bet / claim_rain). All settlement stays server-side.
// ============================================================================

export interface FreeBet {
  id: string;
  amount: number;
  expires_at: string | null;
}

export interface OpenRain {
  id: string;
  per_user: number;
  message: string | null;
  expires_at: string;
}

interface FreeBetRow { id: string; amount: number; status: string; expires_at: string | null }
interface RainRow { id: string; per_user: number; message: string | null; expires_at: string; claims_count: number; max_claims: number }

export function usePromos(userId: string | undefined, onRefreshWallet: () => Promise<void>) {
  const [freeBets, setFreeBets] = useState<FreeBet[]>([]);
  const [rain, setRain] = useState<OpenRain | null>(null);
  const [busy, setBusy] = useState(false);
  const claimedRef = useRef<Set<string>>(new Set());

  const loadFreeBets = useCallback(async () => {
    if (!userId) { setFreeBets([]); return; }
    const { data } = await supabase
      .from('free_bets')
      .select('id, amount, status, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    const now = Date.now();
    setFreeBets(((data ?? []) as FreeBetRow[])
      .filter((f) => !f.expires_at || new Date(f.expires_at).getTime() > now)
      .map((f) => ({ id: f.id, amount: Number(f.amount), expires_at: f.expires_at })));
  }, [userId]);

  const loadRain = useCallback(async () => {
    if (!userId) { setRain(null); return; }
    // Open events the player has not already claimed; soonest to expire first.
    const [{ data: events }, { data: claims }] = await Promise.all([
      supabase.from('rain_events').select('id, per_user, message, expires_at, claims_count, max_claims')
        .gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: true }).limit(10),
      supabase.from('rain_claims').select('rain_id').eq('user_id', userId),
    ]);
    const claimed = new Set((claims ?? []).map((c: { rain_id: string }) => c.rain_id));
    const open = ((events ?? []) as RainRow[]).find((e) => e.claims_count < e.max_claims && !claimed.has(e.id));
    setRain(open ? { id: open.id, per_user: Number(open.per_user), message: open.message, expires_at: open.expires_at } : null);
  }, [userId]);

  useEffect(() => {
    void loadFreeBets();
    void loadRain();
    if (!userId) return;
    const ch = supabase
      .channel(`rt-promos-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'free_bets', filter: `user_id=eq.${userId}` }, () => void loadFreeBets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rain_events' }, () => void loadRain())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [userId, loadFreeBets, loadRain]);

  const placeFreeBet = useCallback(async (roundId: string, freeBetId: string, auto: number | null, slot: BetSlot = 1) => {
    const { error } = await supabase.rpc('place_free_bet', {
      p_round_id: roundId, p_free_bet_id: freeBetId, p_auto_cashout: auto, p_slot: slot,
    });
    if (error) throw new Error(error.message);
    await loadFreeBets();
    await onRefreshWallet();
  }, [loadFreeBets, onRefreshWallet]);

  const claimRain = useCallback(async (rainId: string) => {
    if (busy || claimedRef.current.has(rainId)) return;
    claimedRef.current.add(rainId);
    setBusy(true);
    try {
      const { error } = await supabase.rpc('claim_rain', { p_rain_id: rainId });
      if (error) throw new Error(error.message);
      setRain(null);
      await onRefreshWallet();
    } finally { setBusy(false); }
  }, [busy, onRefreshWallet]);

  return { freeBets, rain, busy, placeFreeBet, claimRain };
}
