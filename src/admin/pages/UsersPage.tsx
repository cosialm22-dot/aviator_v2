import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useScope } from '../scopeContext';
import { Badge, Button, Card, Empty, ErrorState, PageHeader, Pagination, Pills, SearchInput, Select, Skeleton, TableWrap, Td, Th } from '../ui/kit';
import { kes, maskPhone, relTime, ROLE_LABEL, staffError } from '../ui/format';

// ============================================================================
// PLAYERS — every account on the brand (platform owner: all brands or one), searched and
// filtered server-side (admin_list_players), 50 per page, with the full total.
// ============================================================================

interface Row {
  id: string; username: string; phone_number: string | null; role: string; is_banned: boolean;
  created_at: string; last_active_at: string | null; total_deposited: number; total_withdrawn: number;
  total_wagered: number; total_won: number; balance: number; bonus: number; risk_level: string | null; site_name: string | null;
}
type Status = 'all' | 'active' | 'depositors' | 'dormant' | 'banned' | 'high_risk';
type RoleF = 'player' | 'marketer' | 'staff' | 'any';
type Sort = 'newest' | 'oldest' | 'last_active' | 'deposited' | 'balance' | 'wagered' | 'username';

const STATUS: { value: Status; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Active 7d' }, { value: 'depositors', label: 'Depositors' },
  { value: 'dormant', label: 'Dormant 30d+' }, { value: 'high_risk', label: 'High risk' }, { value: 'banned', label: 'Banned' },
];
const PAGE = 50;

function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function csv(rows: Row[]): string {
  const head = ['username', 'id', 'role', 'status', 'balance_kes', 'bonus_kes', 'deposited_kes', 'withdrawn_kes', 'wagered_kes', 'risk', 'joined', 'last_active'];
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(','), ...rows.map((r) => [r.username, r.id, r.role, r.is_banned ? 'banned' : 'active', r.balance, r.bonus, r.total_deposited,
    r.total_withdrawn, r.total_wagered, r.risk_level ?? '', r.created_at, r.last_active_at ?? ''].map(esc).join(','))].join('\n');
}

export default function UsersPage() {
  const scope = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = (params.get('status') as Status) || 'all';
  const role = (params.get('role') as RoleF) || 'player';
  const sort = (params.get('sort') as Sort) || 'newest';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const dq = useDebounced(q);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const setParam = useCallback((k: string, v: string | null, resetPage = true) => {
    setParams((p) => { const n = new URLSearchParams(p); if (v == null || v === '') n.delete(k); else n.set(k, v); if (resetPage && k !== 'page') n.delete('page'); return n; }, { replace: true });
  }, [setParams]);

  useEffect(() => { setParam('q', dq || null); }, [dq, setParam]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_players', {
      p_site: scope.siteId, p_q: dq || null, p_status: status, p_role: role, p_sort: sort, p_limit: PAGE, p_offset: page * PAGE,
    });
    if (id !== reqId.current) return; // a newer search already answered
    setLoading(false);
    if (error) { setErr(staffError(error, 'Could not load players.')); return; }
    setErr(null);
    const d = data as { total: number; rows: Row[] };
    setRows(d.rows); setTotal(d.total);
  }, [scope.siteId, dq, status, role, sort, page]);
  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    if (!rows) return;
    const blob = new Blob([csv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `players-page-${page + 1}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <PageHeader title="Players" subtitle={`${scope.label} · search, filter and open any account`}
        actions={<Button onClick={exportCsv} disabled={!rows?.length}><Download size={14} /> Export this page</Button>} />

      <Card pad={false}>
        <div className="p-4 flex flex-wrap items-center gap-2 border-b border-line">
          <Pills items={STATUS} value={status} onChange={(v) => setParam('status', v === 'all' ? null : v)} label="Player status" />
          <div className="flex flex-wrap items-center gap-2 ml-auto w-full lg:w-auto">
            <SearchInput value={q} onChange={setQ} placeholder="Username, phone or id" label="Search players" className="flex-1 lg:w-64" />
            <Select<RoleF> value={role} onChange={(v) => setParam('role', v === 'player' ? null : v)} label="Account type"
              options={[{ value: 'player', label: 'Players' }, { value: 'marketer', label: 'Marketers' }, { value: 'staff', label: 'Staff' }, { value: 'any', label: 'Everyone' }]} />
            <Select<Sort> value={sort} onChange={(v) => setParam('sort', v === 'newest' ? null : v)} label="Sort"
              options={[{ value: 'newest', label: 'Newest' }, { value: 'last_active', label: 'Last active' }, { value: 'deposited', label: 'Most deposited' },
                { value: 'balance', label: 'Highest balance' }, { value: 'wagered', label: 'Most wagered' }, { value: 'username', label: 'Username A–Z' }, { value: 'oldest', label: 'Oldest' }]} />
          </div>
        </div>

        {err && <div className="p-4"><ErrorState message={err} onRetry={() => void load()} /></div>}

        {rows === null ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-4"><Empty title="No accounts match" body="Try another search or filter." /></div>
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap testId="players-table" minWidth={scope.multiBrand ? 1040 : 940}>
              <thead><tr>
                <Th>Player</Th>{scope.multiBrand && <Th>Brand</Th>}<Th>Phone</Th><Th numeric>Balance</Th><Th numeric>Deposited</Th>
                <Th numeric>Withdrawn</Th><Th numeric>Wagered</Th><Th>Status</Th><Th>Joined</Th><Th>Last active</Th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="player-row" onClick={() => navigate(`/admin/users/${r.id}`)} className="border-b border-line/60 hover:bg-raised/40 cursor-pointer">
                    <Td>
                      <Link to={`/admin/users/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-ink font-medium hover:text-brand">{r.username}</Link>
                      {r.role !== 'player' && <span className="ml-2"><Badge tone="brand">{ROLE_LABEL[r.role] ?? r.role}</Badge></span>}
                    </Td>
                    {scope.multiBrand && <Td className="text-muted text-xs">{r.site_name ?? '—'}</Td>}
                    <Td className="text-muted text-xs font-mono">{maskPhone(r.phone_number)}</Td>
                    <Td numeric className="text-ink">{kes(r.balance)}{r.bonus > 0 && <span className="block text-[11px] text-faint">+{kes(r.bonus)} bonus</span>}</Td>
                    <Td numeric className="text-muted">{kes(r.total_deposited)}</Td>
                    <Td numeric className="text-muted">{kes(r.total_withdrawn)}</Td>
                    <Td numeric className="text-muted">{kes(r.total_wagered)}</Td>
                    <Td>
                      {r.is_banned ? <Badge tone="down">Banned</Badge>
                        : r.risk_level === 'high' || r.risk_level === 'critical' ? <Badge tone="warn">High risk</Badge>
                        : r.last_active_at && Date.now() - Date.parse(r.last_active_at) < 7 * 864e5 ? <Badge tone="up">Active</Badge>
                        : <Badge>Quiet</Badge>}
                    </Td>
                    <Td className="text-muted text-xs whitespace-nowrap" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at)}</Td>
                    <Td className="text-muted text-xs whitespace-nowrap">{relTime(r.last_active_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} onPage={(p) => setParam('page', p ? String(p) : null, false)} label="accounts" />
      </Card>
    </>
  );
}
