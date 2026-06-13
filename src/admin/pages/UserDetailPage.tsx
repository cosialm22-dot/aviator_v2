import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface PlayerProfile {
  id: string;
  username: string;
  avatar_color: string;
  role: string;
  is_banned: boolean;
  ban_reason: string | null;
  total_wagered: number;
  created_at: string;
}

interface UserBetRow {
  id: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: string;
  created_at: string;
}

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [bets, setBets] = useState<UserBetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, b] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId!).maybeSingle(),
      supabase.from('wallets').select('balance').eq('user_id', userId!).maybeSingle(),
      supabase.from('bets').select('id,amount,cashout_multiplier,winnings,status,created_at').eq('user_id', userId!).eq('is_bot', false).order('created_at', { ascending: false }).limit(30),
    ]);
    setProfile(p.data as PlayerProfile | null);
    setWallet(w.data as { balance: number } | null);
    setBets((b.data ?? []) as UserBetRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (userId) void load(); }, [userId, load]);

  async function toggleBan() {
    if (!profile) return;
    const reason = profile.is_banned ? 'Unbanned' : prompt('Ban reason:');
    if (!reason && !profile.is_banned) return;
    await supabase.from('profiles').update({ is_banned: !profile.is_banned, ban_reason: profile.is_banned ? null : reason, banned_at: profile.is_banned ? null : new Date().toISOString() }).eq('id', userId!);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await supabase.from('admin_audit_log').insert({ admin_id: session.user.id, action: profile.is_banned ? 'user_unbanned' : 'user_banned', target_type: 'user', target_id: userId, details: { reason, username: profile.username } });
    load();
  }

  async function adjustBalance() {
    if (!wallet) return;
    const input = prompt('Amount (positive=credit, negative=debit):');
    if (!input) return;
    const amt = parseFloat(input);
    if (isNaN(amt) || amt === 0) return;
    const reason = prompt('Reason:');
    if (!reason) return;
    const newBal = Number(wallet.balance) + amt;
    if (newBal < 0) { alert('Cannot go below zero'); return; }
    const { error } = await supabase.rpc('admin_adjust_balance', { p_user_id: userId, p_delta: amt, p_reason: reason });
    if (error) { alert(error.message); return; }
    load();
  }

  const SHELL = '-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]';

  if (loading) return <div className={SHELL}><div className="h-40 rounded-xl border border-line bg-surface animate-pulse" /></div>;
  if (!profile) return <div className={SHELL}><div className="text-muted text-sm">Player not found</div></div>;

  const STATS = [
    { l: 'Balance', v: `KSh ${Number(wallet?.balance ?? 0).toLocaleString()}` },
    { l: 'Wagered', v: `KSh ${Number(profile.total_wagered).toLocaleString()}` },
    { l: 'Bets', v: bets.length },
    { l: 'Win Rate', v: `${bets.length ? Math.round(bets.filter(b => b.status === 'won').length / bets.length * 100) : 0}%` },
  ];

  return (
    <div className={SHELL}>
      <div className="space-y-6">
        <button onClick={() => navigate('/admin/users')} className="text-[13px] text-muted hover:text-ink transition-colors">&larr; Back</button>

        <div className="rounded-xl border border-line bg-surface p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold" style={{ backgroundColor: profile.avatar_color }}>{profile.username[0]?.toUpperCase()}</div>
            <div>
              <h2 className="text-ink text-lg font-semibold">{profile.username}</h2>
              <div className="text-xs text-muted mt-0.5">
                Joined {new Date(profile.created_at).toLocaleDateString()}
                {profile.is_banned && <span className="ml-2 inline-flex items-center gap-1.5 text-down font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-down" />Banned</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={adjustBalance} className="px-3 py-2 rounded-lg border border-line bg-surface text-ink text-xs font-medium hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors">Adjust Balance</button>
            <button onClick={toggleBan} className={'px-3 py-2 rounded-lg text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 ' + (profile.is_banned ? 'border-brand/30 text-brand hover:bg-brand/5 focus-visible:ring-brand/40' : 'border-rose-200 text-down hover:bg-rose-50 focus-visible:ring-rose-300')}>{profile.is_banned ? 'Unban' : 'Ban'}</button>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line">
            {STATS.map(s => (
              <div key={s.l} className="p-5">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{s.l}</div>
                <div className="mt-2 text-xl font-semibold text-ink tabular-nums">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em]">Recent Bets</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 text-left font-medium">Time</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cashout</th>
                  <th className="px-5 py-2.5 text-right font-medium">Won</th>
                  <th className="px-5 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bets.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-faint">No bets</td></tr>
                ) : bets.map(b => (
                  <tr key={b.id}>
                    <td className="px-5 py-2.5 text-muted text-xs">{new Date(b.created_at).toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right text-ink tabular-nums">KSh {Number(b.amount).toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right text-muted tabular-nums">{b.cashout_multiplier ? `${Number(b.cashout_multiplier).toFixed(2)}x` : '—'}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{b.winnings ? <span className="text-up">+{Number(b.winnings).toLocaleString()}</span> : '—'}</td>
                    <td className="px-5 py-2.5"><span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ' + (b.status === 'won' ? 'bg-emerald-50 text-up' : b.status === 'lost' ? 'bg-rose-50 text-down' : 'bg-amber-50 text-amber-600')}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
