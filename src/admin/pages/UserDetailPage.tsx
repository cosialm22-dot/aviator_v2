import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { Badge, Button, Card, Empty, ErrorState, Field, Modal, Notice, PageHeader, Select, StatCard, TableWrap, Td, Th, inputCls } from '../ui/kit';

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

const ROLES = ['player', 'marketer', 'admin'] as const;

function fmtKES(n: number): string { return 'KSh ' + Math.round(n).toLocaleString('en-KE'); }

function friendly(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: 'You do not have permission for this action.',
    FORBIDDEN_TARGET: 'Only a super admin can act on an admin account.',
    CANNOT_TARGET_SELF: 'You cannot perform this action on your own account.',
    REASON_REQUIRED: 'A reason is required.',
    INVALID_ROLE: 'Invalid role.',
    LAST_SUPER_ADMIN: 'At least one super admin must remain.',
    SUPER_ADMIN_LOCKED: 'No one can be promoted to super admin.',
    ROOT_SUPER_ADMIN_PROTECTED: 'The super admin is protected and cannot be changed, banned, or removed.',
    INVALID_DELTA: 'Enter a non-zero amount.',
    NEGATIVE_BALANCE: 'That adjustment would make the balance negative.',
    NO_WALLET: 'This player has no wallet.',
    NOT_FOUND: 'Player not found. They may have been removed.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return code || 'Action failed. Please try again.';
}

type Tone = 'up' | 'down' | 'warn' | 'brand' | 'muted';
function roleTone(role: string): Tone {
  return role === 'super_admin' ? 'down'
    : role === 'admin' ? 'brand'
    : role === 'marketer' ? 'warn'
    : 'muted';
}
function txnTone(type: string): Tone {
  switch (type) {
    case 'deposit': case 'win': case 'bonus': return 'up';
    case 'withdrawal': return 'down';
    case 'adjustment': return 'warn';
    case 'refund': return 'brand';
    default: return 'muted';
  }
}

