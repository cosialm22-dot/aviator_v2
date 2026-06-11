import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Ban, DollarSign, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (userId) load(); }, [userId]);

  async function load() {
    setLoading(true);
    const [p, w, b] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId!).maybeSingle(),
      supabase.from('wallets').select('balance').eq('user_id', userId!).maybeSingle(),
      supabase.from('bets').select('id,amount,cashout_multiplier,winnings,status,created_at').eq('user_id', userId!).eq('is_bot', false).order('created_at', { ascending: false }).limit(30),
    ]);
    setProfile(p.data); setWallet(w.data); setBets(b.data ?? []); setLoading(false);
  }

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
    await supabase.from('wallets').update({ balance: newBal }).eq('user_id', userId!);
    await supabase.from('transactions').insert({ user_id: userId, type: amt > 0 ? 'deposit' : 'withdrawal', amount: amt, description: `Admin: ${reason}`, status: 'completed' });
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await supabase.from('admin_audit_log').insert({ admin_id: session.user.id, action: 'balance_adjusted', target_type: 'user', target_id: userId, details: { amount: amt, reason } });
    load();
  }

  if (loading) return <div className="animate-pulse"><div className="h-40 bg-[#111122] rounded-xl" /></div>;
  if (!profile) return <div className="text-slate-400">Player not found</div>;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/admin/users')} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm"><ArrowLeft size={16} />Back</button>
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold" style={{backgroundColor: profile.avatar_color}}>{profile.username[0]?.toUpperCase()}</div>
          <div><h2 className="text-white text-lg font-bold">{profile.username}</h2><div className="text-xs text-slate-500">Joined {new Date(profile.created_at).toLocaleDateString()}{profile.is_banned && <span className="ml-2 text-red-400 font-semibold">BANNED</span>}</div></div>
        </div>
        <div className="flex gap-2">
          <button onClick={adjustBalance} className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-xs font-medium flex items-center gap-1"><DollarSign size={12}/>Adjust</button>
          <button onClick={toggleBan} className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1 ${profile.is_banned ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>{profile.is_banned ? <><ShieldCheck size={12}/>Unban</> : <><Ban size={12}/>Ban</>}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[{l:'Balance',v:`KSh ${Number(wallet?.balance??0).toLocaleString()}`},{l:'Wagered',v:`KSh ${Number(profile.total_wagered).toLocaleString()}`},{l:'Bets',v:bets.length},{l:'Win Rate',v:`${bets.length?Math.round(bets.filter(b=>b.status==='won').length/bets.length*100):0}%`}].map(s=>(
          <div key={s.l} className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4"><div className="text-xs text-slate-500">{s.l}</div><div className="text-lg font-bold text-white mt-1">{s.v}</div></div>
        ))}
      </div>
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1e1e35]"><h3 className="text-sm font-semibold text-white">Recent Bets</h3></div>
        <table className="w-full text-sm"><thead><tr className="text-slate-500 text-xs border-b border-[#1e1e35]"><th className="px-5 py-2 text-left">Time</th><th className="px-5 py-2 text-right">Amount</th><th className="px-5 py-2 text-right">Cashout</th><th className="px-5 py-2 text-right">Won</th><th className="px-5 py-2">Status</th></tr></thead>
          <tbody>{bets.map(b=>(<tr key={b.id} className="border-b border-[#1e1e35]/50"><td className="px-5 py-2 text-slate-400 text-xs">{new Date(b.created_at).toLocaleString()}</td><td className="px-5 py-2 text-right text-white font-mono">KSh {Number(b.amount).toLocaleString()}</td><td className="px-5 py-2 text-right text-slate-400 font-mono">{b.cashout_multiplier?`${Number(b.cashout_multiplier).toFixed(2)}x`:'-'}</td><td className="px-5 py-2 text-right font-mono">{b.winnings?<span className="text-green-400">+{Number(b.winnings).toLocaleString()}</span>:'-'}</td><td className="px-5 py-2"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${b.status==='won'?'bg-green-500/10 text-green-400':b.status==='lost'?'bg-red-500/10 text-red-400':'bg-amber-500/10 text-amber-400'}`}>{b.status}</span></td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
