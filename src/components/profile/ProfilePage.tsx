import { useState, useEffect, useCallback } from 'react';
import NavPage from '../ui/NavPage';
import { ArrowDownLeft, ArrowUpRight, Gift, Wallet as WalletIcon } from 'lucide-react';
import { Button, Empty, Glyph, Group, Row, Segmented, Spinner, kes } from '../ui/ios';
import { supabase } from '../../lib/supabase';
import type { Profile, Wallet } from '../../types';

// ProfilePage (iOS settings style): identity, wallet, stats (get_my_stats RPC) and payments
// (own deposits / withdrawals / bonuses under RLS). Bets are in the game menu's "My bets".

type Tab = 'stats' | 'transactions';

interface MyStats {
  played: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_wagered: number;
  total_won: number;
  net_profit: number;
  biggest_win: number;
  biggest_multiplier: number;
}

/** One of the player's withdrawals (my_withdrawals RPC). */
interface MyWithdrawal {
  id: string; amount: number; phone: string; status: string; receipt: string | null;
  created_at: string; completed_at: string | null; reason: string | null; can_cancel: boolean;
}
/** What a withdrawal's status means to the player. */
export const WITHDRAWAL_STATUS: Record<string, { label: string; tone: 'wait' | 'ok' | 'bad' }> = {
  pending: { label: 'Being checked', tone: 'wait' },
  approved: { label: 'Approved · sending soon', tone: 'wait' },
  processing: { label: 'Sending to M-Pesa', tone: 'wait' },
  needs_attention: { label: 'Delayed · we are on it', tone: 'wait' },
  completed: { label: 'Paid', tone: 'ok' },
  rejected: { label: 'Declined · money returned', tone: 'bad' },
  failed: { label: 'Not paid · money returned', tone: 'bad' },
  cancelled: { label: 'Cancelled · money returned', tone: 'bad' },
};

interface TxRow {
  id: string;
  type: string;
  amount: number;
  payment_method: string | null;
  status: string;
  created_at: string;
}


