import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdmin } from '../../roleContext';
import type { AffiliateRow, AffiliateReferralRow } from '../../../types/marketing';
import { HEAD, fmtKsh, fmtInt, errMsg, friendly, statusBadge, fmtDateTime } from './shared';
import { Spin } from './components';
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
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-3 -mt-2">
        {notice && <span role="status" className="px-3 py-1.5 bg-up/10 border border-up/30 rounded-lg text-up text-[12px] max-w-[420px] truncate" title={notice}>{notice}</span>}
        {err && <span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[420px] truncate" title={err}>{err}</span>}
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors disabled:opacity-50">
          {loading && <Spin />}{loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {/* Promote a player to marketer (super admin only) */}
      {isSuperAdmin && (
        <PromoteMarketer onPromoted={msg => { setErr(null); setNotice(msg); void load(); }} />
      )}

      {/* Affiliate table */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-medium text-muted text-[12px] w-8"></th>
                <th className="px-2 py-3 font-medium text-muted text-[12px]">Marketer</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] hidden md:table-cell">Code</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] text-right">Referred</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] text-right hidden sm:table-cell">Qualified</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] text-right hidden lg:table-cell">GGR</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] text-right">Available</th>
                {isSuperAdmin && <th className="px-4 py-3 font-medium text-muted text-[12px] text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-12 text-center text-faint text-sm">Loading affiliates&hellip;</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-12 text-center text-faint text-sm">No marketers yet.{isSuperAdmin ? ' Promote a player above to get started.' : ''}</td></tr>
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
          </table>
        </div>
      </div>
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
      <tr className="border-b border-line last:border-0 hover:bg-canvas/60 transition-colors">
        <td className="px-4 py-3">
          <button onClick={onToggle} aria-label={open ? 'Collapse referrals' : 'Expand referrals'} aria-expanded={open}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-muted hover:text-ink hover:bg-canvas transition-colors">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </td>
        <td className="px-2 py-3">
          <div className="text-ink font-medium">{row.username}</div>
          {row.is_banned && <span className="inline-flex mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-down/10 text-down border-down/30">Suspended</span>}
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          {row.referral_code ? (
            <button onClick={() => onCopy(row.referral_code!)} title="Copy referral code"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted hover:text-ink transition-colors">
              {row.referral_code}{copied === row.referral_code ? <Check size={13} className="text-up" /> : <Copy size={13} />}
            </button>
          ) : <span className="text-faint text-[12px]">-</span>}
        </td>
        <td className="px-4 py-3 text-right text-ink tabular-nums">{fmtInt(row.referred_count)}</td>
        <td className="px-4 py-3 text-right text-ink tabular-nums hidden sm:table-cell">{fmtInt(row.qualified_count)}</td>
        <td className="px-4 py-3 text-right text-muted tabular-nums hidden lg:table-cell">{fmtKsh(row.lifetime_ggr)}</td>
        <td className="px-4 py-3 text-right text-up font-semibold tabular-nums">{fmtKsh(row.commission_available)}</td>
        {isSuperAdmin && (
          <td className="px-4 py-3 text-right whitespace-nowrap">
            <button onClick={onDemote} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-muted hover:text-down hover:border-down/40 text-[12px] font-semibold transition-colors disabled:opacity-40">
              {busy && <Spin />}Demote
            </button>
          </td>
        )}
      </tr>
      {open && (
        <tr className="bg-canvas/40">
          <td colSpan={colSpan} className="px-4 sm:px-8 py-4">
            <div className="rounded-lg border border-line bg-surface overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
                <h4 className={HEAD}>Referred players</h4>
                <div className="flex items-center gap-4 text-[12px] text-muted tabular-nums">
                  <span>Earned {fmtKsh(row.commission_earned)}</span>
                  <span>Paid {fmtKsh(row.commission_paid)}</span>
                  <span>Pending {fmtKsh(row.commission_pending)}</span>
                </div>
              </div>
              {refLoading ? (
                <div className="px-4 py-8 text-center text-faint text-sm">Loading referrals&hellip;</div>
              ) : !referrals || referrals.length === 0 ? (
                <div className="px-4 py-8 text-center text-faint text-sm">No referrals yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left">
                        <th className="px-4 py-2.5 font-medium text-muted text-[12px]">Player</th>
                        <th className="px-4 py-2.5 font-medium text-muted text-[12px]">Status</th>
                        <th className="px-4 py-2.5 font-medium text-muted text-[12px] text-right hidden sm:table-cell">First deposit</th>
                        <th className="px-4 py-2.5 font-medium text-muted text-[12px] text-right">GGR</th>
                        <th className="px-4 py-2.5 font-medium text-muted text-[12px] hidden md:table-cell">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrals.map(ref => (
                        <tr key={ref.player_id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5 text-ink">{ref.username}</td>
                          <td className="px-4 py-2.5">
                            <span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ' + statusBadge(ref.status)}>{ref.status}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted tabular-nums hidden sm:table-cell">{ref.first_deposit_amount != null ? fmtKsh(ref.first_deposit_amount) : '-'}</td>
                          <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fmtKsh(ref.player_ggr)}</td>
                          <td className="px-4 py-2.5 text-muted text-xs hidden md:table-cell whitespace-nowrap">{fmtDateTime(ref.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
