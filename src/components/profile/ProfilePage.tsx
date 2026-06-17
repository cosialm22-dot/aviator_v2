import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, User as UserIcon, BarChart3, ListChecks, Receipt,
  TrendingUp, TrendingDown, Trophy, Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Profile, Wallet } from '../../types';

// ============================================================================
// ProfilePage - the player's own account area. Mobile-first, single-column,
// large touch targets. ZERO new backend: every panel reads data that already
// exists under the Phase-1 security model:
//   - Account:       the `profiles` row (+ phone from the auth email, joined date
//                    from the auth user) already in memory.
//   - Stats:         get_my_stats() RPC (SECURITY DEFINER, auth.uid()-scoped).
//   - My Bets:       bets table (RLS: "All authenticated users can read bets";
//                    we filter to the caller and exclude bots).
//   - Transactions:  transactions table (RLS: "Users can read own transactions").
// No writes are performed here.
// ============================================================================

type Tab = 'account' | 'stats' | 'bets' | 'transactions';

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

interface BetRow {
  id: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: string;
  created_at: string;
  round: { round_number: number | null; crash_multiplier: number | null } | null;
}

interface TxRow {
  id: string;
  type: 'deposit' | 'withdrawal' | 'bet' | 'win';
  amount: number;
  payment_method: string | null;
  status: string;
  created_at: string;
}

const TABS: { key: Tab; label: string; icon: typeof UserIcon }[] = [
  { key: 'account', label: 'Account', icon: UserIcon },
  { key: 'stats', label: 'Stats', icon: BarChart3 },
  { key: 'bets', label: 'My Bets', icon: ListChecks },
  { key: 'transactions', label: 'History', icon: Receipt },
];

function ksh(n: number, dp = 2): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function dateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}
function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
}