/** 254712345678 → +254 712 345 678 */
function phoneLabel(p: string): string {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('254') ? `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : p || '';
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Admin';
    case 'marketer': return 'Marketer';
    default: return 'Player';
  }
}

interface AuthUser {
  id: string;
  phone: string;
}

interface Props {
  user: AuthUser | null;
  profile: Profile | null;
  wallet: Wallet | null;
  onSignInRequired: () => void;
  onWalletOpen: () => void;
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
const PAY: Record<string, { label: string; color: string; icon: typeof Gift; out: boolean }> = {
  deposit: { label: 'Deposit', color: '#30d158', icon: ArrowDownLeft, out: false },
  withdrawal: { label: 'Withdrawal', color: '#ff9f0a', icon: ArrowUpRight, out: true },
  bonus: { label: 'Bonus', color: '#5e5ce6', icon: Gift, out: false },
};

export default function ProfilePage({ user, profile, wallet, onSignInRequired, onWalletOpen }: Props) {
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<MyStats | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [txns, setTxns] = useState<TxRow[]>([]);
  const [wds, setWds] = useState<MyWithdrawal[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uid = user?.id;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, txRes, wdRes] = await Promise.all([
        supabase.rpc('get_my_stats'),
        supabase
          .from('transactions')
          .select('id, type, amount, payment_method, status, created_at')
          .eq('user_id', uid)
          .not('type', 'in', '(bet,win)')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.rpc('my_withdrawals', { p_limit: 10 }),
      ]);
      // Core reads (always available under RLS): a failure here is a real page error.
      if (txRes.error) throw txRes.error;
      // Stats is best-effort: a failure (e.g. RPC unavailable) must NOT blank the
      // rest of the profile - it degrades to a dedicated "unavailable" state.
      if (statsRes.error) {
        console.warn('[ProfilePage] get_my_stats unavailable', statsRes.error);
        setStats(null);
        setStatsUnavailable(true);
      } else {
        setStats(statsRes.data as MyStats);
        setStatsUnavailable(false);
      }
      setTxns((txRes.data ?? []) as TxRow[]);
      // best-effort like stats: the list of withdrawals and their progress
      setWds(wdRes.error ? [] : ((wdRes.data ?? []) as MyWithdrawal[]));
    } catch (e) {
      console.error('[ProfilePage] load failed', e);
      setError("Couldn't load.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  const cancel = async (id: string) => {
    setCancelling(id);
    const { error: e } = await supabase.rpc('cancel_my_withdrawal', { p_id: id });
    setCancelling(null);
    if (e) setError(e.message.startsWith('CANNOT_CANCEL') ? 'It is already being sent, so it can no longer be cancelled.' : "Couldn't cancel.");
    await load();
  };

  // Not signed in: profile data is auth-scoped, so prompt sign-in rather than an empty shell.
  if (!profile || !user) {
    return (
      <Page>
        <div className="px-4 pt-16 text-center">
          <p className="text-subhead text-ios-label2">Log in to see your profile.</p>
          <Button className="mx-auto mt-5 max-w-[280px]" onClick={onSignInRequired}>Log in</Button>
        </div>
      </Page>
    );
  }

  const net = stats?.net_profit ?? 0;
  const days: [string, TxRow[]][] = [];
  for (const t of txns) {
    const k = dayKey(t.created_at);
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(t); else days.push([k, [t]]);
  }

  return (
    <Page>
      {/* Identity, like the top of iOS Settings */}
      <div className="flex flex-col items-center px-4 pb-6 pt-2 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full text-title1 text-white" style={{ backgroundColor: profile.avatar_color }}>
          {profile.username[0]?.toUpperCase()}
        </span>
        <h1 className="mt-3 text-title2 text-white">{profile.username}</h1>
        <p className="mt-0.5 text-subhead tabular-nums text-ios-label2">
          {phoneLabel(user.phone)}{profile.role && profile.role !== 'player' ? ` · ${roleLabel(profile.role)}` : ''}
        </p>
      </div>

      <div className="space-y-6 px-4">
        <Group>
          <Row icon={<Glyph color="#30d158"><WalletIcon size={17} strokeWidth={2.2} /></Glyph>} title="Wallet"
            detail={<span data-testid="profile-balance">{kes(wallet?.balance ?? 0)}</span>} chevron onClick={onWalletOpen} />
        </Group>

        <Segmented label="Profile sections" value={tab} onChange={setTab} items={[['stats', 'Stats'], ['transactions', 'Payments']]} />

        {error ? (
          <Group><Row title={error} trailing={<Button size="sm" variant="gray" onClick={() => void load()}>Retry</Button>} /></Group>
        ) : loading ? (
          <div className="grid place-items-center py-12"><Spinner /></div>
        ) : tab === 'stats' ? (
          statsUnavailable ? <Empty>Stats unavailable</Empty>
          : !stats || stats.played === 0 ? <Empty>No bets yet</Empty>
          : (
            <>
              <Group header="Results">
                <Row title="Win rate" detail={`${stats.win_rate}%`} />
                <Row title="Bets" detail={stats.played.toLocaleString('en-KE')} subtitle={`${stats.wins} won · ${stats.losses} lost`} />
                <Row title="Best cash-out" detail={`${Number(stats.biggest_multiplier).toFixed(2)}x`} />
              </Group>
              <Group header="Money" footer="Real-money bets only.">
                <Row title="Total bet" detail={kes(stats.total_wagered)} />
                <Row title="Total won" detail={kes(stats.total_won)} />
                <Row title="Biggest win" detail={kes(stats.biggest_win)} />
                <Row title="Net" detail={<span className={net >= 0 ? 'text-ios-green' : 'text-ios-red'}>{net >= 0 ? '+' : '−'}{kes(Math.abs(net))}</span>} />
              </Group>
            </>
          )
        ) : txns.length === 0 && wds.length === 0 ? <Empty>No payments yet</Empty> : (
          <>
          {wds.length > 0 && (
            <Group header="Withdrawals" footer="Money you ask to withdraw is set aside from your balance straight away. If a withdrawal is declined or cannot be paid, it comes back.">
              {wds.map((w) => {
                const st = WITHDRAWAL_STATUS[w.status] ?? { label: w.status, tone: 'wait' as const };
                return (
                  <Row key={w.id} icon={<Glyph color="#ff9f0a"><ArrowUpRight size={17} strokeWidth={2.2} /></Glyph>}
                    title={kes(w.amount)}
                    subtitle={[new Date(w.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }), st.label, w.receipt, w.reason].filter(Boolean).join(' · ')}
                    trailing={w.can_cancel
                      ? <Button size="sm" variant="gray" disabled={cancelling === w.id} onClick={() => void cancel(w.id)} data-testid={`cancel-withdrawal-${w.id}`}>Cancel</Button>
                      : <span className={st.tone === 'ok' ? 'text-ios-green' : st.tone === 'bad' ? 'text-ios-label2' : 'text-ios-orange'} data-testid={`withdrawal-status-${w.id}`}>{st.tone === 'ok' ? 'Paid' : st.tone === 'bad' ? 'Returned' : 'In progress'}</span>} />
                );
              })}
            </Group>
          )}
          {days.map(([day, list]) => (
            <Group key={day} header={day}>
              {list.map((t) => {
                const P = PAY[t.type] ?? { label: t.type[0]?.toUpperCase() + t.type.slice(1), color: '#8e8e93', icon: ArrowDownLeft, out: t.amount < 0 };
                const Icon = P.icon;
                const out = P.out || t.amount < 0;
                return (
                  <Row key={t.id} icon={<Glyph color={P.color}><Icon size={17} strokeWidth={2.2} /></Glyph>} title={P.label}
                    subtitle={[time(t.created_at), t.payment_method === 'mpesa' ? 'M-Pesa' : t.payment_method, t.status !== 'completed' ? t.status[0].toUpperCase() + t.status.slice(1) : null].filter(Boolean).join(' · ')}
                    detail={<span className={out ? 'text-white' : 'text-ios-green'}>{out ? '−' : '+'}{kes(Math.abs(t.amount))}</span>} />
                );
              })}
            </Group>
          ))}
          </>
        )}
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <NavPage title="Profile">{children}</NavPage>;
}
