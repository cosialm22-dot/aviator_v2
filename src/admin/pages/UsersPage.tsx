import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ban, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PlayerRow {
  id: string;
  username: string;
  avatar_color: string;
  role: string;
  is_banned: boolean;
  total_wagered: number;
  created_at: string;
  last_active_at: string | null;
}

export default function UsersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    setLoading(true);
    let query = supabase
      .from('profiles')
      .select('id, username, avatar_color, role, is_banned, total_wagered, created_at, last_active_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (search.trim()) {
      query = query.ilike('username', `%${search.trim()}%`);
    }

    const { data } = await query;
    setPlayers((data ?? []) as PlayerRow[]);
    setLoading(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchPlayers();
  }

  function relativeTime(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-bold">Players</h1>
        <span className="text-slate-500 text-xs">{players.length} total</span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username..."
            className="w-full bg-[#1a1a2e] border border-[#2a2a45] rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-[#c8001c]/50"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg text-white text-sm hover:bg-[#2a2a45] transition-colors">
          Search
        </button>
      </form>

      {/* Table */}
      <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2a2a45] text-left">
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Player</th>
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider text-right">Wagered</th>
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Joined</th>
                <th className="px-4 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a45]/50">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Loading...</td></tr>
              ) : players.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No players found</td></tr>
              ) : players.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/admin/users/${p.id}`)}
                  className="hover:bg-[#2a2a45]/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ backgroundColor: p.avatar_color }}>
                        {p.username[0]?.toUpperCase()}
                      </div>
                      <span className="text-white text-sm font-medium truncate max-w-[120px]">{p.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      p.role === 'super_admin' ? 'bg-purple-500/10 text-purple-400' :
                      p.role === 'admin' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-slate-500/10 text-slate-400'
                    }`}>{p.role}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-white text-sm tabular-nums">KSh {Number(p.total_wagered).toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    {p.is_banned ? (
                      <span className="flex items-center gap-1 text-red-400 text-[11px] font-medium"><Ban size={11} /> Banned</span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-400 text-[11px] font-medium"><CheckCircle size={11} /> Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{relativeTime(p.last_active_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
