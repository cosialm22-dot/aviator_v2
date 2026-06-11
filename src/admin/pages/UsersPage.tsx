import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function UsersPage() {
  const [players, setPlayers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { fetchPlayers(); }, []);

  async function fetchPlayers() {
    setLoading(true);
    let q = supabase.from('profiles').select('id, username, avatar_color, role, is_banned, total_wagered, created_at').order('created_at', { ascending: false }).limit(100);
    if (search.trim()) q = q.ilike('username', `%${search.trim()}%`);
    const { data } = await q;
    setPlayers(data ?? []);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Players</h1>
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchPlayers()} placeholder="Search username..." className="w-full pl-9 pr-4 py-2.5 bg-[#111122] border border-[#1e1e35] rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#c8001c]" />
      </div>
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-slate-500 text-xs border-b border-[#1e1e35]">
            <th className="text-left px-5 py-3">Player</th><th className="text-left px-5 py-3">Role</th><th className="text-right px-5 py-3">Wagered</th><th className="text-left px-5 py-3">Status</th><th className="text-left px-5 py-3">Joined</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-600">Loading...</td></tr> : players.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-600">No players</td></tr> : players.map(p => (
              <tr key={p.id} onClick={() => navigate(`/admin/users/${p.id}`)} className="border-b border-[#1e1e35]/50 hover:bg-[#1a1a2e]/50 cursor-pointer">
                <td className="px-5 py-3"><div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{backgroundColor: p.avatar_color}}>{p.username[0]?.toUpperCase()}</div><span className="text-white font-medium">{p.username}</span></div></td>
                <td className="px-5 py-3"><span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${p.role === 'super_admin' ? 'bg-red-500/10 text-red-400' : p.role === 'admin' ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-500/10 text-slate-500'}`}>{p.role}</span></td>
                <td className="px-5 py-3 text-right text-slate-300 font-mono">KSh {Number(p.total_wagered).toLocaleString()}</td>
                <td className="px-5 py-3">{p.is_banned ? <span className="text-[10px] font-semibold text-red-400">BANNED</span> : <span className="text-[10px] font-semibold text-green-400">ACTIVE</span>}</td>
                <td className="px-5 py-3 text-slate-500 text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
