import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

// ============================================================================
// UserDetailPage - admin player detail (Milestone 2)
// ----------------------------------------------------------------------------
// All reads/writes go through SECURITY DEFINER RPCs (the admin client cannot
// read other users' wallets/transactions, nor write other users' profiles,
// under the Phase-1 RLS lockdown):
//   admin_get_user      -> profile + balance + recent bets + transactions
//   admin_adjust_balance-> manual wallet credit/debit (audited)
//   admin_set_ban       -> ban / unban (audited; reason required to ban)
//   admin_set_role      -> change role (super_admin only; audited)
// ============================================================================

interface ProfileData {
  id: string;
  username: string;
  avatar_color: string;
  role: string;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  phone_number: string | null;
  created_at: string;
  last_active_at: string | null;
  total_deposited: number | null;
  total_withdrawn: number | null;
  total_wagered: number | null;
  total_won: number | null;
  risk_score: number | null;
  admin_notes: string | null;
}
interface BetRow { id: string; amount: number; cashout_multiplier: number | null; winnings: number | null; status: string; created_at: string; }
interface TxnRow { id: string; type: string; amount: number; description: string | null; status: string; created_at: string; }
interface UserDetail {
  profile: ProfileData;
  wallet_balance: number | null;
  bets: BetRow[];
  transactions: TxnRow[];
  can_manage_roles: boolean;
  is_self: boolean;
}

const ROLES = ['player', 'admin', 'super_admin'] as const;
const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';

function fmtKES(n: number): string { return 'KSh ' + Math.round(n).toLocaleString('en-KE'); }
function errMsg(e: unknown, fallback = 'Something went wrong'): string { return e instanceof Error ? e.message : fallback; }
function Spin() { return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />; }

function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have permission for this action.',
    FORBIDDEN_TARGET: 'Only a super admin can act on an admin account.',
    CANNOT_TARGET_SELF: 'You cannot perform this action on your own account.',
    REASON_REQUIRED: 'A reason is required.',
    INVALID_ROLE: 'Invalid role.',
    INVALID_DELTA: 'Enter a non-zero amount.',
    NEGATIVE_BALANCE: 'That adjustment would make the balance negative.',
    NO_WALLET: 'This player has no wallet.',
    NOT_FOUND: 'Player not found. They may have been removed.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

function roleBadge(role: string): string {
  return role === 'super_admin' ? 'bg-rose-50 text-down border-rose-200'
    : role === 'admin' ? 'bg-brand/10 text-brand border-brand/20'
    : 'bg-slate-100 text-muted border-line';
}
function txnBadge(type: string): string {
  switch (type) {
    case 'deposit': case 'win': case 'bonus': return 'bg-emerald-50 text-up';
    case 'withdrawal': return 'bg-rose-50 text-down';
    case 'adjustment': return 'bg-amber-50 text-amber-700';
    case 'refund': return 'bg-sky-50 text-sky-700';
    default: return 'bg-slate-100 text-muted';
  }
}

