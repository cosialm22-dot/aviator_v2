import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useScope } from '../scopeContext';
import { Card, Empty, ErrorState, PageHeader, Pagination, SearchInput, Select, Skeleton, TableWrap, Td, Th } from '../ui/kit';
import { dateTime, relTime, ROLE_LABEL, staffError } from '../ui/format';

// ============================================================================
// AUDIT LOG — who did what, when, on which brand. Read-only (staff cannot edit or delete
// audit rows); filtered and paged server-side by admin_list_audit.
// ============================================================================

interface Row {
  id: string; created_at: string; action: string; target_type: string | null; target_id: string | null;
  details: Record<string, unknown> | null; site_name: string | null; admin_id: string | null; actor: string | null; actor_role: string | null;
}

const LABEL: Record<string, string> = {
  setting_updated: 'Changed a setting', user_banned: 'Banned a player', user_unbanned: 'Lifted a ban', ban_set: 'Changed a ban',
  balance_adjusted: 'Adjusted a balance', role_changed: 'Changed a role', role_set: 'Changed a role',
  withdrawal_approved: 'Approved a withdrawal', withdrawal_rejected: 'Rejected a withdrawal',
  megapay_manual_credit: 'Confirmed a deposit by hand', payment_settings_updated: 'Changed deposit limits',
  mpesa_config_updated: 'Changed the M-Pesa paybill', platform_config_set: 'Changed a platform switch',
  site_theme_set: 'Changed a brand theme', site_created: 'Created a brand', site_updated: 'Updated a brand',
  queue_add: 'Queued a crash point', queue_add_batch: 'Queued crash points', queue_remove: 'Removed a queued point', queue_clear: 'Cleared the crash queue',
  promotion_created: 'Created a promotion', promotion_updated: 'Updated a promotion', promotion_deleted: 'Deleted a promotion',
  notification_broadcast: 'Sent a broadcast',
};
const label = (a: string) => LABEL[a] ?? a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function summary(r: Row): string {
  const d = r.details ?? {};
  const bits: string[] = [];
  for (const k of ['amount', 'receipt', 'reason', 'note', 'key', 'title', 'crash_multiplier']) if (d[k] != null && d[k] !== '') bits.push(`${k.replace(/_/g, ' ')}: ${String(d[k])}`);
  if (d.old !== undefined && d.new !== undefined) bits.push(`${JSON.stringify(d.old)} → ${JSON.stringify(d.new)}`);
  return bits.join(' · ').slice(0, 160);
}

const PAGE = 50;
const DATE = 'h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [color-scheme:dark]';

export default function AuditPage() {
  const scope = useScope();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_audit', {
      p_site: scope.siteId, p_action: action || null, p_actor: actor.trim() || null,
      p_from: from ? new Date(from + 'T00:00:00').toISOString() : null,
      p_to: to ? new Date(new Date(to + 'T00:00:00').getTime() + 864e5).toISOString() : null,
      p_limit: PAGE, p_offset: page * PAGE,
    });
    if (error) { setErr(staffError(error, 'Could not load the audit log.')); setRows([]); return; }
    setErr(null);
    const d = data as { total: number; rows: Row[]; actions: string[] };
    setRows(d.rows); setTotal(d.total); setActions(d.actions);
  }, [scope.siteId, action, actor, from, to, page]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [action, actor, from, to]);

  return (
    <>
      <PageHeader title="Audit log" subtitle={`${scope.label} · every staff action, newest first. Entries cannot be edited or deleted.`} />
      <Card pad={false}>
        <div className="p-4 flex flex-wrap items-center gap-2 border-b border-line">
          <Select value={action} onChange={setAction} label="Action" className="max-w-[240px]"
            options={[{ value: '', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: label(a) }))]} />
          <SearchInput value={actor} onChange={setActor} placeholder="Staff username" label="Filter by staff member" className="w-52" />
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={DATE} />
          <span className="text-faint text-xs">to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={DATE} />
        </div>
        {err && <div className="p-4"><ErrorState message={err} onRetry={() => void load()} /></div>}
        {rows === null ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-4"><Empty title="No entries" body="Nothing matches these filters." /></div>
        ) : (
          <TableWrap testId="audit-table" minWidth={880}>
            <thead><tr><Th>When</Th>{scope.multiBrand && <Th>Brand</Th>}<Th>Who</Th><Th>What</Th><Th>Details</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 align-top" data-testid="audit-row">
                  <Td className="text-muted text-xs whitespace-nowrap" title={dateTime(r.created_at)}>{relTime(r.created_at)}</Td>
                  {scope.multiBrand && <Td className="text-muted text-xs">{r.site_name ?? 'Platform'}</Td>}
                  <Td className="whitespace-nowrap">
                    <span className="text-ink text-[13px]">{r.actor ? `@${r.actor}` : 'System'}</span>
                    {r.actor_role && <span className="block text-[11px] text-faint">{ROLE_LABEL[r.actor_role] ?? r.actor_role}</span>}
                  </Td>
                  <Td>
                    <span className="text-ink text-[13px]">{label(r.action)}</span>
                    <span className="block font-mono text-[11px] text-faint">{r.action}</span>
                    {r.target_type === 'user' && r.target_id && <Link to={`/admin/users/${r.target_id}`} className="text-[11px] text-brand hover:underline">Open player</Link>}
                  </Td>
                  <Td className="text-[12px] text-muted max-w-[420px]">
                    <span className="block break-words">{summary(r) || '—'}</span>
                    {r.details && Object.keys(r.details).length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-faint hover:text-ink">Full record</summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-canvas p-2 text-[11px] text-muted whitespace-pre-wrap break-all">{JSON.stringify({ target: r.target_type ? `${r.target_type}:${r.target_id}` : null, ...r.details }, null, 2)}</pre>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} onPage={setPage} label="entries" />
      </Card>
    </>
  );
}
