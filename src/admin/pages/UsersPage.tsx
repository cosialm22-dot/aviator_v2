import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PlayerRow {
  id: string;
  username: string;
  avatar_color: string;
  role: string;
  is_banned: boolean;
  total_wagered: number;
  created_at: string;
}

const PAGE_SIZE = 25;

export default function UsersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchPlayers = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('profiles')
      .select('id, username, avatar_color, role, is_banned, total_wagered, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.ilike('username', `%${search.trim()}%`);
    }

    const { data, count } = await query;
    setPlayers((data ?? []) as PlayerRow[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  // Debounced search
  useEffect(() => {
    setPage(0);
  }, [search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Players</h1>
          <p className="text-sm text-slate-500 mt-1">{total} total players</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username..."
          className="w-full pl-9 pr-4 py-2.5 bg-[#111122] border border-[#1e1e35] rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#c8001c] transition"
        />
      </div>

      {/* Table */}
      <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-[#1e1e35]">
                <th className="text-left px-5 py-3 font-medium">Player</th>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-right px-5 py-3 font-medium">Wagered</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-[#1e1e35]/50">
                    <td colSpan={5} className="px-5 py-4"><div className="h-4 bg-[#1a1a2e] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : players.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-600">No players found</td></tr>
              ) : (
                players.map(player => (
                  <tr
                    key={player.id}
                    onClick={() => navigate(`/admin/users/${player.id}`)}
                    className="border-b border-[#1e1e35]/50 hover:bg-[#1a1a2e]/50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: player.avatar_color }}
                        >
                          {player.username[0]?.toUpperCase()}
                        </div>
                        <span className="text-white font-medium">{player.username}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        player.role === 'super_admin' ? 'bg-red-500/10 text-red-400' :
                        player.role === 'admin' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-slate-500/10 text-slate-500'
                      }`}>
                        {player.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300 font-mono">
                      KSh {Number(player.total_wagered).toLocaleString('en-KE')}
                    </td>
                    <td className="px-5 py-3">
                      {player.is_banned ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400">BANNED</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-green-500/10 text-green-400">ACTIVE</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(player.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#1e1e35]">
            <span className="text-xs text-slate-500">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded bg-[#1a1a2e] text-slate-400 hover:text-white disabled:opacity-30 transition"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded bg-[#1a1a2e] text-slate-400 hover:text-white disabled:opacity-30 transition"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