const SHELL = '-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]';

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // modal state
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [showBan, setShowBan] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_get_user', { p_user_id: userId });
    if (error) { setErr(friendly(error.message)); setD(null); }
    else { setD(data as UserDetail); }
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (userId) void load(); }, [userId, load]);

  async function adjustBalance() {
    const amt = parseFloat(adjAmount);
    if (!Number.isFinite(amt) || amt === 0) { setErr('Enter a non-zero amount.'); return; }
    if (!adjReason.trim()) { setErr('A reason is required.'); return; }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_adjust_balance', { p_user_id: userId, p_delta: amt, p_reason: adjReason.trim() });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Balance adjusted by ${amt > 0 ? '+' : ''}${fmtKES(amt)}.`);
      setShowAdjust(false); setAdjAmount(''); setAdjReason('');
      await load();
    } catch (e) { setErr(errMsg(e, 'Adjustment failed.')); }
    finally { setBusy(false); }
  }

  async function setBan(ban: boolean, reason?: string) {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_set_ban', { p_user_id: userId, p_ban: ban, p_reason: reason ?? null });
      if (error) throw new Error(friendly(error.message));
      setNotice(ban ? 'Player banned.' : 'Player unbanned.');
      setShowBan(false); setBanReason('');
      await load();
    } catch (e) { setErr(errMsg(e, 'Action failed.')); }
    finally { setBusy(false); }
  }

  async function changeRole(role: string) {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_set_role', { p_user_id: userId, p_role: role });
      if (error) throw new Error(friendly(error.message));
      setNotice(`Role changed to ${role}.`);
      setPendingRole(null);
      await load();
    } catch (e) { setErr(errMsg(e, 'Role change failed.')); }
    finally { setBusy(false); }
  }

  if (loading) return <div className={SHELL}><div className="h-40 rounded-xl border border-line bg-surface animate-pulse" /></div>;
  if (!d) return (
    <div className={SHELL}>
      <button onClick={() => navigate('/admin/users')} className="text-[13px] text-muted hover:text-ink transition-colors">&larr; Back</button>
      <div className="mt-4 text-down text-sm">{err ?? 'Player not found'}</div>
    </div>
  );

  const p = d.profile;
  const winRate = d.bets.length ? Math.round(d.bets.filter(b => b.status === 'won').length / d.bets.length * 100) : 0;
  const STATS = [
    { l: 'Balance', v: d.wallet_balance != null ? fmtKES(Number(d.wallet_balance)) : '-' },
    { l: 'Deposited', v: fmtKES(Number(p.total_deposited ?? 0)) },
    { l: 'Withdrawn', v: fmtKES(Number(p.total_withdrawn ?? 0)) },
    { l: 'Wagered', v: fmtKES(Number(p.total_wagered ?? 0)) },
    { l: 'Won', v: fmtKES(Number(p.total_won ?? 0)) },
    { l: 'Win Rate', v: winRate + '%' },
  ];

  return (
    <div className={SHELL}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={() => navigate('/admin/users')} className="text-[13px] text-muted hover:text-ink transition-colors">&larr; Back</button>
          <div className="flex items-center gap-3">
            {notice && <span role="status" className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-up text-[12px] max-w-[320px] truncate" title={notice}>{notice}</span>}
            {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[320px] truncate" title={err}>{err}</span>}
          </div>
        </div>

        {/* Identity + actions */}
        <div className="rounded-xl border border-line bg-surface p-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold" style={{ backgroundColor: p.avatar_color }}>{p.username[0]?.toUpperCase()}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-ink text-lg font-semibold">{p.username}</h2>
                <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold ' + roleBadge(p.role)}>{p.role}</span>
                {p.is_banned && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-down"><span className="h-1.5 w-1.5 rounded-full bg-down" />Banned</span>}
              </div>
              <div className="text-xs text-muted mt-1 space-x-3">
                {p.phone_number && <span className="font-mono">{p.phone_number}</span>}
                <span>Joined {new Date(p.created_at).toLocaleDateString()}</span>
                {p.last_active_at && <span>Active {new Date(p.last_active_at).toLocaleDateString()}</span>}
              </div>
              {p.is_banned && p.ban_reason && <div className="text-[12px] text-down mt-1.5">Reason: {p.ban_reason}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {d.can_manage_roles && !d.is_self && (
              <select
                value={p.role}
                onChange={e => { if (e.target.value !== p.role) setPendingRole(e.target.value); }}
                aria-label="Change role"
                className="px-3 py-2 rounded-lg border border-line bg-surface text-ink text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <button onClick={() => { setErr(null); setAdjAmount(''); setAdjReason(''); setShowAdjust(true); }} disabled={d.wallet_balance == null} className="px-3 py-2 rounded-lg border border-line bg-surface text-ink text-xs font-medium hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-40">Adjust Balance</button>
            {p.is_banned
              ? <button onClick={() => setBan(false)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-brand/30 text-brand hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-40">{busy && <Spin />}Unban</button>
              : <button onClick={() => { setErr(null); setBanReason(''); setShowBan(true); }} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-medium border border-rose-200 text-down hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition-colors disabled:opacity-40">Ban</button>}
          </div>
        </div>

        {/* Stats */}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-line">
            {STATS.map(s => (
              <div key={s.l} className="p-5">
                <div className={CAP}>{s.l}</div>
                <div className="mt-2 text-lg font-semibold text-ink tabular-nums">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent bets */}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line"><h3 className={HEAD}>Recent Bets</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 text-left font-medium">Time</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cashout</th>
                  <th className="px-5 py-2.5 text-right font-medium">Won</th>
                  <th className="px-5 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.bets.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-faint">No bets</td></tr>
                ) : d.bets.map(b => (
                  <tr key={b.id}>
                    <td className="px-5 py-2.5 text-muted text-xs">{new Date(b.created_at).toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right text-ink tabular-nums">{fmtKES(Number(b.amount))}</td>
                    <td className="px-5 py-2.5 text-right text-muted tabular-nums">{b.cashout_multiplier ? `${Number(b.cashout_multiplier).toFixed(2)}x` : '-'}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{b.winnings ? <span className="text-up">+{Number(b.winnings).toLocaleString()}</span> : '-'}</td>
                    <td className="px-5 py-2.5"><span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ' + (b.status === 'won' ? 'bg-emerald-50 text-up' : b.status === 'lost' ? 'bg-rose-50 text-down' : 'bg-amber-50 text-amber-600')}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent transactions */}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line"><h3 className={HEAD}>Recent Transactions</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 text-left font-medium">Time</th>
                  <th className="px-5 py-2.5 text-left font-medium">Type</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 text-left font-medium hidden sm:table-cell">Description</th>
                  <th className="px-5 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.transactions.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-faint">No transactions</td></tr>
                ) : d.transactions.map(t => (
                  <tr key={t.id}>
                    <td className="px-5 py-2.5 text-muted text-xs">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="px-5 py-2.5"><span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ' + txnBadge(t.type)}>{t.type}</span></td>
                    <td className={'px-5 py-2.5 text-right tabular-nums ' + (Number(t.amount) < 0 ? 'text-down' : 'text-ink')}>{Number(t.amount) > 0 ? '+' : ''}{fmtKES(Number(t.amount))}</td>
                    <td className="px-5 py-2.5 text-muted text-xs hidden sm:table-cell max-w-[260px] truncate" title={t.description ?? ''}>{t.description ?? '-'}</td>
                    <td className="px-5 py-2.5 text-muted text-xs">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Adjust balance modal */}
      {showAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busy ? null : setShowAdjust(false)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Adjust Balance</h3>
            <p className="text-muted text-[13px] mt-2 leading-relaxed">Current balance: <span className="font-semibold text-ink">{fmtKES(Number(d.wallet_balance ?? 0))}</span>. Use a positive amount to credit, negative to debit.</p>
            <label className="block mt-4 text-[12px] font-medium text-muted">Amount (KES)</label>
            <input type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} autoFocus placeholder="e.g. 500 or -200" className="mt-1 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
            <label className="block mt-3 text-[12px] font-medium text-muted">Reason</label>
            <input type="text" value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Reason (required)" className="mt-1 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAdjust(false)} disabled={busy} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={adjustBalance} disabled={busy || !adjAmount.trim() || !adjReason.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">{busy && <Spin />}Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Ban modal */}
      {showBan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busy ? null : setShowBan(false)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Ban {p.username}</h3>
            <p className="text-muted text-[13px] mt-2 leading-relaxed">The player will be flagged as banned. A reason is required and recorded in the audit log.</p>
            <textarea value={banReason} onChange={e => setBanReason(e.target.value)} autoFocus rows={3} placeholder="Reason for ban (required)" className="mt-4 w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-down/30 focus:border-down/40 resize-none transition" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowBan(false)} disabled={busy} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => setBan(true, banReason)} disabled={busy || !banReason.trim()} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-down hover:brightness-95">{busy && <Spin />}Ban</button>
            </div>
          </div>
        </div>
      )}

      {/* Role change confirmation */}
      {pendingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busy ? null : setPendingRole(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Change role</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">Change <span className="font-semibold text-ink">{p.username}</span> from <span className="font-semibold text-ink">{p.role}</span> to <span className="font-semibold text-ink">{pendingRole}</span>? This grants or revokes dashboard access.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setPendingRole(null)} disabled={busy} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => changeRole(pendingRole)} disabled={busy} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">{busy && <Spin />}Change</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