const SHELL = 'flex flex-col gap-6';

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<UserDetail | null>(null);
  // Support can look but not act (the server refuses too).
  const { role: myRole } = useAdmin();
  const canAct = myRole !== 'support';
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

  // Stable closers so the kit Modal does not re-run its focus effect on every keystroke.
  const closeAdjust = useCallback(() => { if (!busy) setShowAdjust(false); }, [busy]);
  const closeBan = useCallback(() => { if (!busy) setShowBan(false); }, [busy]);
  const closeRole = useCallback(() => { if (!busy) setPendingRole(null); }, [busy]);

  const back = <button onClick={() => navigate('/admin/users')} className="text-[13px] font-medium text-brand transition-colors hover:underline">&larr; Back</button>;

  if (loading) return <div className={SHELL}><div className="h-40 rounded-xl bg-surface animate-pulse" /></div>;
  if (!d) return (
    <div className={SHELL}>
      <div>{back}</div>
      <ErrorState message={err ?? 'Player not found'} />
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
      <PageHeader
        eyebrow={back}
        title={p.username}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <Badge tone={roleTone(p.role)}>{p.role}</Badge>
            {p.is_banned && <Badge tone="down">Banned</Badge>}
            {p.phone_number && <span className="font-mono text-[12px]">{p.phone_number}</span>}
            <span>Joined {new Date(p.created_at).toLocaleDateString()}</span>
            {p.last_active_at && <span>Active {new Date(p.last_active_at).toLocaleDateString()}</span>}
          </span>
        }
        actions={!canAct ? (
          <span className="inline-flex h-8 items-center rounded-lg bg-raised px-3 text-[13px] text-muted" data-testid="view-only">View only — support cannot change accounts</span>
        ) : p.role === 'super_admin' || p.role === 'platform_superadmin' ? (
          <span className="inline-flex h-8 items-center rounded-lg bg-raised px-3 text-[13px] font-medium text-muted" title="The super admin is permanent: it cannot be demoted, banned, or removed.">Protected super admin</span>
        ) : (
          <>
            {d.can_manage_roles && !d.is_self && (
              <Select<string>
                value={p.role}
                onChange={v => { if (v !== p.role) setPendingRole(v); }}
                label="Change role"
                options={ROLES.map(r => ({ value: r, label: r }))}
              />
            )}
            <Button onClick={() => { setErr(null); setAdjAmount(''); setAdjReason(''); setShowAdjust(true); }} disabled={d.wallet_balance == null}>Adjust Balance</Button>
            {p.is_banned
              ? <Button onClick={() => setBan(false)} loading={busy}>Unban</Button>
              : <Button variant="danger" onClick={() => { setErr(null); setBanReason(''); setShowBan(true); }} disabled={busy}>Ban</Button>}
          </>
        )}
      />

      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      {p.is_banned && p.ban_reason && <div className="rounded-xl bg-down/10 px-4 py-2.5 text-[13px] text-down">Reason: {p.ban_reason}</div>}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STATS.map(s => <StatCard key={s.l} label={s.l} value={s.v} />)}
      </div>

      {/* Recent bets */}
      <Card title="Recent Bets" pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="pl-5">Time</Th>
              <Th numeric>Amount</Th>
              <Th numeric>Cashout</Th>
              <Th numeric>Won</Th>
              <Th className="pr-5">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.bets.length === 0 ? (
              <tr><td colSpan={5}><Empty title="No bets" /></td></tr>
            ) : d.bets.map(b => (
              <tr key={b.id} className="transition-colors hover:bg-white/[0.03]">
                <Td className="pl-5 whitespace-nowrap text-[12px] text-muted tabular-nums">{new Date(b.created_at).toLocaleString()}</Td>
                <Td numeric className="text-ink">{fmtKES(Number(b.amount))}</Td>
                <Td numeric className="text-muted">{b.cashout_multiplier ? `${Number(b.cashout_multiplier).toFixed(2)}x` : '-'}</Td>
                <Td numeric>{b.winnings ? <span className="text-up">+{Number(b.winnings).toLocaleString()}</span> : '-'}</Td>
                <Td className="pr-5"><Badge tone={b.status === 'won' ? 'up' : b.status === 'lost' ? 'down' : 'warn'}>{b.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Recent transactions */}
      <Card title="Recent Transactions" pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="pl-5">Time</Th>
              <Th>Type</Th>
              <Th numeric>Amount</Th>
              <Th className="hidden sm:table-cell">Description</Th>
              <Th className="pr-5">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.transactions.length === 0 ? (
              <tr><td colSpan={5}><Empty title="No transactions" /></td></tr>
            ) : d.transactions.map(t => (
              <tr key={t.id} className="transition-colors hover:bg-white/[0.03]">
                <Td className="pl-5 whitespace-nowrap text-[12px] text-muted tabular-nums">{new Date(t.created_at).toLocaleString()}</Td>
                <Td><Badge tone={txnTone(t.type)}><span className="capitalize">{t.type}</span></Badge></Td>
                <Td numeric className={Number(t.amount) < 0 ? 'text-down' : 'text-ink'}>{Number(t.amount) > 0 ? '+' : ''}{fmtKES(Number(t.amount))}</Td>
                <Td className="hidden sm:table-cell max-w-[260px] truncate text-muted" title={t.description ?? ''}>{t.description ?? '-'}</Td>
                <Td className="pr-5 text-muted">{t.status}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Adjust balance modal */}
      {showAdjust && (
        <Modal title="Adjust Balance" onClose={closeAdjust} width={400}
          subtitle={<>Current balance: <span className="font-semibold text-ink tabular-nums">{fmtKES(Number(d.wallet_balance ?? 0))}</span>. Use a positive amount to credit, negative to debit.</>}
          footer={<>
            <Button onClick={() => setShowAdjust(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={adjustBalance} loading={busy} disabled={!adjAmount.trim() || !adjReason.trim()}>Apply</Button>
          </>}>
          <Field label="Amount (KES)">
            <input type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} autoFocus placeholder="e.g. 500 or -200" className={inputCls + ' tabular-nums'} />
          </Field>
          <Field label="Reason">
            <input type="text" value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Reason (required)" className={inputCls} />
          </Field>
        </Modal>
      )}

      {/* Ban modal */}
      {showBan && (
        <Modal title={`Ban ${p.username}`} tone="danger" onClose={closeBan} width={400}
          subtitle="The player will be flagged as banned. A reason is required and recorded in the audit log."
          footer={<>
            <Button onClick={() => setShowBan(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => setBan(true, banReason)} loading={busy} disabled={!banReason.trim()}>Ban</Button>
          </>}>
          <textarea value={banReason} onChange={e => setBanReason(e.target.value)} autoFocus rows={3} placeholder="Reason for ban (required)" aria-label="Reason for ban"
            className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50" />
        </Modal>
      )}

      {/* Role change confirmation */}
      {pendingRole && (
        <Modal title="Change role" onClose={closeRole} width={400}
          footer={<>
            <Button onClick={() => setPendingRole(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => changeRole(pendingRole)} loading={busy}>Change</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted">Change <span className="font-semibold text-ink">{p.username}</span> from <span className="font-semibold text-ink">{p.role}</span> to <span className="font-semibold text-ink">{pendingRole}</span>? This grants or revokes dashboard access.</p>
        </Modal>
      )}
    </div>
  );
}
