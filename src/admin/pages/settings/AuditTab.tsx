import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { errMsg } from './shared';

interface AuditEntry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: unknown;
  created_at: string;
  profiles?: { username: string } | null;
}

const LIMIT = 200;

// Read-only audit trail. The admin_audit_log is append-only (written by the
// SECURITY DEFINER RPCs and the settings/staff actions); this tab surfaces the
// most recent entries with a client-side filter and per-row detail expansion.
export default function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select('id, action, target_type, target_id, details, created_at, profiles:admin_id(username)')
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (error) setErr(errMsg(new Error(error.message), 'Could not load the audit log.'));
    else setEntries((data ?? []) as unknown as AuditEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.action.toLowerCase().includes(q) ||
      (e.target_type ?? '').toLowerCase().includes(q) ||
      (e.profiles?.username ?? '').toLowerCase().includes(q) ||
      JSON.stringify(e.details ?? '').toLowerCase().includes(q));
  }, [entries, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-xs w-full">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by action, user, target..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
        </div>
        <div className="flex items-center gap-3">
          {err && <span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px]">{err}</span>}
          <span className="text-[12px] text-faint tabular-nums">{filtered.length} of {entries.length}</span>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors disabled:opacity-50">
            {loading && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}{loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint text-left">
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium hidden sm:table-cell">Target</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">Details</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-faint">Loading audit log&hellip;</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-faint">{entries.length === 0 ? 'No audit entries yet.' : 'No entries match your filter.'}</td></tr>
              ) : filtered.map(e => {
                const detailStr = e.details != null ? JSON.stringify(e.details) : '';
                const isOpen = open === e.id;
                return (
                  <tr key={e.id} className="align-top hover:bg-canvas/60 transition-colors">
                    <td className="px-5 py-3 text-ink font-medium whitespace-nowrap">{e.profiles?.username ?? 'System'}</td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-white/[0.06] rounded text-[11px] font-mono text-muted">{e.action}</span></td>
                    <td className="px-5 py-3 text-muted text-xs hidden sm:table-cell whitespace-nowrap">{e.target_type ? `${e.target_type}: ${e.target_id?.slice(0, 8) ?? '-'}` : '-'}</td>
                    <td className="px-5 py-3 text-muted text-xs hidden md:table-cell max-w-[280px]">
                      {detailStr
                        ? (
                          <button onClick={() => setOpen(isOpen ? null : e.id)} className="text-left font-mono hover:text-ink transition-colors">
                            {isOpen
                              ? <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.details, null, 2)}</pre>
                              : <span className="line-clamp-1 break-all">{detailStr.slice(0, 80)}</span>}
                          </button>
                        ) : '-'}
                    </td>
                    <td className="px-5 py-3 text-muted text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
