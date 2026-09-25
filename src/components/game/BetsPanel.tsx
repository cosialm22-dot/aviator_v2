import { memo, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { GameStatus, GameRound } from '../../types';
import { multColor, fmtX, maskName, realOnly, money } from '../../lib/betBoard';

// ============================================================================
// BetsPanel — All Bets / Previous / Top, laid out like the owner's mock.
//
// HONESTY RULE: only real players' bets are listed. Rows flagged `is_bot` (the
// server-seeded bot bets and the demo engine's simulated players) are never shown
// and never counted in the header totals. Other players' names are masked
// ("d***8") as in the mock.
// ============================================================================

export interface BoardBet {
  id: string;
  username: string;
  avatar_color: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: 'active' | 'won' | 'lost';
  is_bot: boolean;
}

type Tab = 'all' | 'previous' | 'top';

function Avatar({ name, color, size = 24 }: { name: string; color: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.42 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function BetRows({ bets, status, empty, me }: { bets: BoardBet[]; status: GameStatus; empty: string; me?: string | null }) {
  const rows = useMemo(() => {
    const order = { won: 0, active: 1, lost: 2 } as const;
    return [...bets].sort((a, b) => order[a.status] - order[b.status] || (b.winnings ?? 0) - (a.winnings ?? 0) || b.amount - a.amount);
  }, [bets]);
  return (
    <>
      <div className="grid grid-cols-[1fr_72px_52px_76px] px-3 pb-1 pt-2 text-[11px] text-[#7b7b7b]">
        <span>Player</span><span className="text-right">Bet</span><span className="text-right">X</span><span className="text-right">Win</span>
      </div>
      {rows.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[#7b7b7b]">{empty}</p> : null}
      <ul className="flex flex-col gap-[3px] px-1.5 pb-2">
        {rows.map((b) => {
          const won = b.status === 'won' && b.cashout_multiplier != null;
          return (
            <li key={b.id}
              className={`grid h-9 grid-cols-[1fr_72px_52px_76px] items-center rounded-full px-1.5 text-[13px] ${won ? 'border border-[#427f00] bg-[#123405]' : 'bg-[#101011]'}`}>
              <span className="flex min-w-0 items-center gap-2 pl-0.5">
                <Avatar name={b.username} color={b.avatar_color} />
                <span className={`truncate ${me && b.username === me ? 'font-semibold text-white' : 'text-[#d7d7d7]'}`}>{me && b.username === me ? 'You' : maskName(b.username)}</span>
              </span>
              <span className="text-right tabular-nums text-white">{money(b.amount)}</span>
              <span className={`text-right tabular-nums ${won ? multColor(b.cashout_multiplier!) : 'text-[#7b7b7b]'}`}>
                {won ? fmtX(b.cashout_multiplier!) : b.status === 'active' && status === 'flying' ? '…' : ''}
              </span>
              <span className="pr-2 text-right tabular-nums text-white">{won ? money(b.winnings ?? 0) : b.status === 'lost' ? '0.00' : ''}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AllBets({ bets, status, me }: { bets: BoardBet[]; status: GameStatus; me?: string | null }) {
  const won = bets.filter((b) => b.status === 'won');
  const totalWin = won.reduce((s, b) => s + (b.winnings ?? 0), 0);
  const pct = bets.length ? Math.round((won.length / bets.length) * 100) : 0;
  return (
    <>
      <div className="mx-1.5 mt-1.5 rounded-xl bg-[#101011] px-3 pb-2.5 pt-2">
        <div className="flex items-end justify-between">
          <div>
            <div className="flex -space-x-1.5">
              {bets.slice(0, 3).map((b) => <span key={b.id} className="rounded-full ring-2 ring-[#101011]"><Avatar name={b.username} color={b.avatar_color} size={22} /></span>)}
            </div>
            <div className="mt-1 text-[12px] text-[#9ea0a3]"><span className="font-semibold text-white">{won.length}/{bets.length}</span> Bets</div>
          </div>
          <div className="text-right">
            <div className="text-[17px] font-bold tabular-nums text-white">{money(totalWin)}</div>
            <div className="text-[11px] text-[#9ea0a3]">Total win</div>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#2c2d30]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of bets cashed out">
          <div className="h-full rounded-full bg-[#5cd334] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <BetRows bets={bets} status={status} me={me} empty="No bets yet" />
    </>
  );
}

function Previous({ round, me }: { round: GameRound | null; me?: string | null }) {
  const [bets, setBets] = useState<BoardBet[]>([]);
  const [loading, setLoading] = useState(true);
  const roundId = round?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!roundId) { setBets([]); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const { data } = await supabase.from('bets')
        .select('id, username, avatar_color, amount, cashout_multiplier, winnings, status, is_bot')
        .eq('round_id', roundId).eq('is_bot', false)
        .order('winnings', { ascending: false, nullsFirst: false });
      if (!cancelled) { setBets(realOnly((data ?? []) as BoardBet[]).map((b) => ({ ...b, amount: Number(b.amount) }))); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [roundId]);
  return (
    <>
      <div className="mx-1.5 mt-1.5 rounded-xl bg-[#101011] py-2.5 text-center">
        <div className="text-[12px] text-[#d7d7d7]">Round Result</div>
        <div className={`text-2xl font-bold tabular-nums ${round ? multColor(round.crash_multiplier) : 'text-[#7b7b7b]'}`}>{round ? fmtX(round.crash_multiplier) : '—'}</div>
      </div>
      {loading ? <p className="px-3 py-8 text-center text-xs text-[#7b7b7b]">Loading…</p> : <BetRows bets={bets} status="crashed" me={me} empty="No bets" />}
    </>
  );
}

type TopMetric = 'x' | 'win' | 'rounds';
type TopPeriod = 'day' | 'month' | 'year';
interface TopBet { id: string; username: string; avatar_color: string; amount: number; winnings: number | null; cashout_multiplier: number | null; created_at: string; game_rounds: { crash_multiplier: number } | null }
interface TopRound { id: string; round_number: number | null; crash_multiplier: number; created_at: string }

const since = (p: TopPeriod) => new Date(Date.now() - (p === 'day' ? 1 : p === 'month' ? 30 : 365) * 86400_000).toISOString();
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.');

function Top() {
  const [metric, setMetric] = useState<TopMetric>('x');
  const [period, setPeriod] = useState<TopPeriod>('day');
  const [bets, setBets] = useState<TopBet[]>([]);
  const [rounds, setRounds] = useState<TopRound[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      if (metric === 'rounds') {
        const { data } = await supabase.from('game_rounds').select('id, round_number, crash_multiplier, created_at')
          .eq('status', 'crashed').gte('created_at', since(period)).order('crash_multiplier', { ascending: false }).limit(20);
        if (!cancelled) { setRounds((data ?? []) as TopRound[]); setLoading(false); }
        return;
      }
      const { data } = await supabase.from('bets')
        .select('id, username, avatar_color, amount, winnings, cashout_multiplier, created_at, game_rounds(crash_multiplier)')
        .eq('is_bot', false).eq('status', 'won').gte('created_at', since(period))
        .order(metric === 'x' ? 'cashout_multiplier' : 'winnings', { ascending: false }).limit(20);
      if (!cancelled) { setBets((data ?? []) as unknown as TopBet[]); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [metric, period]);

  const seg = <T extends string>(items: [T, string][], value: T, set: (v: T) => void, label: string) => (
    <div className="grid grid-cols-3 gap-1" role="tablist" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => set(k)}
          className={`h-8 rounded-full text-[13px] transition ${value === k ? 'bg-[#2c2d30] text-white' : 'text-[#9ea0a3] hover:text-white'}`}>{l}</button>
      ))}
    </div>
  );

  return (
    <>
      <div className="mx-1.5 mt-1.5 flex flex-col gap-1 rounded-xl bg-[#101011] p-1">
        {seg<TopMetric>([['x', 'X'], ['win', 'Win'], ['rounds', 'Rounds']], metric, setMetric, 'Rank by')}
        {seg<TopPeriod>([['day', 'Day'], ['month', 'Month'], ['year', 'Year']], period, setPeriod, 'Period')}
      </div>
      {loading ? <p className="px-3 py-8 text-center text-xs text-[#7b7b7b]">Loading…</p>
        : metric === 'rounds' ? (
          rounds.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[#7b7b7b]">No rounds in this period</p> : (
            <ul className="flex flex-col gap-1.5 p-1.5">
              {rounds.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-xl bg-[#101011] px-3 py-2.5">
                  <span><span className="block text-[13px] text-white">Round {r.round_number ?? '—'}</span><span className="text-[11px] text-[#7b7b7b]">{dateOf(r.created_at)}</span></span>
                  <span className={`text-[17px] font-bold tabular-nums ${multColor(r.crash_multiplier)}`}>{fmtX(r.crash_multiplier)}</span>
                </li>
              ))}
            </ul>
          ))
        : bets.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[#7b7b7b]">No wins in this period</p> : (
          <ul className="flex flex-col gap-1.5 p-1.5">
            {bets.map((b) => (
              <li key={b.id} className="rounded-xl bg-[#101011] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Avatar name={b.username} color={b.avatar_color} size={30} />
                  <span><span className="block text-[13px] text-[#d7d7d7]">{maskName(b.username)}</span><span className="text-[11px] text-[#7b7b7b]">{dateOf(b.created_at)}</span></span>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
                  <dt className="text-[#9ea0a3]">Bet KES</dt><dd className="text-right tabular-nums text-white">{money(b.amount)}</dd>
                  <dt className="pl-2 text-[#9ea0a3]">Result</dt><dd className={`text-right tabular-nums ${b.cashout_multiplier != null ? multColor(b.cashout_multiplier) : ''}`}>{b.cashout_multiplier != null ? fmtX(b.cashout_multiplier) : '—'}</dd>
                  <dt className="text-[#9ea0a3]">Win KES</dt><dd className="text-right tabular-nums text-white">{money(b.winnings ?? 0)}</dd>
                  <dt className="pl-2 text-[#9ea0a3]">Round max.</dt><dd className={`text-right tabular-nums ${b.game_rounds ? multColor(b.game_rounds.crash_multiplier) : ''}`}>{b.game_rounds ? fmtX(b.game_rounds.crash_multiplier) : '—'}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

// memo: the board re-renders only when its own data changes (bets, phase, previous round), never on
// the flight clock. On phones it is part of the page scroll (no nested scroller to trap touches).
export default memo(function BetsPanel({ bets, status, previousRound, me = null, className = '' }: {
  bets: BoardBet[]; status: GameStatus; previousRound: GameRound | null; me?: string | null; className?: string;
}) {
  const [tab, setTab] = useState<Tab>('all');
  const real = useMemo(() => realOnly(bets), [bets]);
  return (
    <section aria-label="Bets" className={`flex min-h-0 flex-col rounded-2xl bg-[#1b1c1d] ${className}`}>
      <div className="m-1.5 grid grid-cols-3 rounded-full bg-[#141516] p-0.5" role="tablist" aria-label="Bets view">
        {([['all', 'All Bets'], ['previous', 'Previous'], ['top', 'Top']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-8 rounded-full text-[13px] transition ${tab === k ? 'bg-[#2c2d30] text-white' : 'text-[#9ea0a3] hover:text-white'}`}>{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 lg:overflow-y-auto lg:overscroll-contain">
        {tab === 'all' ? <AllBets bets={real} status={status} me={me} /> : tab === 'previous' ? <Previous round={previousRound} me={me} /> : <Top />}
      </div>
      <div className="flex items-center justify-end border-t border-[#2a2b2e] px-3 py-1.5 text-[11px] text-[#7b7b7b]">
        Powered by <span className="ml-1 font-bold tracking-wide text-[#9ea0a3]">TRIOCODES</span>
      </div>
    </section>
  );
});
