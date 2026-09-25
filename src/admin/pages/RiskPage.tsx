import { useState, useEffect, useCallback } from 'react';
import { errMsg } from '../../lib/errors';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, Empty, ErrorState, PageHeader, Pills, TableWrap, Td, Th } from '../ui/kit';

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

// Badge tone per risk level (kit tones: muted / warn / down).
const LEVEL_TONE: Record<string, string> = {
  low: 'muted',
  medium: 'warn',
  high: 'down',
  critical: 'down',
};

const LEVELS: Level[] = ['medium', 'high', 'critical'];

const FLAG_LABEL: Record<string, string> = {
  unusual_win_rate: 'Unusual win rate',
  scripted_betting: 'Scripted betting',
  consecutive_high_wins: 'Consecutive high wins',
  deposit_withdraw_no_play: 'Deposit/withdraw, little play',
  shared_device: 'Shared device',
  rapid_deposit_withdraw: 'Rapid deposit-withdraw',
};

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
    <>
      <PageHeader
        title="Risk & Fraud"
        subtitle="Players ranked by risk score. Scores are recomputed on each withdrawal request and on demand."
        actions={<Button onClick={() => load(minLevel)}><RefreshCw size={14} /> Refresh</Button>}
      />

      {err && <ErrorState message={err} />}

      <Pills<Level>
        items={LEVELS.map((l) => ({ value: l, label: <span className="capitalize">{l}+</span> }))}
        value={minLevel}
        onChange={setMinLevel}
        label="Minimum risk level"
      />

      <Card pad={false} className="overflow-hidden">
        <TableWrap minWidth={640}>
          <thead>
            <tr>
              <Th>Player</Th>
              <Th>Level</Th>
              <Th numeric>Score</Th>
              <Th>Flags</Th>
              <Th numeric className="hidden md:table-cell">Dep / Wd</Th>
              <Th numeric className="hidden lg:table-cell">Balance</Th>
              <Th numeric>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-[13px] text-faint">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}><Empty title="No players at this risk level." /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.user_id} className="align-top transition-colors hover:bg-white/[0.03]">
                <Td><span className="font-medium text-ink">{r.username}</span></Td>
                <Td><Badge tone={LEVEL_TONE[r.risk_level] ?? 'muted'}><span className="capitalize">{r.risk_level}</span></Badge></Td>
                <Td numeric className="font-semibold text-ink">{r.score}</Td>
                <Td>
                  <div className="flex max-w-[280px] flex-wrap gap-1">
                    {(r.flags ?? []).length === 0
                      ? <span className="text-faint">-</span>
                      : (r.flags ?? []).map((f) => (
                        <Badge key={f}>{FLAG_LABEL[f] ?? f}</Badge>
                      ))}
                  </div>
                </Td>
                <Td numeric className="hidden text-muted md:table-cell">{ksh(r.total_deposited)} / {ksh(r.total_withdrawn)}</Td>
                <Td numeric className="hidden text-ink lg:table-cell">{ksh(r.wallet_balance)}</Td>
                <Td className="text-right">
                  <Button size="sm" onClick={() => reassess(r.user_id)} loading={busyId === r.user_id}>
                    {busyId !== r.user_id && <RefreshCw size={12} />} Reassess
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
