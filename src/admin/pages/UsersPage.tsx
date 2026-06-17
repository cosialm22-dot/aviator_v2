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

function errMsg(e: unknown, fallback = 'Action failed'): string { return e instanceof Error ? e.message : fallback; }
function Spin() { return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />; }
function friendly(code: string): string {
  if (code.includes('FORBIDDEN_TARGET')) return 'Only a super admin can act on an admin account.';
  if (code.includes('CANNOT_TARGET_SELF')) return 'You cannot ban your own account.';
  if (code.includes('REASON_REQUIRED')) return 'A reason is required.';
  if (code.includes('FORBIDDEN')) return 'You do not have permission for this action.';
  return code || 'Action failed. Please try again.';
}

export default function UsersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banRow, setBanRow] = useState<PlayerRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const navigate = useNavigate();

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    setErr(null);
    let q = supabase.from('profiles').select('id, username, avatar_color, role, is_banned, total_wagered, created_at').order('created_at', { ascending: false }).limit(100);
    if (term.trim()) q = q.ilike('username', `%${term.trim()}%`);
    const { data } = await q;
    setPlayers((data ?? []) as PlayerRow[]);
    setLoading(false);
  }, []);

  // Live search: debounce keystrokes into a query (runs on mount with '' too).
  // No Enter key or button needed -- results follow as you type.
  useEffect(() => {
    const id = setTimeout(() => void runSearch(search), 300);
    return () => clearTimeout(id);
  }, [search, runSearch]);

  async function setBan(row: PlayerRow, ban: boolean, reason?: string) {
    setBusyId(row.id); setErr(null);
    try {
      const { error } = await supabase.rpc('admin_set_ban', { p_user_id: row.id, p_ban: ban, p_reason: reason ?? null });
      if (error) throw new Error(friendly(error.message));
      setBanRow(null); setBanReason('');
      await runSearch(search);
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusyId(null); }
  }

  const roleBadge = (role: string) =>
    role === 'super_admin' ? 'bg-rose-50 text-down' :
    role === 'admin' ? 'bg-brand/10 text-brand' :
    role === 'marketer' ? 'bg-violet-50 text-violet-700' :
    'bg-slate-100 text-muted';

  return (
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-ink tracking-tight">Players</h1>
            <p className="text-[13px] text-muted mt-1">Search and manage registered accounts</p>
          </div>
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[320px] truncate" title={err}>{err}</span>}
        </div>

        <div className="relative max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
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
                  <th className="text-left font-medium px-5 py-3 hidden sm:table-cell">Joined</th>
                  <th className="text-right font-medium px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-faint">Loading...</td></tr>
                ) : players.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-faint">No players</td></tr>
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
                    <td className="px-5 py-3 text-muted text-xs hidden sm:table-cell">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {p.role === 'player' ? (
                        p.is_banned
                          ? <button onClick={() => setBan(p, false)} disabled={busyId === p.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand/30 text-brand text-[12px] font-semibold hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-40">{busyId === p.id && <Spin />}Unban</button>
                          : <button onClick={() => { setErr(null); setBanReason(''); setBanRow(p); }} disabled={busyId === p.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-down text-[12px] font-semibold hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition-colors disabled:opacity-40">Ban</button>
                      ) : (
                        <button onClick={() => navigate(`/admin/users/${p.id}`)} className="text-[12px] text-muted hover:text-ink transition-colors">Manage</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Ban modal */}
      {banRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busyId ? null : setBanRow(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Ban {banRow.username}</h3>
            <p className="text-muted text-[13px] mt-2 leading-relaxed">The player will be flagged as banned. A reason is required and recorded in the audit log.</p>
            <textarea value={banReason} onChange={e => setBanReason(e.target.value)} autoFocus rows={3} placeholder="Reason for ban (required)" className="mt-4 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-down/30 focus:border-down/40 resize-none transition" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setBanRow(null)} disabled={busyId === banRow.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => setBan(banRow, true, banReason)} disabled={busyId === banRow.id || !banReason.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-down hover:brightness-95">{busyId === banRow.id && <Spin />}Ban</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
