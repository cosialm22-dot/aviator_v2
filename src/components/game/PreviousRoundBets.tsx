import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import LiveBetsTable from './LiveBetsTable';

// Bets from the most recently crashed round, for the "Previous" tab.
interface BetRow {
  id: string; username: string; avatar_color: string; amount: number;
  cashout_multiplier: number | null; winnings: number | null;
  status: 'active' | 'won' | 'lost'; is_bot: boolean;
}

export default function PreviousRoundBets({ roundId }: { roundId: string | null }) {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!roundId) { setBets([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('bets')
        .select('id, username, avatar_color, amount, cashout_multiplier, winnings, status, is_bot')
        .eq('round_id', roundId)
        .order('winnings', { ascending: false, nullsFirst: false });
      if (!cancelled) {
        setBets((data ?? []).map((b: BetRow) => ({ ...b, amount: Number(b.amount) })));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  if (loading) return <div className="text-center text-slate-600 text-xs py-8">Loading...</div>;
  if (!roundId) return <div className="text-center text-slate-600 text-xs py-8">No previous round yet</div>;
  return <LiveBetsTable bets={bets} status="crashed" />;
}
