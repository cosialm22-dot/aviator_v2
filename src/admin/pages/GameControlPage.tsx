import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getMultiplierAtTime, formatMultiplier } from '../../lib/gameEngine';
import {
  Play, AlertTriangle, Zap, Plus, Trash2, Clock, TrendingUp,
  Users, RefreshCw, X, Target, CheckCircle,
  Settings, Loader2
} from 'lucide-react';

interface GameRoundRow {
  id: string; crash_multiplier: number; status: string;
  started_at: string | null; crashed_at: string | null;
  source: string; queue_id: string | null;
  total_bets_amount: number; total_payouts: number;
}

interface CQItem {
  id: string; crash_point: number; position: number;
  status: string; batch_id: string | null;
  notes: string | null; created_at: string;
}

interface GSetting {
  key: string; value: string | number | boolean;
  category: string; description: string | null;
  updated_at: string;
}

const POLL_MS = 3000;
const TICK_MS = 150;
const ZOMBIE_THRESHOLD_MS = 2 * 60 * 1000;
const MIN_CRASH = 1.0;
const MAX_CRASH = 80.0;

function fmtKES(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-KE');
}

function elapsedSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function statusColor(s: string): string {
  switch (s) {
    case 'flying': return 'bg-green-500 text-white';
    case 'crashed': return 'bg-red-500 text-white';
    case 'waiting': return 'bg-amber-500 text-black';
    default: return 'bg-slate-600 text-white';
  }
}