export default function ProfilePage({ user, profile, wallet, onSignInRequired }: Props) {
  const [tab, setTab] = useState<Tab>('account');
  const [stats, setStats] = useState<MyStats | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [txns, setTxns] = useState<TxRow[]>([]);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uid = user?.id;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, betsRes, txRes, profRes] = await Promise.all([
        supabase.rpc('get_my_stats'),
        supabase
          .from('bets')
          .select('id, amount, cashout_multiplier, winnings, status, created_at, round:game_rounds(round_number, crash_multiplier)')
          .eq('user_id', uid)
          .eq('is_bot', false)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('transactions')
          .select('id, type, amount, payment_method, status, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
        // profiles.created_at backs "member since" (Profile in memory omits it);
        // RLS "Users can read all profiles" permits this read.
        supabase.from('profiles').select('created_at').eq('id', uid).maybeSingle(),
      ]);
      // Core reads (always available under RLS): a failure here is a real page error.
      if (betsRes.error) throw betsRes.error;
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
      setJoinedAt((profRes.data as { created_at?: string } | null)?.created_at ?? null);
      // Supabase returns the joined relation as an array; normalise to a single object.
      setBets(((betsRes.data ?? []) as Record<string, unknown>[]).map((b) => ({
        id: b.id as string,
        amount: Number(b.amount),
        cashout_multiplier: b.cashout_multiplier == null ? null : Number(b.cashout_multiplier),
        winnings: b.winnings == null ? null : Number(b.winnings),
        status: b.status as string,
        created_at: b.created_at as string,
        round: Array.isArray(b.round) ? (b.round[0] ?? null) : (b.round as BetRow['round']),
      })));
      setTxns((txRes.data ?? []) as TxRow[]);
    } catch (e) {
      console.error('[ProfilePage] load failed', e);
      setError('Could not load your profile right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  // Not signed in: profile data is auth-scoped, so prompt sign-in rather than
  // showing an empty shell.
  if (!profile || !user) {
    return (
      <div className="h-full overflow-y-auto bg-night">
        <TopBar title="My Profile" />
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-panel-raised border border-edge flex items-center justify-center mx-auto mb-4">
            <UserIcon size={26} className="text-slate-500" />
          </div>
          <h2 className="text-white font-bold text-lg">Sign in to view your profile</h2>
          <p className="text-slate-400 text-sm mt-2">Your account details, stats, bets and transaction history live here.</p>
          <button
            onClick={onSignInRequired}
            className="mt-6 px-6 py-3 bg-win hover:bg-win-dark text-white rounded-xl text-sm font-bold transition shadow-lg shadow-green-500/20"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-night scrollbar-thin">
      <TopBar title="My Profile" />

      {/* Identity banner */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="flex items-center gap-3.5 rounded-2xl bg-panel border border-edge p-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
            style={{ backgroundColor: profile.avatar_color }}
          >
            {profile.username[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-white font-bold text-lg truncate">{profile.username}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex px-2 py-0.5 rounded-full bg-panel-raised border border-edge text-slate-300 text-[11px] font-semibold">
                {roleLabel(profile.role)}
              </span>
              <span className="text-slate-500 text-xs">Joined {joinedAt ? dateLong(joinedAt) : '-'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs - horizontally scrollable on small screens, large touch targets */}
      <div className="max-w-2xl mx-auto px-4 pt-4 sticky top-12 z-10 bg-night">
        <div className="flex gap-1.5 bg-panel border border-edge rounded-xl p-1 overflow-x-auto scrollbar-thin" role="tablist" aria-label="Profile sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              role="tab"
              aria-selected={tab === key}
              className={`flex-1 min-w-[78px] flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 ${
                tab === key ? 'bg-danger text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => void load()} className="px-3 py-1.5 bg-panel-raised rounded-lg text-xs font-semibold text-white whitespace-nowrap">Retry</button>
          </div>
        )}

        {tab === 'account' && (
          <AccountTab profile={profile} user={user} wallet={wallet} joinedAt={joinedAt} />
        )}
        {tab === 'stats' && (
          loading ? <SkeletonGrid /> : statsUnavailable ? <Empty icon={BarChart3} title="Stats unavailable" sub="We couldn't load your statistics right now. Pull to refresh or try again shortly." /> : <StatsTab stats={stats} />
        )}
        {tab === 'bets' && (
          loading ? <SkeletonList /> : <BetsTab bets={bets} />
        )}
        {tab === 'transactions' && (
          loading ? <SkeletonList /> : <TransactionsTab txns={txns} />
        )}
      </div>
    </div>
  );
}

function TopBar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 bg-night/95 backdrop-blur border-b border-edge h-12 flex items-center px-3 gap-2">
      <Link to="/" className="p-2 -ml-1 text-slate-400 hover:text-white transition rounded-lg active:scale-90" aria-label="Back to game">
        <ArrowLeft size={20} />
      </Link>
      <span className="text-white font-semibold text-sm">{title}</span>
    </header>
  );
}

function AccountTab({ profile, user, wallet, joinedAt }: { profile: Profile; user: AuthUser; wallet: Wallet | null; joinedAt: string | null }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Username', value: profile.username },
    { label: 'Phone', value: user.phone || '-' },
    { label: 'Account type', value: roleLabel(profile.role) },
    { label: 'Member since', value: joinedAt ? dateLong(joinedAt) : '-' },
  ];
  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Wallet balance card */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0f2a1a] to-panel border border-[#1f3d2a] p-5">
        <div className="flex items-center gap-2 text-win">
          <WalletIcon size={16} />
          <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Wallet Balance</span>
        </div>
        <div className="mt-2 text-3xl font-extrabold tabular-nums" style={{ color: '#22c55e' }}>
          {ksh(wallet?.balance ?? 0)}
        </div>
      </div>

      {/* Account details */}
      <div className="rounded-2xl bg-panel border border-edge overflow-hidden divide-y divide-panel-high">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-3.5">
            <span className="text-slate-400 text-sm">{r.label}</span>
            <span className="text-white text-sm font-semibold text-right">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsTab({ stats }: { stats: MyStats | null }) {
  if (!stats || stats.played === 0) {
    return <Empty icon={BarChart3} title="No stats yet" sub="Place your first real bet to start building your record." />;
  }
  const net = stats.net_profit;
  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Headline: win rate */}
      <div className="rounded-2xl bg-panel border border-edge p-5 text-center">
        <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Win Rate</div>
        <div className="mt-1 text-4xl font-extrabold text-white tabular-nums">{stats.win_rate}%</div>
        <div className="mt-1 text-xs text-slate-500">{stats.wins} wins · {stats.losses} losses · {stats.played} rounds</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Wagered" value={ksh(stats.total_wagered, 0)} />
        <StatCard label="Total Won" value={ksh(stats.total_won, 0)} accent="#22c55e" />
        <StatCard
          label="Net Profit"
          value={`${net >= 0 ? '+' : '-'}${ksh(Math.abs(net), 0).replace('KSh ', 'KSh ')}`}
          accent={net >= 0 ? '#22c55e' : '#f6465d'}
          icon={net >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard label="Biggest Win" value={ksh(stats.biggest_win, 0)} icon={Trophy} accent="#e0a80b" />
      </div>

      <div className="rounded-2xl bg-panel border border-edge p-5 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide font-bold text-slate-400">Best Multiplier</div>
          <div className="text-xs text-slate-500 mt-0.5">Your highest cash-out</div>
        </div>
        <div className="text-3xl font-extrabold tabular-nums" style={{ color: '#e0a80b' }}>
          {Number(stats.biggest_multiplier).toFixed(2)}x
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent = '#ffffff', icon: Icon }: { label: string; value: string; accent?: string; icon?: typeof TrendingUp }) {
  return (
    <div className="rounded-2xl bg-panel border border-edge p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-bold text-slate-400">
        {Icon && <Icon size={13} style={{ color: accent }} />} {label}
      </div>
      <div className="mt-1.5 text-xl font-extrabold tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function BetsTab({ bets }: { bets: BetRow[] }) {
  if (bets.length === 0) {
    return <Empty icon={ListChecks} title="No bets yet" sub="Your real-money bets will appear here." />;
  }
  return (
    <div className="space-y-2 animate-fade-in-up">
      {bets.map((b) => {
        const won = b.status === 'won';
        const lost = b.status === 'lost';
        return (
          <div key={b.id} className="rounded-xl bg-panel border border-edge px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white text-sm font-semibold">{ksh(b.amount, 0)}</span>
                {won && b.cashout_multiplier != null && (
                  <span className="text-win text-xs font-bold tabular-nums">@ {Number(b.cashout_multiplier).toFixed(2)}x</span>
                )}
              </div>
              <div className="text-slate-500 text-xs mt-0.5">
                {b.round?.round_number != null ? `Round #${b.round.round_number} · ` : ''}{dateTime(b.created_at)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {won ? (
                <div className="text-win font-bold text-sm tabular-nums">+{ksh(b.winnings ?? 0, 0)}</div>
              ) : lost ? (
                <div className="text-[#f6465d] font-bold text-sm tabular-nums">-{ksh(b.amount, 0)}</div>
              ) : (
                <div className="text-slate-400 font-semibold text-xs capitalize">{b.status}</div>
              )}
              <StatusBadge status={b.status} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TransactionsTab({ txns }: { txns: TxRow[] }) {
  if (txns.length === 0) {
    return <Empty icon={Receipt} title="No transactions yet" sub="Deposits, withdrawals and winnings will appear here." />;
  }
  const credit = (t: TxRow) => t.type === 'deposit' || t.type === 'win';
  return (
    <div className="space-y-2 animate-fade-in-up">
      {txns.map((t) => {
        const isCredit = credit(t);
        return (
          <div key={t.id} className="rounded-xl bg-panel border border-edge px-4 py-3 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: isCredit ? 'rgba(34,197,94,0.12)' : 'rgba(246,70,93,0.12)' }}
            >
              {isCredit ? <ArrowDownLeft size={16} className="text-win" /> : <ArrowUpRight size={16} className="text-[#f6465d]" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-sm font-semibold capitalize">{t.type}</div>
              <div className="text-slate-500 text-xs mt-0.5">
                {t.payment_method ? `${t.payment_method} · ` : ''}{dateTime(t.created_at)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className={`font-bold text-sm tabular-nums ${isCredit ? 'text-win' : 'text-[#f6465d]'}`}>
                {isCredit ? '+' : '-'}{ksh(Math.abs(t.amount), 0)}
              </div>
              <StatusBadge status={t.status} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    won: 'text-win', completed: 'text-win', success: 'text-win',
    lost: 'text-slate-500', failed: 'text-[#f6465d]', rejected: 'text-[#f6465d]',
    pending: 'text-[#e0a80b]', active: 'text-[#60a5fa]',
  };
  return <div className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${map[status] ?? 'text-slate-500'}`}>{status}</div>;
}

function Empty({ icon: Icon, title, sub }: { icon: typeof UserIcon; title: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-edge py-14 px-6 text-center animate-fade-in-up">
      <div className="w-12 h-12 rounded-xl bg-panel-raised flex items-center justify-center mx-auto mb-3">
        <Icon size={22} className="text-slate-500" />
      </div>
      <div className="text-white font-semibold text-sm">{title}</div>
      <div className="text-slate-500 text-xs mt-1">{sub}</div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-3">
      <div className="h-24 rounded-2xl bg-panel border border-edge animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-panel border border-edge animate-pulse" />)}
      </div>
    </div>
  );
}
function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-panel border border-edge animate-pulse" />)}
    </div>
  );
}
