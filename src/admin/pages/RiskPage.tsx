import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ============================================================================
// Risk & Fraud Alerts (docs/admin-dashboard/07-risk-fraud-detection.md 7.2)
// ----------------------------------------------------------------------------
// Reads the cached player_risk_scores via admin_list_fraud_alerts and lets an
// operator re-run assess_player_risk on demand (admin_assess_player_risk). All
// scoring is server-side; this page only reads and triggers recomputation.
// ============================================================================

interface AlertRow {
  user_id: string;
  username: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | string;
  score: number;
  flags: string[];
  last_assessed_at: string;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  wallet_balance: number | null;
}

type Level = 'medium' | 'high' | 'critical';

const LEVEL_BADGE: Record<string, string> = {
  low: 'bg-slate-100 text-muted',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-orange-50 text-orange-700',
  critical: 'bg-rose-50 text-down',
};

const FLAG_LABEL: Record<string, string> = {
  unusual_win_rate: 'Unusual win rate',
  scripted_betting: 'Scripted betting',
  consecutive_high_wins: 'Consecutive high wins',
  deposit_withdraw_no_play: 'Deposit/withdraw, little play',
  shared_device: 'Shared device',
  rapid_deposit_withdraw: 'Rapid deposit-withdraw',
};

function Spin() { return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />; }
const ksh = (n: number | null | undefined) => `KSh ${Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

export default function RiskPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [minLevel, setMinLevel] = useState<Level>('high');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (level: Level) => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_list_fraud_alerts', { p_min_level: level, p_limit: 100 });
    if (error) { setErr(error.message.includes('FORBIDDEN') ? 'You do not have permission to view this.' : 'Failed to load alerts.'); setRows([]); }
    else setRows((data ?? []) as AlertRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(minLevel); }, [load, minLevel]);

  async function reassess(userId: string) {
    setBusyId(userId); setErr(null);
    try {
      const { error } = await supabase.rpc('admin_assess_player_risk', { p_user_id: userId });
      if (error) throw new Error(error.message);
      await load(minLevel);
    } catch (e) { setErr(errMsg(e, 'Action failed')); }
    finally { setBusyId(null); }
  }

  return (
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-ink tracking-tight flex items-center gap-2">
              <ShieldAlert size={20} strokeWidth={1.9} className="text-down" /> Risk &amp; Fraud
            </h1>
            <p className="text-[13px] text-muted mt-1">Players ranked by risk score. Scores are recomputed on each withdrawal request and on demand.</p>
          </div>
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[320px] truncate" title={err}>{err}</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(['medium', 'high', 'critical'] as Level[]).map((l) => (
            <button
              key={l}
              onClick={() => setMinLevel(l)}
              className={'px-3 py-1.5 rounded-lg text-[12px] font-semibold capitalize transition-colors ' +
                (minLevel === l ? 'bg-brand text-white' : 'bg-surface border border-line text-muted hover:text-ink')}
            >
              {l}+
            </button>
          ))}
          <button onClick={() => load(minLevel)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface text-[12px] font-semibold text-muted hover:text-ink transition-colors">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="text-left font-medium px-5 py-3">Player</th>
                  <th className="text-left font-medium px-5 py-3">Level</th>
                  <th className="text-right font-medium px-5 py-3">Score</th>
                  <th className="text-left font-medium px-5 py-3">Flags</th>
                  <th className="text-right font-medium px-5 py-3 hidden md:table-cell">Dep / Wd</th>
                  <th className="text-right font-medium px-5 py-3 hidden lg:table-cell">Balance</th>
                  <th className="text-right font-medium px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-faint">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-faint">No players at this risk level.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.user_id} className="hover:bg-canvas transition-colors align-top">
                    <td className="px-5 py-3"><span className="text-ink font-medium">{r.username}</span></td>
                    <td className="px-5 py-3"><span className={'text-[10px] px-2 py-0.5 rounded font-semibold capitalize ' + (LEVEL_BADGE[r.risk_level] ?? 'bg-slate-100 text-muted')}>{r.risk_level}</span></td>
                    <td className="px-5 py-3 text-right text-ink font-semibold tabular-nums">{r.score}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {(r.flags ?? []).length === 0
                          ? <span className="text-faint text-xs">-</span>
                          : (r.flags ?? []).map((f) => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-muted">{FLAG_LABEL[f] ?? f}</span>
                          ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-muted text-xs tabular-nums hidden md:table-cell">{ksh(r.total_deposited)} / {ksh(r.total_withdrawn)}</td>
                    <td className="px-5 py-3 text-right text-ink text-xs tabular-nums hidden lg:table-cell">{ksh(r.wallet_balance)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => reassess(r.user_id)} disabled={busyId === r.user_id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-[12px] font-semibold text-muted hover:text-ink transition-colors disabled:opacity-40">
                        {busyId === r.user_id ? <Spin /> : <RefreshCw size={12} />} Reassess
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
