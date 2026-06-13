import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
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

export default function UsersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    let q = supabase.from('profiles').select('id, username, avatar_color, role, is_banned, total_wagered, created_at').order('created_at', { ascending: false }).limit(100);
    if (term.trim()) q = q.ilike('username', `%${term.trim()}%`);
    const { data } = await q;
    setPlayers((data ?? []) as PlayerRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void runSearch(''); }, [runSearch]);

  const roleBadge = (role: string) =>
    role === 'super_admin' ? 'bg-rose-50 text-down' :
    role === 'admin' ? 'bg-brand/10 text-brand' :
    'bg-slate-100 text-muted';

  return (
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Players</h1>
          <p className="text-[13px] text-muted mt-1">Search and manage registered accounts</p>
        </div>

        <div className="relative max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch(search)}
            placeholder="Search username..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition-colors"
          />
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="text-left font-medium px-5 py-3">Player</th>
                  <th className="text-left font-medium px-5 py-3">Role</th>
                  <th className="text-right font-medium px-5 py-3">Wagered</th>
                  <th className="text-left font-medium px-5 py-3">Status</th>
                  <th className="text-left font-medium px-5 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-faint">Loading...</td></tr>
                ) : players.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-faint">No players</td></tr>
                ) : players.map(p => (
                  <tr key={p.id} onClick={() => navigate(`/admin/users/${p.id}`)} className="hover:bg-canvas cursor-pointer transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ backgroundColor: p.avatar_color }}>{p.username[0]?.toUpperCase()}</div>
                        <span className="text-ink font-medium">{p.username}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3"><span className={'text-[10px] px-2 py-0.5 rounded font-semibold ' + roleBadge(p.role)}>{p.role}</span></td>
                    <td className="px-5 py-3 text-right text-ink tabular-nums">KSh {Number(p.total_wagered).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      {p.is_banned
                        ? <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-down"><span className="h-1.5 w-1.5 rounded-full bg-down" />Banned</span>
                        : <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-up"><span className="h-1.5 w-1.5 rounded-full bg-up" />Active</span>}
                    </td>
                    <td className="px-5 py-3 text-muted text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
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
