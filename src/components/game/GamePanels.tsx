import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { FreeBet } from '../../hooks/usePromos';
import type { GamePanel } from '../../lib/gamePanels';
import { fmtX, money, multColor } from '../../lib/betBoard';

// The dialogs behind the ☰ game menu: Free Bets, My Bet History, Game Limits and How To Play.

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#2a2b2e] bg-[#1b1c1d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2a2b2e] px-4 py-3">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#9ea0a3] hover:text-white"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed text-[#d7d7d7]">{children}</div>
      </div>
    </div>
  );
}

interface MyBet { id: string; amount: number; cashout_multiplier: number | null; winnings: number | null; status: string; created_at: string; is_free?: boolean | null; game_rounds: { crash_multiplier: number } | null }

function BetHistory({ userId }: { userId: string }) {
  const [rows, setRows] = useState<MyBet[] | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('bets')
        .select('id, amount, cashout_multiplier, winnings, status, created_at, is_free, game_rounds(crash_multiplier)')
        .eq('user_id', userId).eq('is_bot', false).order('created_at', { ascending: false }).limit(50);
      if (alive) setRows((data ?? []) as unknown as MyBet[]);
    })();
    return () => { alive = false; };
  }, [userId]);
  if (!rows) return <p className="py-6 text-center text-[#7b7b7b]">Loading…</p>;
  if (!rows.length) return <p className="py-6 text-center text-[#7b7b7b]">No bets yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      <li className="grid grid-cols-[1fr_80px_60px_80px] px-2 text-[11px] text-[#7b7b7b]"><span>Date</span><span className="text-right">Bet KES</span><span className="text-right">X</span><span className="text-right">Win KES</span></li>
      {rows.map((b) => {
        const won = b.status === 'won' && b.cashout_multiplier != null;
        return (
          <li key={b.id} className={`grid grid-cols-[1fr_80px_60px_80px] items-center rounded-xl px-2 py-2 ${won ? 'border border-[#427f00] bg-[#123405]' : 'bg-[#101011]'}`}>
            <span className="text-[11px] text-[#9ea0a3]">
              {new Date(b.created_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {b.game_rounds ? <span className={`block ${multColor(b.game_rounds.crash_multiplier)}`}>Round {fmtX(b.game_rounds.crash_multiplier)}</span> : null}
            </span>
            <span className="text-right tabular-nums text-white">{money(b.amount)}{b.is_free ? <span className="block text-[10px] text-[#5cd334]">free bet</span> : null}</span>
            <span className={`text-right tabular-nums ${won ? multColor(b.cashout_multiplier!) : 'text-[#7b7b7b]'}`}>{won ? fmtX(b.cashout_multiplier!) : b.status === 'active' ? '…' : '—'}</span>
            <span className="text-right tabular-nums text-white">{won ? money(b.winnings ?? 0) : b.status === 'lost' ? '0.00' : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function GamePanels({ panel, onClose, userId, freeBets, canUseFreeBet, onUseFreeBet, minBet, stakeStep, minAuto }: {
  panel: GamePanel | null; onClose: () => void; userId: string | null;
  freeBets: FreeBet[]; canUseFreeBet: boolean; onUseFreeBet: (id: string, auto: number) => void;
  minBet: number; stakeStep: number; minAuto: number;
}) {
  if (!panel || panel === 'chat') return null;
  if (panel === 'freebets') return (
    <Shell title="Free Bets" onClose={onClose}>
      {freeBets.length === 0 ? <p className="py-6 text-center text-[#7b7b7b]">You have no free bets right now.</p> : (
        <ul className="flex flex-col gap-2">
          {freeBets.map((fb) => (
            <li key={fb.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#101011] px-3 py-2.5">
              <span>
                <span className="block font-semibold text-white">KES {money(fb.amount)}</span>
                <span className="text-[11px] text-[#7b7b7b]">{fb.expires_at ? `Expires ${new Date(fb.expires_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No expiry'} · cashes out at 2.00x</span>
              </span>
              <button type="button" disabled={!canUseFreeBet} onClick={() => { onUseFreeBet(fb.id, 2); onClose(); }}
                className="rounded-full bg-[#28a909] px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40">Use</button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[#7b7b7b]">A free bet is placed on your first bet panel in the next round.</p>
    </Shell>
  );
  if (panel === 'history') return (
    <Shell title="My Bet History" onClose={onClose}>
      {userId ? <BetHistory userId={userId} /> : <p className="py-6 text-center text-[#7b7b7b]">Sign in to see your bets.</p>}
    </Shell>
  );
  if (panel === 'limits') return (
    <Shell title="Game Limits" onClose={onClose}>
      <dl className="grid grid-cols-[1fr_auto] gap-y-2">
        <dt className="text-[#9ea0a3]">Minimum bet</dt><dd className="text-right font-semibold text-white">KES {money(minBet)}</dd>
        <dt className="text-[#9ea0a3]">Stake step (− / +)</dt><dd className="text-right font-semibold text-white">KES {money(stakeStep)}</dd>
        <dt className="text-[#9ea0a3]">Bets per round</dt><dd className="text-right font-semibold text-white">2 (one per panel)</dd>
        <dt className="text-[#9ea0a3]">Lowest auto cash out</dt><dd className="text-right font-semibold text-white">{minAuto.toFixed(2)}x</dd>
      </dl>
      <p className="mt-3 text-[11px] text-[#7b7b7b]">If a bet goes over the platform's maximum bet or win, it is refused and you are told why.</p>
    </Shell>
  );
  return (
    <Shell title="How To Play" onClose={onClose}>
      <ol className="flex list-decimal flex-col gap-2 pl-4">
        <li><b className="text-white">Bet.</b> Pick a stake with − / + or a quick amount, then tap <b className="text-white">Bet</b> before the round starts. Tapping Bet while a round is flying places it for the next round (tap <b className="text-white">Cancel</b> to undo).</li>
        <li><b className="text-white">Watch the multiplier.</b> When the plane takes off, the multiplier climbs from 1.00x.</li>
        <li><b className="text-white">Cash out</b> any time before the plane flies away. You win your stake × the multiplier at that moment.</li>
        <li>If the plane flies away before you cash out, the bet is lost.</li>
        <li><b className="text-white">Two bets:</b> use ⊕ to add a second panel and play two bets in the same round; ⊖ removes it.</li>
        <li><b className="text-white">Auto:</b> Auto Cash Out closes the bet at the multiplier you set; Auto Play repeats the bet for a number of rounds, with optional stop-loss and stop-win.</li>
      </ol>
      <p className="mt-3 text-[11px] text-[#7b7b7b]">Demo (Fun Mode) uses play money and its own rounds; demo results are not the same as real-money rounds.</p>
    </Shell>
  );
}