export default function GameControlPage() {
  const [round, setRound] = useState<GameRoundRow | null>(null);
  const [betsCount, setBetsCount] = useState(0);
  const [betsTotal, setBetsTotal] = useState(0);
  const [mult, setMult] = useState(1.0);
  const [queue, setQueue] = useState<CQItem[]>([]);
  const [gSettings, setGSettings] = useState<GSetting[]>([]);
  const [zombieCount, setZombieCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [singleVal, setSingleVal] = useState('');
  const [batchVal, setBatchVal] = useState('');
  const [showForceCrash, setShowForceCrash] = useState(false);
  const [showClearQueue, setShowClearQueue] = useState(false);
  const [showRecover, setShowRecover] = useState(false);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [actionLock, setActionLock] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const tickRef = useRef<ReturnType<typeof setInterval>>();
  const aborterRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      aborterRef.current?.abort();
      const ac = new AbortController();
      aborterRef.current = ac;
      const s = ac.signal;
      const [rr, ar, qr, sr, zr] = await Promise.all([
        supabase.from('game_rounds').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle().abortSignal(s),
        supabase.from('game_rounds').select('id').eq('status', 'flying').limit(1).maybeSingle().abortSignal(s),
        supabase.from('crash_queue').select('*').order('position', { ascending: true }).limit(100).abortSignal(s),
        supabase.from('system_settings').select('*').eq('category', 'game').order('key').abortSignal(s),
        supabase.from('game_rounds').select('id', { count: 'exact', head: true }).eq('status', 'flying').lt('started_at', new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString()).abortSignal(s),
      ]);
      if (s.aborted) return;
      let active = (rr.data ?? null) as GameRoundRow | null;
      if (ar.data && active?.status !== 'flying') {
        const fr = await supabase.from('game_rounds').select('*').eq('id', ar.data.id).maybeSingle().abortSignal(s);
        if (!s.aborted && fr.data) active = fr.data as GameRoundRow;
      }
      setRound(active);
      if (active?.status === 'flying') {
        const br = await supabase.from('bets').select('amount', { count: 'exact' }).eq('round_id', active.id).eq('status', 'active').abortSignal(s);
        if (!s.aborted && br.data) {
          setBetsCount(br.count ?? 0);
          setBetsTotal(br.data.reduce((sm: number, b: any) => sm + Number(b.amount), 0));
        }
      } else { setBetsCount(0); setBetsTotal(0); }
      setQueue((qr.data ?? []) as CQItem[]);
      setGSettings((sr.data ?? []) as GSetting[]);
      setZombieCount(zr.count ?? 0);
      setEditVals(prev => {
        const next = { ...prev };
        for (const sx of (sr.data ?? []) as GSetting[]) {
          if (!(sx.key in next)) next[sx.key] = String(sx.value);
        }
        return next;
      });
      setError(null);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Fetch failed');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (round?.status !== 'flying' || !round.started_at) { setMult(1.0); return; }
    const start = new Date(round.started_at).getTime();
    const tick = () => {
      const m = getMultiplierAtTime(Date.now() - start);
      const crashAt = Number(round.crash_multiplier);
      setMult(m >= crashAt ? crashAt : m);
    };
    tick();
    tickRef.current = setInterval(tick, TICK_MS);
    return () => clearInterval(tickRef.current);
  }, [round?.status, round?.started_at, round?.crash_multiplier]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, POLL_MS);
    return () => { clearInterval(pollRef.current); clearInterval(tickRef.current); aborterRef.current?.abort(); };
  }, [fetchAll]);

  const audit = useCallback(async (action: string, targetId?: string, details?: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      await supabase.from('admin_audit_log').insert({
        admin_id: session.user.id, action,
        target_type: 'game', target_id: targetId || null,
        details: details || null,
      });
    } catch { /* non-critical */ }
  }, []);

  const forceCrash = async () => {
    if (!round || round.status !== 'flying' || actionLock) return;
    setActionLock('force-crash');
    try {
      await supabase.from('game_rounds').update({
        status: 'crashed', crashed_at: new Date().toISOString(),
      }).eq('id', round.id);
      await supabase.from('bets').update({ status: 'lost' }).eq('round_id', round.id).eq('status', 'active');
      await audit('force_crash', round.id, { multiplier: mult, source: round.source });
      setShowForceCrash(false);
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Force crash failed'); }
    finally { setActionLock(null); }
  };

  const recoverZombies = async () => {
    if (actionLock) return;
    setActionLock('recover');
    try {
      const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString();
      const { count } = await supabase.from('game_rounds').update({
        status: 'crashed', crashed_at: new Date().toISOString(),
      }).eq('status', 'flying').lt('started_at', cutoff).select('id', { count: 'exact' });
      await audit('recover_zombies', null, { count: count ?? 0 });
      setShowRecover(false);
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Recovery failed'); }
    finally { setActionLock(null); }
  };

  const addSingle = async () => {
    if (actionLock) return;
    const v = parseFloat(singleVal);
    if (isNaN(v) || v < MIN_CRASH || v > MAX_CRASH) {
      setError('Crash point must be between ' + MIN_CRASH + ' and ' + MAX_CRASH);
      return;
    }
    setActionLock('add-single');
    try {
      const pos = queue.length > 0 ? Math.max(...queue.map(q => q.position)) + 1 : 1;
      await supabase.from('crash_queue').insert({
        crash_point: v, position: pos, status: 'pending',
        created_at: new Date().toISOString(),
      });
      await audit('queue_add', null, { crash_point: v, position: pos });
      setSingleVal(''); setError(null);
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Add failed'); }
    finally { setActionLock(null); }
  };

  const addBatch = async () => {
    if (actionLock) return;
    const lines = batchVal.split(/[\n,]+/).map(l => l.trim()).filter(l => l !== '');
    const vals: number[] = [];
    const errors: string[] = [];
    for (const l of lines) {
      const v = parseFloat(l);
      if (isNaN(v) || v < MIN_CRASH || v > MAX_CRASH) errors.push('Invalid: ' + l);
      else vals.push(v);
    }
    if (errors.length > 0) { setError(errors.join('; ')); return; }
    if (vals.length === 0) return;
    setActionLock('add-batch');
    try {
      const basePos = queue.length > 0 ? Math.max(...queue.map(q => q.position)) + 1 : 1;
      const rows = vals.map((v, i) => ({
        crash_point: v, position: basePos + i,
        status: 'pending', created_at: new Date().toISOString(),
      }));
      await supabase.from('crash_queue').insert(rows);
      await audit('queue_batch_add', null, { count: vals.length });
      setBatchVal(''); setError(null);
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Batch add failed'); }
    finally { setActionLock(null); }
  };

  const removeFromQueue = async (id: string, crashPoint: number) => {
    if (actionLock) return;
    setActionLock('remove-' + id);
    try {
      await supabase.from('crash_queue').delete().eq('id', id);
      await audit('queue_remove', id, { crash_point: crashPoint });
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Remove failed'); }
    finally { setActionLock(null); }
  };

  const clearQueue = async () => {
    if (actionLock) return;
    setActionLock('clear-queue');
    try {
      const pendingIds = queue.filter(q => q.status === 'pending').map(q => q.id);
      for (const id of pendingIds) {
        await supabase.from('crash_queue').delete().eq('id', id);
      }
      await audit('queue_clear', null, { count: pendingIds.length });
      setShowClearQueue(false);
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Clear failed'); }
    finally { setActionLock(null); }
  };

  const saveSetting = async (key: string) => {
    if (actionLock) return;
    const raw = editVals[key];
    const original = gSettings.find(sx => sx.key === key);
    if (!original || String(original.value) === raw) return;
    let parsed: any = raw;
    if (raw === 'true') parsed = true;
    else if (raw === 'false') parsed = false;
    else if (!isNaN(Number(raw)) && raw.trim() !== '') parsed = Number(raw);
    setSaving(key);
    try {
      await supabase.from('system_settings').update({
        value: parsed, updated_at: new Date().toISOString(),
      }).eq('key', key);
      await audit('setting_updated', key, { old: original.value, new: parsed });
      fetchAll();
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setSaving(null); }
  };

  const isFlying = round?.status === 'flying';
  const pendingQueue = queue.filter(q => q.status === 'pending');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Game Control</h1>
          <p className="text-sm text-slate-500 mt-1">Crash queue, live monitor, algorithm settings</p>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs max-w-[280px] truncate" title={error}>{error}</div>
          )}
          <button onClick={fetchAll} disabled={loading} className="p-2 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg text-slate-400 hover:text-white transition disabled:opacity-50" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* LIVE ROUND MONITOR */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Play size={12} /> Live Round Monitor
          {zombieCount > 0 && (
            <button onClick={() => setShowRecover(true)} className="ml-auto px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-[10px] font-medium hover:bg-amber-500/20 transition">
              <AlertTriangle size={10} className="inline mr-1" />
              {zombieCount} zombie{...zombieCount !== 1 ? ['s'] : []} — Recover
            </button>
          )}
        </h2>

        {loading && !round ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-[#111122] border border-[#1e1e35] rounded-xl animate-pulse" />)}
          </div>
        ) : !round ? (
          <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-8 text-center">
            <div className="text-3xl mb-3">...</div>
            <div className="text-white font-semibold">No rounds recorded</div>
            <div className="text-xs text-slate-500 mt-1">Start the game on the player page to see data here</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isFlying ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-xs text-slate-500">Status</span>
              </div>
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${statusColor(round.status)}`}>{round.status?.toUpperCase()}</span>
              <div className="text-[10px] text-slate-600 mt-1.5">
                Source: <span className="text-slate-400 font-medium">{round.source || 'algorithm'}</span>
              </div>
            </div>
            <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={14} className={isFlying ? 'text-green-400' : 'text-slate-500'} />
                <span className="text-xs text-slate-500">Multiplier</span>
              </div>
              <div className={`text-xl font-black font-mono tabular-nums ${isFlying ? 'text-green-400' : 'text-slate-300'}`}>
                {isFlying ? formatMultiplier(mult) : formatMultiplier(Number(round.crash_multiplier))}
              </div>
              {isFlying && <div className="text-[10px] text-amber-400 font-medium mt-0.5">Crash at {Number(round.crash_multiplier).toFixed(2)}x</div>}
            </div>
            <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-slate-500" />
                <span className="text-xs text-slate-500">Elapsed</span>
              </div>
              <div className="text-xl font-black text-white tabular-nums">{isFlying ? `${elapsedSince(round.started_at)}s` : String.fromCharCode(8212)}</div>
              {round.crashed_at && <div className="text-[10px] text-slate-500">Crashed {new Date(round.crashed_at).toLocaleTimeString()}</div>}
            </div>
            <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-slate-500" />
                <span className="text-xs text-slate-500">Exposure</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-white tabular-nums">{isFlying ? betsCount : String.fromCharCode(8212)}</span>
                <span className="text-xs text-slate-500">bets</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{isFlying ? `KSh ${fmtKES(betsTotal)}` : String.fromCharCode(8212)}</div>
            </div>
          </div>
        )}

        {isFlying && (
          <div className="mt-3">
            <button onClick={() => setShowForceCrash(true)} className="px-4 py-2.5 bg-red-600/20 border border-red-500/40 rounded-xl text-red-400 font-semibold text-sm hover:bg-red-600/30 transition flex items-center gap-2">
              <Zap size={14} /> Force Crash Now
            </button>
            <span className="ml-3 text-[10px] text-slate-600">Crashes at current multiplier. All active bets lose. Audited.</span>
          </div>
        )}
      </section>

      {/* CRASH QUEUE */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Target size={12} /> Crash Queue
          <span className="ml-auto text-slate-600 font-normal normal-case text-[10px]">{pendingQueue.length} pending</span>
        </h2>

        <div className="bg-[#111122] border border-[#1e1e35] rounded-xl p-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="number" value={singleVal} onChange={e => setSingleVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSingle()}
              placeholder="1.00 – 80.00" min={MIN_CRASH} max={MAX_CRASH} step="0.01"
              className="flex-1 px-3 py-2 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-[#c8001c]"
            />
            <button onClick={addSingle} disabled={actionLock === 'add-single' || !singleVal.trim()}
              className="px-4 py-2 bg-[#c8001c] hover:bg-[#a50018] text-white font-semibold text-sm rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0">
              {actionLock === 'add-single' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </button>
          </div>
          <details className="group">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 transition">Batch add (one per line)</summary>
            <div className="mt-2 space-y-2">
              <textarea value={batchVal} onChange={e => setBatchVal(e.target.value)}
                placeholder="1.23...4.56...12.00" rows={4}
                className="w-full px-3 py-2 bg-[#0a0a14] border border-[#2a2a45] rounded-lg text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-[#c8001c] resize-none"
              />
              <button onClick={addBatch} disabled={actionLock === 'add-batch' || !batchVal.trim()}
                className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a45] hover:border-[#c8001c] text-white font-semibold text-sm rounded-lg transition disabled:opacity-50 flex items-center gap-1.5">
                {actionLock === 'add-batch' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add {batchVal.trim() ? batchVal.split(/[\n,]+/).filter(l => l.trim()).length : 0} items
              </button>
            </div>
          </details>
        </div>

        <div className="mt-3 bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#111122]">
                <tr className="text-slate-500 text-[11px] border-b border-[#1e1e35]">
                  <th className="text-left px-4 py-2.5 font-medium w-16">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">Multiplier</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Added</th>
                  <th className="text-right px-4 py-2.5 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-600 text-xs">Queue empty — crash points come from algorithm</td></tr>
                ) : queue.map(q => (
                  <tr key={q.id} className="border-b border-[#1e1e35]/50 hover:bg-[#1a1a2e]/30">
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{q.position}</td>
                    <td className="px-4 py-2.5 text-white font-mono font-bold">{Number(q.crash_point).toFixed(2)}x</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        q.status === 'pending' ? 'bg-blue-500/10 text-blue-400' :
                        q.status === 'used' ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400'
                      }`}>{q.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs hidden lg:table-cell">{new Date(q.created_at).toLocaleTimeString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => removeFromQueue(q.id, q.crash_point)}
                        disabled={actionLock === `remove-${q.id}` || q.status !== 'pending'}
                        className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                        title={q.status === 'pending' ? 'Remove' : 'Already used'}
                      >
                        {actionLock === `remove-${q.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pendingQueue.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[#1e1e35] flex items-center justify-between">
              <span className="text-[10px] text-slate-500">{pendingQueue.length} pending items in queue</span>
              <button onClick={() => setShowClearQueue(true)}
                className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/20 transition flex items-center gap-1">
                <Trash2 size={11} /> Clear All
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ALGORITHM SETTINGS */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Settings size={12} /> Algorithm Parameters
          <span className="text-slate-600 font-normal normal-case text-[10px] ml-auto">Changes take effect next round · Audited</span>
        </h2>
        <div className="bg-[#111122] border border-[#1e1e35] rounded-xl overflow-hidden">
          {gSettings.length === 0 ? (
            <div className="p-8 text-center text-slate-600 text-xs">No game settings found in system_settings</div>
          ) : (
            <div className="divide-y divide-[#1e1e35]/50">
              {gSettings.map(s => {
                const hasChanged = editVals[s.key] !== String(s.value);
                return (
                  <div key={s.key} className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-[#1a1a2e]/20">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white font-mono">{s.key.replace('game.', '')}</div>
                      {s.description && <div className="text-[10px] text-slate-500 mt-0.5">{s.description}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input type="text" value={editVals[s.key] ?? String(s.value)}
                        onChange={e => setEditVals(prev => ({ ...prev, [s.key]: e.target.value }))}
                        className={`w-20 px-2.5 py-1.5 bg-[#0a0a14] border rounded-lg text-sm text-right text-white font-mono focus:outline-none transition ${
                          hasChanged ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-[#2a2a45]'
                        }`}
                      />
                      {hasChanged && (
                        <>
                          <button onClick={() => saveSetting(s.key)} disabled={saving === s.key}
                            className="p-1.5 bg-green-500/10 border border-green-500/30 rounded text-green-400 hover:bg-green-500/20 transition disabled:opacity-50" title="Save">
                            {saving === s.key ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          </button>
                          <button onClick={() => setEditVals(prev => ({ ...prev, [s.key]: String(s.value) }))}
                            className="p-1.5 bg-slate-500/10 border border-slate-500/30 rounded text-slate-400 hover:bg-slate-500/20 transition" title="Reset">
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* CONFIRMATION MODALS */}
      {showForceCrash && (
        <ConfirmModal
          title="Force Crash"
          message={`Crash round at ${formatMultiplier(mult)}? All active bets will lose. This cannot be undone.`}
          confirmLabel="Force Crash"
          confirmColor="bg-red-600 hover:bg-red-700"
          loading={actionLock === 'force-crash'}
          onConfirm={forceCrash}
          onCancel={() => setShowForceCrash(false)}
        />
      )}
      {showRecover && (
        <ConfirmModal
          title="Recover Zombie Rounds"
          message={`Mark ${zombieCount} stuck round(s) as crashed? These are rounds that never completed (browser closed mid-flight).`}
          confirmLabel="Recover All"
          confirmColor="bg-amber-600 hover:bg-amber-700"
          loading={actionLock === 'recover'}
          onConfirm={recoverZombies}
          onCancel={() => setShowRecover(false)}
        />
      )}
      {showClearQueue && (
        <ConfirmModal
          title="Clear Queue"
          message={`Remove all ${pendingQueue.length} pending crash point(s) from the queue? This cannot be undone.`}
          confirmLabel="Clear All"
          confirmColor="bg-red-600 hover:bg-red-700"
          loading={actionLock === 'clear-queue'}
          onConfirm={clearQueue}
          onCancel={() => setShowClearQueue(false)}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  title, message, confirmLabel, confirmColor, loading, onConfirm, onCancel
}: {
  title: string; message: string; confirmLabel: string;
  confirmColor: string; loading: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-[#111122] border border-[#2a2a45] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-bold text-lg">{title}</h3>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">{message}</p>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 bg-[#1a1a2e] border border-[#2a2a45] rounded-xl text-slate-400 font-semibold text-sm hover:text-white transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex-1 py-2.5 rounded-xl text-white font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5 ${confirmColor}`}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}