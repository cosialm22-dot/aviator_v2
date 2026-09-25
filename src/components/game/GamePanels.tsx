import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FreeBet } from '../../hooks/usePromos';
import type { GamePanel } from '../../lib/gamePanels';
import { fmtX, money, multColor } from '../../lib/betBoard';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
import Sheet from '../ui/Sheet';

// The sheets behind the ☰ menu: Free bets, My bets, Rules.

interface MyBet { id: string; amount: number; cashout_multiplier: number | null; winnings: number | null; status: string; created_at: string; is_free?: boolean | null; game_rounds: { crash_multiplier: number } | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

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
  if (!rows) return <p className="py-10 text-center text-sm text-[#7b7b7b]">Loading…</p>;
  if (!rows.length) return <p className="py-10 text-center text-sm text-[#7b7b7b]">No bets yet</p>;
  return (
    <ul className="flex flex-col gap-1 p-2">
      <li className="grid grid-cols-[1fr_68px_52px_72px] px-2 text-[11px] text-[#7b7b7b]"><span>Time</span><span className="text-right">Bet</span><span className="text-right">X</span><span className="text-right">Win</span></li>
      {rows.map((b) => {
        const won = b.status === 'won' && b.cashout_multiplier != null;
        return (
          <li key={b.id} className={`grid min-h-[44px] grid-cols-[1fr_68px_52px_72px] items-center rounded-xl px-2 py-1.5 text-[13px] ${won ? 'border border-[#427f00] bg-[#123405]' : 'bg-[#101011]'}`}>
            <span className="text-[12px] text-[#9ea0a3]">
              {when(b.created_at)}
              {b.game_rounds ? <span className={`block text-[11px] ${multColor(b.game_rounds.crash_multiplier)}`}>{fmtX(b.game_rounds.crash_multiplier)}</span> : null}
            </span>
            <span className="text-right tabular-nums text-white">{money(b.amount)}{b.is_free ? <span className="block text-[11px] text-[#5cd334]">free</span> : null}</span>
            <span className={`text-right tabular-nums ${won ? multColor(b.cashout_multiplier!) : 'text-[#7b7b7b]'}`}>{won ? fmtX(b.cashout_multiplier!) : b.status === 'active' ? '…' : '—'}</span>
            <span className="text-right tabular-nums text-white">{won ? money(b.winnings ?? 0) : b.status === 'lost' ? '0.00' : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Rules({ minAuto }: { minAuto: number }) {
  const cfg = usePaymentConfig();
  const k = (n: number) => n.toLocaleString('en-KE');
  const rows: [string, string][] = [
    ['Min bet', `${k(cfg.minBet)} KES`],
    ['Max bet', `${k(cfg.maxBet)} KES`],
    ['Max win', `${k(cfg.maxPayout)} KES`],
    ['Bets per round', '2'],
    ['Auto cash out', `from ${minAuto.toFixed(2)}x`],
  ];
  return (
    <div className="p-4 text-sm">
      <ol className="flex flex-col gap-2.5">
        {['Bet before take-off.', 'Cash out before it flies away.', 'Win = bet × multiplier.'].map((t, i) => (
          <li key={t} className="flex items-center gap-3 text-white">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2c2d30] text-[13px] font-bold text-[#9ea0a3]">{i + 1}</span>{t}
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-2 rounded-xl bg-[#101011] px-3 py-3">
        {rows.map(([a, b]) => <Fragment key={a}><dt className="text-[#9ea0a3]">{a}</dt><dd className="text-right font-semibold tabular-nums text-white">{b}</dd></Fragment>)}
      </dl>
      <p className="mt-3 text-[12px] text-[#7b7b7b]">Demo uses play money and its own rounds.</p>
    </div>
  );
}

export function GamePanels({ panel, onClose, userId, freeBets, canUseFreeBet, onUseFreeBet, minAuto }: {
  panel: GamePanel | null; onClose: () => void; userId: string | null;
  freeBets: FreeBet[]; canUseFreeBet: boolean; onUseFreeBet: (id: string, auto: number) => void;
  minAuto: number;
}) {
  if (!panel || panel === 'chat') return null;
  if (panel === 'freebets') return (
    <Sheet title="Free bets" onClose={onClose}>
      {freeBets.length === 0 ? <p className="py-10 text-center text-sm text-[#7b7b7b]">None right now</p> : (
        <ul className="flex flex-col gap-2 p-3">
          {freeBets.map((fb) => (
            <li key={fb.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#101011] py-2 pl-3 pr-2">
              <span>
                <span className="block font-semibold text-white">{money(fb.amount)} KES</span>
                <span className="text-[12px] text-[#7b7b7b]">Auto 2.00x{fb.expires_at ? ` · ends ${when(fb.expires_at)}` : ''}</span>
              </span>
              <button type="button" disabled={!canUseFreeBet} onClick={() => { onUseFreeBet(fb.id, 2); onClose(); }}
                className="h-10 rounded-full bg-[#28a909] px-5 text-sm font-bold text-white disabled:opacity-40">Use</button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
  if (panel === 'history') return (
    <Sheet title="My bets" onClose={onClose}>
      {userId ? <BetHistory userId={userId} /> : <p className="py-10 text-center text-sm text-[#7b7b7b]">Log in to see your bets</p>}
    </Sheet>
  );
  return (
    <Sheet title="Rules" onClose={onClose}>
      <Rules minAuto={minAuto} />
    </Sheet>
  );
}
