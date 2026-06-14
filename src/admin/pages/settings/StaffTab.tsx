import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserCog, Lock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import PlayerCombobox, { type PlayerLite } from '../../components/PlayerCombobox';
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-3 -mt-2 min-h-[2.25rem]">
        {notice && <span role="status" className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-up text-[12px] max-w-[420px] truncate" title={notice}>{notice}</span>}
        {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[420px] truncate" title={err}>{err}</span>}
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors disabled:opacity-50">
          {loading && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}{loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {/* Add staff */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-muted uppercase tracking-[0.1em]"><ShieldCheck size={14} />Grant a staff role</div>
        <p className="text-[12px] text-faint mt-1.5">Find a player and assign them a staff role. Marketers also gain a referral code automatically on first sign-in.</p>
        <div className="mt-3 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 min-w-0">
            {!picked
              ? <PlayerCombobox onSelect={p => { setErr(null); setPicked(p); }} />
              : (
                <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas px-3 py-2.5">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: picked.avatar_color }}>{picked.username[0]?.toUpperCase()}</span>
                  <span className="text-[13px] text-ink font-medium truncate flex-1">{picked.username}</span>
                  <button onClick={() => setPicked(null)} disabled={adding} className="text-faint hover:text-ink text-[12px] transition-colors disabled:opacity-40">Change</button>
                </div>
              )}
          </div>
          <select value={addRole} onChange={e => setAddRole(e.target.value as typeof addRole)}
            className="px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition">
            <option value="marketer">Marketer</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={addStaff} disabled={!picked || adding}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50 flex-shrink-0">
            {adding ? <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" /> : <UserCog size={15} />}Assign role
          </button>
        </div>
      </div>

      {/* Staff table */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.08em] text-faint">
                <th className="px-5 py-3 font-medium">Staff member</th>
                <th className="px-5 py-3 font-medium">Current role</th>
                <th className="px-5 py-3 font-medium hidden sm:table-cell">Joined</th>
                <th className="px-5 py-3 font-medium text-right">Change role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-faint">Loading staff&hellip;</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-faint">No staff yet. Grant a role above.</td></tr>
              ) : rows.map(r => {
                const self = r.id === userId;
                return (
                  <tr key={r.id} className="hover:bg-canvas/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ backgroundColor: r.avatar_color }}>{r.username[0]?.toUpperCase()}</span>
                        <span className="text-ink font-medium">{r.username}{self && <span className="ml-2 text-[11px] text-faint">(you)</span>}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold ' + (ROLE_META[r.role]?.badge ?? 'bg-slate-100 text-muted border-line')}>{ROLE_META[r.role]?.label ?? r.role}</span>
                    </td>
                    <td className="px-5 py-3 text-muted text-xs hidden sm:table-cell whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right">
                      {r.role === 'super_admin' ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted" title="The super admin is permanent and cannot be changed"><Lock size={12} />Protected</span>
                      ) : (
                        <select
                          value={r.role}
                          disabled={self}
                          title={self ? 'You cannot change your own role' : undefined}
                          onChange={e => { const to = e.target.value; if (to !== r.role) setPending({ id: r.id, username: r.username, from: r.role, to }); }}
                          className="px-3 py-1.5 bg-surface border border-line rounded-lg text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {ASSIGNABLE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm role change */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => !applying && setPending(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Change role</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">
              Change <span className="text-ink font-medium">{pending.username}</span> from{' '}
              <span className="font-medium">{ROLE_META[pending.from]?.label ?? pending.from}</span> to{' '}
              <span className="font-medium">{ROLE_META[pending.to]?.label ?? pending.to}</span>? This is recorded in the audit log.
            </p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setPending(null)} disabled={applying} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={applyRole} disabled={applying} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">
                {applying && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
