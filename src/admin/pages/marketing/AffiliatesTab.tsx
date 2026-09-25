import { TabActions } from './components';
import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import type { AffiliateRow, AffiliateReferralRow } from '../../../types/marketing';
import { Badge, Button, Card, Empty, Notice, TableWrap, Td, Th } from '../../ui/kit';
import { HEAD, fmtKsh, fmtInt, errMsg, friendly, statusBadge, fmtDateTime } from './shared';
import PromoteMarketer from './PromoteMarketer';

// Affiliates tab - admin view of every marketer with their referral & commission
// stats; expand a row to inspect that marketer's referred players. Super admins
// can promote a player to marketer (by username) or demote a marketer back to a
// player. All writes are server-enforced (admin_*); this UI only orchestrates.
export default function AffiliatesTab() {
  const { isSuperAdmin } = useAdmin();
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, AffiliateReferralRow[]>>({});
  const [refLoading, setRefLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_list_affiliates');
    if (error) { setErr(friendly(error.message)); setRows([]); }
    else setRows((data ?? []) as AffiliateRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(row: AffiliateRow) {
    if (expanded === row.marketer_id) { setExpanded(null); return; }
    setExpanded(row.marketer_id);
    if (!refs[row.marketer_id]) {
      setRefLoading(row.marketer_id);
      const { data, error } = await supabase.rpc('admin_affiliate_referrals', { p_marketer: row.marketer_id });
      if (error) setErr(friendly(error.message));
      else setRefs(prev => ({ ...prev, [row.marketer_id]: (data ?? []) as AffiliateReferralRow[] }));
      setRefLoading(null);
    }
  }

  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1600); }
    catch { /* clipboard blocked - operator can select manually */ }
  }

  async function demote(row: AffiliateRow) {
    setBusyId(row.marketer_id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_demote_marketer', { p_marketer: row.marketer_id });
      if (error) throw new Error(friendly(error.message));
      setNotice(`${row.username} was returned to a player account.`);
      if (expanded === row.marketer_id) setExpanded(null);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not demote that marketer.')); } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-6">
      <TabActions><Button onClick={load} loading={loading}>{loading ? 'Refreshing' : 'Refresh'}</Button></TabActions>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      {/* Promote a player to marketer (super admin only) */}
      {isSuperAdmin && (
        <PromoteMarketer onPromoted={msg => { setErr(null); setNotice(msg); void load(); }} />
      )}

      {/* Affiliate table */}
      <Card pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th className="w-12" />
              <Th className="!pl-0">Marketer</Th>
              <Th className="hidden md:table-cell">Code</Th>
              <Th numeric>Referred</Th>
              <Th numeric className="hidden sm:table-cell">Qualified</Th>
              <Th numeric className="hidden lg:table-cell">GGR</Th>
              <Th numeric>Available</Th>
              {isSuperAdmin && <Th numeric>Action</Th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-12 text-center text-[13px] text-faint">Loading affiliates&hellip;</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={isSuperAdmin ? 8 : 7}><Empty title={`No marketers yet.${isSuperAdmin ? ' Promote a player above to get started.' : ''}`} /></td></tr>
            )}
            {rows.map(r => {
              const open = expanded === r.marketer_id;
              return (
                <FragmentRow
                  key={r.marketer_id}
                  row={r} open={open} isSuperAdmin={isSuperAdmin}
                  onToggle={() => toggle(r)} onCopy={copyCode} copied={copied}
                  onDemote={() => demote(r)} busy={busyId === r.marketer_id}
                  referrals={refs[r.marketer_id]} refLoading={refLoading === r.marketer_id}
                />
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function FragmentRow({
  row, open, isSuperAdmin, onToggle, onCopy, copied, onDemote, busy, referrals, refLoading,
}: {
  row: AffiliateRow; open: boolean; isSuperAdmin: boolean;
  onToggle: () => void; onCopy: (c: string) => void; copied: string | null;
  onDemote: () => void; busy: boolean;
  referrals?: AffiliateReferralRow[]; refLoading: boolean;
}) {
  const colSpan = isSuperAdmin ? 8 : 7;
  return (
    <>
      <tr className="border-b border-line last:border-0 transition-colors hover:bg-white/[0.03]">
        <Td className="w-12 !py-1.5">
          <button onClick={onToggle} aria-label={open ? 'Collapse referrals' : 'Expand referrals'} aria-expanded={open}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </Td>
        <Td className="!pl-0">
          <div className="font-medium text-ink">{row.username}</div>
          {row.is_banned && <div className="mt-1"><Badge tone="down">Suspended</Badge></div>}
        </Td>
        <Td className="hidden md:table-cell">
          {row.referral_code ? (
            <button onClick={() => onCopy(row.referral_code!)} title="Copy referral code"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted transition-colors hover:text-ink">
              {row.referral_code}{copied === row.referral_code ? <Check size={13} className="text-up" /> : <Copy size={13} />}
            </button>
          ) : <span className="text-faint">-</span>}
        </Td>
        <Td numeric className="text-ink">{fmtInt(row.referred_count)}</Td>
        <Td numeric className="hidden sm:table-cell text-ink">{fmtInt(row.qualified_count)}</Td>
        <Td numeric className="hidden lg:table-cell text-muted">{fmtKsh(row.lifetime_ggr)}</Td>
        <Td numeric className="font-semibold text-up">{fmtKsh(row.commission_available)}</Td>
        {isSuperAdmin && (
          <Td className="whitespace-nowrap text-right">
            <Button size="sm" variant="danger" onClick={onDemote} loading={busy}>Demote</Button>
          </Td>
        )}
      </tr>
      {open && (
        <tr className="border-b border-line last:border-0">
          <td colSpan={colSpan} className="px-3 pb-4 pt-1 sm:px-6">
            <div className="overflow-hidden rounded-lg bg-raised/50">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <h4 className={HEAD}>Referred players</h4>
                <div className="flex items-center gap-4 text-[12px] text-muted tabular-nums">
                  <span>Earned {fmtKsh(row.commission_earned)}</span>
                  <span>Paid {fmtKsh(row.commission_paid)}</span>
                  <span>Pending {fmtKsh(row.commission_pending)}</span>
                </div>
              </div>
              {refLoading ? (
                <div className="px-4 py-8 text-center text-[13px] text-faint">Loading referrals&hellip;</div>
              ) : !referrals || referrals.length === 0 ? (
                <Empty title="No referrals yet." />
              ) : (
                <TableWrap minWidth={0}>
                  <thead>
                    <tr>
                      <Th className="pl-4">Player</Th>
                      <Th>Status</Th>
                      <Th numeric className="hidden sm:table-cell">First deposit</Th>
                      <Th numeric>GGR</Th>
                      <Th className="hidden md:table-cell">Joined</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {referrals.map(ref => (
                      <tr key={ref.player_id} className="transition-colors hover:bg-white/[0.03]">
                        <Td className="pl-4 text-ink">{ref.username}</Td>
                        <Td><Badge tone={statusBadge(ref.status)}><span className="capitalize">{ref.status}</span></Badge></Td>
                        <Td numeric className="hidden sm:table-cell text-muted">{ref.first_deposit_amount != null ? fmtKsh(ref.first_deposit_amount) : '-'}</Td>
                        <Td numeric className="text-muted">{fmtKsh(ref.player_ggr)}</Td>
                        <Td className="hidden md:table-cell whitespace-nowrap text-[12px] text-muted tabular-nums">{fmtDateTime(ref.created_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
