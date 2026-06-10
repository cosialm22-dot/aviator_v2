import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Ban, DollarSign, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getAdminProfile } from '../AdminGuard';

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const [pRes, wRes, bRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('bets').select('*').eq('user_id', userId).eq('is_bot', false).order('created_at', { ascending: false }).limit(50),
      ]);
      setPlayer(pRes.data);
      setWallet(wRes.data);
      setBets(bRes.data ?? []);
      setLoading(false);
    }
    load();
  }, [userId]);

  async function toggleBan() {
    if (!player || !userId) return;
    const newBanned = !player.is_banned;
    const reason = newBanned ? prompt('Ban reason:') : null;
    if (newBanned && !reason) return;

    await supabase.from('profiles').update({
      is_banned: newBanned,
      ban_reason: newBanned ? reason : null,
      banned_at: newBanned ? new Date().toISOString() : null,
    }).eq('id', userId);

    const admin = getAdminProfile();
    if (admin) {
      await supabase.from('admin_audit_log').insert({
        admin_id: admin.id,
        action: newBanned ? 'user_banned' : 'user_unbanned',
        target_type: 'user',
        target_id: userId,
        details: { reason, username: player.username },
      });
    }

    setPlayer({ ...player, is_banned: newBanned, ban_reason: reason });
  }

  async function adjustBalance() {
    if (!userId || !wallet) return;
    const input = prompt('Amount to adjust (positive to credit, negative to debit):');
    if (!input) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount === 0) { alert('Invalid amount'); return; }
    const reason = prompt('Reason for adjustment:');
    if (!reason) return;

    const newBalance = Number(wallet.balance) + amount;
    if (newBalance < 0) { alert('Cannot set negative balance'); return; }

    await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('transactions').insert({
      user_id: userId,
      type: amount > 0 ? 'deposit' : 'withdrawal',
      amount: amount,
      description: `Admin adjustment: ${reason}`,
      status: 'completed',
    });

    const admin = getAdminProfile();
    if (admin) {
      await supabase.from('admin_audit_log').insert({
        admin_id: admin.id,
        action: 'balance_adjusted',
        target_type: 'user',
        target_id: userId,
        details: { amount, reason, new_balance: newBalance },
      });
    }

    setWallet({ ...wallet, balance: newBalance });
  }

  if (loading) {
    return <div className="animate-pulse"><div className="h-40 bg-[#1a1a2e] rounded-xl" /></div>;
  }

  if (!player) {
    return <div className="text-slate-400 text-sm">Player not found.</div>;
  }

  const winCount = bets.filter(b => b.status === 'won').length;
  const lossCount = bets.filter(b => b.status === 'lost').length;
  const winRate = bets.length > 0 ? Math.round((winCount / bets.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={() => navigate('/admin/users')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
        <ArrowLeft size={14} /> Back to Players
      </button>

      {/* Header */}
      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold" style={{ backgroundColor: player.avatar_color }}>
              {player.username[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="text-white text-lg font-bold">{player.username}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-slate-500 text-xs">ID: {player.id.slice(0, 8)}...</span>
                {player.is_banned && <span className="text-red-400 text-[11px] font-medium bg-red-400/10 px-2 py-0.5 rounded-full">Banned</span>}
                <span className="text-slate-500 text-[11px] capitalize bg-slate-500/10 px-2 py-0.5 rounded-full">{player.role}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={adjustBalance} className="flex items-center gap-1.5 px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition-colors">
              <DollarSign size={12} /> Adjust Balance
            </button>
            <button onClick={toggleBan} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              player.is_banned
                ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
                : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
            }`}>
              {player.is_banned ? <><Shield size={12} /> Unban</> : <><Ban size={12} /> Ban</>}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Balance', value: `KSh ${Number(wallet?.balance ?? 0).toLocaleString()}` },
          { label: 'Total Wagered', value: `KSh ${Number(player.total_wagered).toLocaleString()}` },
          { label: 'Win Rate', value: `${winRate}% (${winCount}W / ${lossCount}L)` },
          { label: 'Joined', value: new Date(player.created_at).toLocaleDateString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#1a1a2e] border border-[#2a2a45] rounded-lg p-3">
            <div className="text-slate-400 text-[10px] font-medium uppercase mb-1">{label}</div>
            <div className="text-white text-sm font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {/* Bet History */}
      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a2a45]">
          <h3 className="text-white text-sm font-semibold">Recent Bets ({bets.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2a2a45] text-left">
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Amount</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Cashout</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Winnings</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Status</th>
                <th className="px-4 py-2 text-slate-500 text-[10px] uppercase">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a45]/50">
              {bets.slice(0, 20).map((bet) => (
                <tr key={bet.id}>
                  <td className="px-4 py-2 text-white text-xs">KSh {Number(bet.amount).toLocaleString()}</td>
                  <td className="px-4 py-2 text-slate-300 text-xs">{bet.cashout_multiplier ? `${Number(bet.cashout_multiplier).toFixed(2)}x` : '-'}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className={bet.winnings ? 'text-green-400' : 'text-slate-500'}>
                      {bet.winnings ? `+KSh ${Number(bet.winnings).toLocaleString()}` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      bet.status === 'won' ? 'bg-green-500/10 text-green-400' :
                      bet.status === 'lost' ? 'bg-red-500/10 text-red-400' :
                      'bg-amber-500/10 text-amber-400'
                    }`}>{bet.status}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-[10px]">{new Date(bet.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
