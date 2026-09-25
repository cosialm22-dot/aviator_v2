import { useState, useEffect, useCallback } from 'react';
import { UserCog, Lock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import PlayerCombobox, { type PlayerLite } from '../../components/PlayerCombobox';
import { Badge, Button, Card, Empty, Modal, Notice, Select, TableWrap, Td, Th } from '../../ui/kit';
import { errMsg, friendly, ROLE_META } from './shared';

// Staff & Roles - manage who holds privileged roles. Reads staff directly from
// `profiles` (RLS allows authenticated read) and writes every role change via
// admin_set_role, which is super_admin-only and server-enforces the guards
// (valid role, cannot target self, cannot demote the last super admin). Settings
// is already a super_admin-only section, but the RPC remains the real gate.

interface StaffRow {
  id: string;
  username: string;
  avatar_color: string;
  role: 'admin' | 'super_admin' | 'marketer';
  created_at: string;
}

// Super admin is intentionally absent: it is a single, immutable account that
// can never be assigned (enforced server-side; see the super_admin lockdown).
const ASSIGNABLE: { value: string; label: string }[] = [
  { value: 'player', label: 'Player (remove staff access)' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'admin', label: 'Admin' },
];

const RANK: Record<string, number> = { super_admin: 0, admin: 1, marketer: 2 };

export default function StaffTab() {
  const { userId } = useAdmin();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // role change confirm
  const [pending, setPending] = useState<{ id: string; username: string; from: string; to: string } | null>(null);
  const [applying, setApplying] = useState(false);

  // add staff
  const [picked, setPicked] = useState<PlayerLite | null>(null);
  const [addRole, setAddRole] = useState<'marketer' | 'admin'>('admin');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_color, role, created_at')
      .in('role', ['admin', 'super_admin', 'marketer']);
    if (error) { setErr(friendly(error.message)); setRows([]); }
    else {
      const list = ((data ?? []) as StaffRow[]).sort((a, b) =>
        (RANK[a.role] - RANK[b.role]) || a.username.localeCompare(b.username));
      setRows(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function applyRole() {
    if (!pending || applying) return;
    setApplying(true); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_set_role', { p_user_id: pending.id, p_role: pending.to });
      if (error) throw new Error(friendly(error.message));
      setNotice(`${pending.username} is now ${ROLE_META[pending.to]?.label ?? pending.to}.`);
      setPending(null);
      await load();
    } catch (e) { setErr(errMsg(e, 'Could not change that role.')); } finally { setApplying(false); }
  }

  async function addStaff() {
    if (!picked || adding) return;
    setAdding(true); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_set_role', { p_user_id: picked.id, p_role: addRole });
      if (error) throw new Error(friendly(error.message));
      setNotice(`${picked.username} is now ${ROLE_META[addRole]?.label ?? addRole}.`);
      setPicked(null);
      await load();
    } catch (e) { setErr(errMsg(e, 'Could not assign that role.')); } finally { setAdding(false); }
  }

  // Stable closer so the kit Modal does not re-run its focus effect on every render.
  const closePending = useCallback(() => { if (!applying) setPending(null); }, [applying]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={load} loading={loading}>{loading ? 'Refreshing' : 'Refresh'}</Button>
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      {/* Add staff */}
      <Card title="Grant a staff role">
        <p className="text-[13px] text-muted">Find a player and assign them a staff role. Marketers also gain a referral code automatically on first sign-in.</p>
        <div className="mt-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 min-w-0">
            {!picked
              ? <PlayerCombobox onSelect={p => { setErr(null); setPicked(p); }} />
              : (
                <div className="flex h-9 items-center gap-3 rounded-lg bg-raised pl-3 pr-1">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: picked.avatar_color }}>{picked.username[0]?.toUpperCase()}</span>
                  <span className="flex-1 truncate text-[13px] font-medium text-ink">{picked.username}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)} disabled={adding}>Change</Button>
                </div>
              )}
          </div>
          <Select<'marketer' | 'admin'> value={addRole} onChange={setAddRole} label="Staff role" className="h-9"
            options={[{ value: 'marketer', label: 'Marketer' }, { value: 'admin', label: 'Admin' }]} />
          <Button variant="primary" onClick={addStaff} disabled={!picked} loading={adding} className="flex-shrink-0">
            {!adding && <UserCog size={14} />}Assign role
          </Button>
        </div>
      </Card>

      {/* Staff table */}
      <Card pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="pl-5">Staff member</Th>
              <Th>Current role</Th>
              <Th className="hidden sm:table-cell">Joined</Th>
              <Th numeric className="pr-5">Change role</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-12 text-center text-[13px] text-faint">Loading staff&hellip;</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4}><Empty title="No staff yet. Grant a role above." /></td></tr>
            ) : rows.map(r => {
              const self = r.id === userId;
              return (
                <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                  <Td className="pl-5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: r.avatar_color }}>{r.username[0]?.toUpperCase()}</span>
                      <span className="font-medium text-ink">{r.username}{self && <span className="ml-2 text-[12px] font-normal text-faint">(you)</span>}</span>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_META[r.role]?.badge ?? 'muted'}>{ROLE_META[r.role]?.label ?? r.role}</Badge>
                  </Td>
                  <Td className="hidden sm:table-cell whitespace-nowrap text-[12px] text-muted tabular-nums">{new Date(r.created_at).toLocaleDateString()}</Td>
                  <Td className="pr-5 text-right">
                    {r.role === 'super_admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted" title="The super admin is permanent and cannot be changed"><Lock size={12} />Protected</span>
                    ) : (
                      <select
                        value={r.role}
                        disabled={self}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={e => { const to = e.target.value; if (to !== r.role) setPending({ id: r.id, username: r.username, from: r.role, to }); }}
                        className="h-8 rounded-lg bg-raised pl-3 pr-8 text-[13px] text-ink focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {ASSIGNABLE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Confirm role change */}
      {pending && (
        <Modal title="Change role" onClose={closePending} width={400}
          footer={<>
            <Button onClick={() => setPending(null)} disabled={applying}>Cancel</Button>
            <Button variant="primary" onClick={applyRole} loading={applying}>Confirm</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted">
            Change <span className="font-medium text-ink">{pending.username}</span> from{' '}
            <span className="font-medium text-ink">{ROLE_META[pending.from]?.label ?? pending.from}</span> to{' '}
            <span className="font-medium text-ink">{ROLE_META[pending.to]?.label ?? pending.to}</span>? This is recorded in the audit log.
          </p>
        </Modal>
      )}
    </div>
  );
}
