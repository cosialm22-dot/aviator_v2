import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FreeBet } from '../../hooks/usePromos';
import type { GamePanel } from '../../lib/gamePanels';
import { fmtX, money } from '../../lib/betBoard';
import { usePaymentConfig } from '../../hooks/usePaymentConfig';
import Sheet from '../ui/Sheet';
import { Button, Empty, Group, Row, Spinner } from '../ui/ios';

// The sheets behind the ☰ menu: Free bets, My bets, Rules. iOS inset grouped lists.

interface MyBet { id: string; amount: number; cashout_multiplier: number | null; winnings: number | null; status: string; created_at: string; is_free?: boolean | null; game_rounds: { crash_multiplier: number } | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' });

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
  if (!rows) return <div className="grid place-items-center py-12"><Spinner /></div>;
  if (!rows.length) return <Empty>No bets yet</Empty>;
  // Group by day, newest first.
  const days: [string, MyBet[]][] = [];
  for (const b of rows) {
    const k = dayKey(b.created_at);
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(b); else days.push([k, [b]]);
  }
  return (
    <div className="space-y-6 px-4 pt-1">
      {days.map(([day, list]) => (
        <Group key={day} header={day} on="sheet">
          {list.map((b) => {
            const won = b.status === 'won' && b.cashout_multiplier != null;
            const live = b.status === 'active';
            return (
              <Row key={b.id}
                title={<span className="tabular-nums">{money(b.amount)} KES{b.is_free ? <span className="ml-1.5 text-footnote text-ios-green">Free</span> : null}</span>}
                subtitle={`${new Date(b.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}${b.game_rounds ? ` · flew ${fmtX(b.game_rounds.crash_multiplier)}` : ''}`}
                trailing={
                  <span className="text-right tabular-nums">
                    <span className={`block text-body ${won ? 'text-ios-green' : live ? 'text-ios-label2' : 'text-ios-label2'}`}>
                      {won ? `+${money(b.winnings ?? 0)}` : live ? 'Live' : `−${money(b.amount)}`}
                    </span>
                    {won ? <span className="block text-footnote text-ios-label2">{fmtX(b.cashout_multiplier!)}</span> : null}
                  </span>
                } />
            );
          })}
        </Group>
      ))}
    </div>
  );
}

function Rules({ minAuto }: { minAuto: number }) {
  const cfg = usePaymentConfig();
  const k = (n: number) => n.toLocaleString('en-KE');
  const steps = ['Bet before take-off.', 'Cash out before it flies away.', 'You win your bet × the multiplier.'];
  return (
    <div className="space-y-6 px-4 pt-1">
      <Group header="How to play" on="sheet">
        {steps.map((t, i) => (
          <Row key={t} title={t} icon={<span className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-full bg-ios-fill text-footnote font-semibold text-white">{i + 1}</span>} />
        ))}
      </Group>
      <Group header="Limits" footer="Demo uses play money and its own rounds." on="sheet">
        <Row title="Minimum bet" detail={`${k(cfg.minBet)} KES`} />
        <Row title="Maximum bet" detail={`${k(cfg.maxBet)} KES`} />
        <Row title="Maximum win" detail={`${k(cfg.maxPayout)} KES`} />
        <Row title="Bets per round" detail="2" />
        <Row title="Auto cash out" detail={`from ${minAuto.toFixed(2)}x`} />
      </Group>
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
      {freeBets.length === 0 ? <Empty>None right now</Empty> : (
        <div className="px-4 pt-1">
          <Group footer="A free bet goes on your first bet panel and cashes out at 2.00x." on="sheet">
            {freeBets.map((fb) => (
              <Row key={fb.id} title={<span className="tabular-nums">{money(fb.amount)} KES</span>}
                subtitle={fb.expires_at ? `Ends ${when(fb.expires_at)}` : 'No expiry'}
                trailing={<Button size="sm" variant="tinted" disabled={!canUseFreeBet} onClick={() => { onUseFreeBet(fb.id, 2); onClose(); }}>Use</Button>} />
            ))}
          </Group>
        </div>
      )}
    </Sheet>
  );
  if (panel === 'history') return (
    <Sheet title="My bets" onClose={onClose}>
      {userId ? <BetHistory userId={userId} /> : <Empty>Log in to see your bets</Empty>}
    </Sheet>
  );
  return (
    <Sheet title="Rules" onClose={onClose}>
      <Rules minAuto={minAuto} />
    </Sheet>
  );
}
