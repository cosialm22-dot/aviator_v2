import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, Receipt, TrendingUp, TrendingDown, Trophy, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Profile, Wallet } from '../../types';

// ProfilePage: identity (name, phone, balance), stats (get_my_stats RPC) and payments (own
// transactions under RLS). Bets are in the game menu's "My bets". Read-only.

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

interface TxRow {
  id: string;
  type: 'deposit' | 'withdrawal' | 'bet' | 'win';
  amount: number;
  payment_method: string | null;
  status: string;
  created_at: string;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'stats', label: 'Stats' },
  { key: 'transactions', label: 'Payments' },
];

/** 254712345678 → +254 712 345 678 */
function phoneLabel(p: string): string {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('254') ? `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : p || '';
}

function ksh(n: number, dp = 2): string {
  return 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<MyStats | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [txns, setTxns] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uid = user?.id;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, txRes] = await Promise.all([
        supabase.rpc('get_my_stats'),
        supabase
          .from('transactions')
          .select('id, type, amount, payment_method, status, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
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
    } catch (e) {
      console.error('[ProfilePage] load failed', e);
      setError("Couldn't load.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  // Not signed in: profile data is auth-scoped, so prompt sign-in rather than
  // showing an empty shell.
  if (!profile || !user) {
    return (
      <div className="h-full overflow-y-auto bg-[#0e0e0e]">
        <TopBar title="Profile" />
        <div className="px-4 py-16 text-center">
          <button onClick={onSignInRequired} className="h-12 rounded-xl bg-win px-8 text-sm font-bold text-white">Log in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0e0e0e] scrollbar-thin">
      <TopBar title="Profile" />

      <div className="mx-auto max-w-2xl px-3 pt-3">
        <div className="flex items-center gap-3 rounded-2xl bg-[#1b1c1d] p-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: profile.avatar_color }}>
            {profile.username[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold text-white">{profile.username}</span>
              {profile.role && profile.role !== 'player' ? <span className="rounded-full bg-[#2c2d30] px-2 py-0.5 text-[11px] font-semibold text-slate-300">{roleLabel(profile.role)}</span> : null}
            </div>
            <div className="mt-0.5 text-[13px] text-[#9ea0a3]">{phoneLabel(user.phone)}</div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold tabular-nums text-[#5cd334]">{ksh(wallet?.balance ?? 0).replace('KSh ', '')}</div>
            <div className="text-[11px] text-[#7b7b7b]">KES</div>
          </div>
        </div>
      </div>

      <div className="sticky top-12 z-10 mx-auto max-w-2xl bg-[#0e0e0e] px-3 pt-3">
        <div className="grid grid-cols-2 rounded-full bg-[#1b1c1d] p-1" role="tablist" aria-label="Profile sections">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} role="tab" aria-selected={tab === key}
              className={`h-10 rounded-full text-sm font-semibold transition ${tab === key ? 'bg-[#2c2d30] text-white' : 'text-[#9ea0a3] hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-3 py-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{error}</span>
            <button onClick={() => void load()} className="h-9 rounded-lg bg-[#2c2d30] px-3 text-xs font-semibold text-white">Retry</button>
          </div>
        )}
        {tab === 'stats' && (
          loading ? <SkeletonGrid /> : statsUnavailable ? <Empty icon={BarChart3} title="Stats unavailable" /> : <StatsTab stats={stats} />
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
    <header className="sticky top-0 z-20 flex h-12 items-center gap-1 border-b border-[#232426] bg-[#0e0e0e]/95 px-1 backdrop-blur">
      <Link to="/" className="grid h-11 w-11 place-items-center rounded-full text-slate-400 transition hover:text-white active:scale-90" aria-label="Back to game">
        <ArrowLeft size={20} />
      </Link>
      <span className="text-white font-semibold text-sm">{title}</span>
    </header>
  );
}

function StatsTab({ stats }: { stats: MyStats | null }) {
  if (!stats || stats.played === 0) {
    return <Empty icon={BarChart3} title="No bets yet" />;
  }
  const net = stats.net_profit;
  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Headline: win rate */}
      <div className="rounded-2xl bg-panel border border-edge p-5 text-center">
        <div className="text-[12px] font-semibold text-slate-400">Win rate</div>
        <div className="mt-1 text-4xl font-extrabold text-white tabular-nums">{stats.win_rate}%</div>
        <div className="mt-1 text-xs text-slate-500">{stats.wins} W · {stats.losses} L · {stats.played} bets</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Bet" value={ksh(stats.total_wagered, 0)} />
        <StatCard label="Won" value={ksh(stats.total_won, 0)} accent="#22c55e" />
        <StatCard
          label="Net"
          value={`${net >= 0 ? '+' : '-'}${ksh(Math.abs(net), 0).replace('KSh ', 'KSh ')}`}
          accent={net >= 0 ? '#22c55e' : '#f6465d'}
          icon={net >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard label="Best win" value={ksh(stats.biggest_win, 0)} icon={Trophy} accent="#e0a80b" />
      </div>

      <div className="rounded-2xl bg-panel border border-edge p-5 flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-400">Best cash-out</div>
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
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400">
        {Icon && <Icon size={13} style={{ color: accent }} />} {label}
      </div>
      <div className="mt-1.5 text-xl font-extrabold tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function TransactionsTab({ txns }: { txns: TxRow[] }) {
  if (txns.length === 0) {
    return <Empty icon={Receipt} title="No payments yet" />;
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
  return <div className={`text-[11px] font-semibold capitalize mt-0.5 ${map[status] ?? 'text-slate-500'}`}>{status}</div>;
}

function Empty({ icon: Icon, title }: { icon: typeof BarChart3; title: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-edge py-14 px-6 text-center animate-fade-in-up">
      <div className="w-12 h-12 rounded-xl bg-panel-raised flex items-center justify-center mx-auto mb-3">
        <Icon size={22} className="text-slate-500" />
      </div>
      <div className="text-white font-semibold text-sm">{title}</div>
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
