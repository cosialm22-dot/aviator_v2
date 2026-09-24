import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Ticket, Plus, X, AlertCircle, CheckCircle2, Power } from 'lucide-react';

// Admin promo-code management (site-scoped by the RPCs). Create codes granting
// a free bet or bonus cash, with total + per-user caps and optional expiry.
const HEAD = 'text-[11px] font-semibold text-muted uppercase tracking-[0.1em]';
const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';
const inputCls = 'w-full px-3 py-2.5 bg-canvas border border-line rounded-lg text-ink text-[13px] focus:outline-none focus:border-brand';
const labelCls = 'block text-[12px] font-medium text-muted mb-1.5';

interface PromoCode {
  id: string; code: string; reward_kind: string; reward_value: number; wagering_x: number;
  max_redemptions: number | null; per_user_limit: number; redeemed_count: number;
  expires_at: string | null; active: boolean; created_at: string;
}
const ERR: Record<string, string> = {
  FORBIDDEN: 'No permission.', INVALID_CODE: 'Code: A–Z, 0–9, _ or - (2–31 chars).',
  INVALID_REWARD_KIND: 'Pick a reward kind.', INVALID_REWARD_VALUE: 'Reward must be > 0.', NOT_FOUND: 'Not found.',
};
const friendly = (m?: string) => { if (!m) return 'Something went wrong.'; for (const k in ERR) if (m.includes(k)) return ERR[k]; return m; };

export default function PromoCodesPage() {
  const [rows, setRows] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_promo_codes');
    if (error) setFlash({ ok: false, msg: friendly(error.message) });
    else setRows((data ?? []) as PromoCode[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(code: string, active: boolean) {
    const { error } = await supabase.rpc('admin_set_promo_active', { p_code: code, p_active: !active });
    if (error) { setFlash({ ok: false, msg: friendly(error.message) }); return; }
    void load();
  }

  return (
    <div className="w-full max-w-[1100px]">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand/15 flex items-center justify-center">
            <Ticket size={20} className="text-brand" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink tracking-tight">Promo Codes</h1>
            <p className="text-[13px] text-muted">Redeemable codes granting a free bet or bonus.</p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-[13px] font-medium transition self-start">
          <Plus size={16} /> New code
        </button>
      </div>

      {flash && (
        <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] border ${flash.ok ? 'bg-up/10 border-up/30 text-up' : 'bg-down/10 border-down/30 text-down'}`}>
          {flash.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {flash.msg}
        </div>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className={HEAD}>Codes</span><span className="text-[12px] text-muted tabular-nums">{rows.length}</span>
        </div>
        {loading ? (
          <div className="p-10 flex justify-center"><div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted text-[13px]">No promo codes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left border-b border-line">
                {['Code', 'Reward', 'Redemptions', 'Per user', 'Expires', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 ${CAP} ${i === 2 || i === 3 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono font-medium text-ink">{r.code}</td>
                    <td className="px-4 py-3 text-muted">
                      {r.reward_kind === 'free_bet' ? 'Free bet' : 'Bonus'} · KSh {Number(r.reward_value).toLocaleString('en-KE')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {r.redeemed_count}{r.max_redemptions != null ? ` / ${r.max_redemptions}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{r.per_user_limit}</td>
                    <td className="px-4 py-3 text-muted">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${r.active ? 'bg-up/15 text-up' : 'bg-white/10 text-muted'}`}>{r.active ? 'active' : 'off'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => void toggle(r.code, r.active)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-brand text-[12px] transition">
                        <Power size={12} /> {r.active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showNew && <NewCodeModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); void load(); }} onError={(m) => setFlash({ ok: false, msg: m })} />}
    </div>
  );
}

function NewCodeModal({ onClose, onDone, onError }: { onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [rewardKind, setRewardKind] = useState('free_bet');
  const [rewardValue, setRewardValue] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [perUser, setPerUser] = useState('1');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_promo_code', {
      p_code: code.trim().toUpperCase(),
      p_reward_kind: rewardKind,
      p_reward_value: Number(rewardValue),
      p_max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
      p_per_user_limit: Number(perUser) || 1,
      p_expires_at: expires ? new Date(expires).toISOString() : null,
      p_active: true,
    });
    setBusy(false);
    if (error) { onError(friendly(error.message)); return; }
    onDone();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-ink">New promo code</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <form onSubmit={save} className="space-y-3.5">
          <div><label className={labelCls}>Code</label>
            <input className={inputCls + ' font-mono uppercase'} value={code} required placeholder="WELCOME50" onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Reward</label>
              <select className={inputCls} value={rewardKind} onChange={(e) => setRewardKind(e.target.value)}>
                <option value="free_bet">Free bet</option>
                <option value="bonus_cash">Bonus cash</option>
              </select></div>
            <div><label className={labelCls}>Value (KSh)</label>
              <input className={inputCls} type="number" min={1} value={rewardValue} required onChange={(e) => setRewardValue(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Max total <span className="text-faint">(blank = ∞)</span></label>
              <input className={inputCls} type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} /></div>
            <div><label className={labelCls}>Per user</label>
              <input className={inputCls} type="number" min={1} value={perUser} onChange={(e) => setPerUser(e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Expires <span className="text-faint">(optional)</span></label>
            <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
          {rewardKind === 'bonus_cash' && (
            <p className="text-[11px] text-faint">Bonus cash credits the reserved bonus balance (spendable once the bonus/wagering engine ships).</p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-muted hover:text-ink text-[13px] transition">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand/90 text-white font-medium text-[13px] transition disabled:opacity-50">{busy ? 'Saving…' : 'Create code'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
