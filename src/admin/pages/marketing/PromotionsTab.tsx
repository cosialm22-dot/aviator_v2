import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Promotion, PromotionInput, PromotionCategory, PromotionRewardKind } from '../../../types/marketing';
import { fmtKsh, friendly, errMsg, statusBadge, fmtDateTime, num } from './shared';
import { Spin } from './components';

// Promotions tab - admin CRUD for the promotional-offer catalogue. Offers are
// stored and managed here; surfacing them to players is a later, separate change
// (no public page yet, by product decision). All writes are server-enforced.
//   list   -> admin_list_promotions(filter)        [_is_admin]
//   upsert -> admin_upsert_promotion(id|null, data) [_is_admin]
//   toggle -> admin_set_promotion_active(id, bool)  [_is_admin]
//   delete -> admin_delete_promotion(id)            [_is_admin]

type Filter = 'all' | 'live' | 'scheduled' | 'expired' | 'inactive';
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'live', label: 'Live' },
  { k: 'scheduled', label: 'Scheduled' },
  { k: 'expired', label: 'Expired' },
  { k: 'inactive', label: 'Inactive' },
];

const CATEGORIES: { k: PromotionCategory; label: string }[] = [
  { k: 'welcome', label: 'Welcome bonus' },
  { k: 'deposit_match', label: 'Deposit match' },
  { k: 'cashback', label: 'Cashback' },
  { k: 'free_bet', label: 'Free bet' },
  { k: 'tournament', label: 'Tournament' },
  { k: 'general', label: 'General' },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.k, c.label]));

const REWARD_KINDS: { k: PromotionRewardKind; label: string }[] = [
  { k: 'percentage', label: 'Percentage (%)' },
  { k: 'fixed', label: 'Fixed (KSh)' },
  { k: 'none', label: 'No monetary reward' },
];

const EMPTY: PromotionInput = {
  title: '', description: '', category: 'general', reward_kind: 'percentage',
  reward_value: 0, min_deposit: 0, max_reward: null, starts_at: null, ends_at: null,
  is_active: false, display_order: 0,
};

// timestamptz <-> <input type="datetime-local"> (which is local, no zone).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
function rewardLabel(p: Promotion): string {
  if (p.reward_kind === 'percentage') return `${num(p.reward_value)}%${p.max_reward != null ? ` up to ${fmtKsh(p.max_reward)}` : ''}`;
  if (p.reward_kind === 'fixed') return fmtKsh(p.reward_value);
  return '-';
}

export default function PromotionsTab() {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // editor modal: null = closed, {id:null} = create, {id, ...} = edit
  const [editing, setEditing] = useState<{ id: string | null; form: PromotionInput } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('admin_list_promotions', { p_filter: filter });
    if (error) { setErr(friendly(error.message)); setRows([]); }
    else setRows((data ?? []) as Promotion[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setErr(null); setEditing({ id: null, form: { ...EMPTY } }); }
  function openEdit(p: Promotion) {
    setErr(null);
    setEditing({
      id: p.id,
      form: {
        title: p.title, description: p.description, category: p.category, reward_kind: p.reward_kind,
        reward_value: num(p.reward_value), min_deposit: num(p.min_deposit),
        max_reward: p.max_reward != null ? num(p.max_reward) : null,
        starts_at: p.starts_at, ends_at: p.ends_at, is_active: p.is_active, display_order: p.display_order,
      },
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const f = editing.form;
    if (!f.title.trim()) { setErr('A title is required.'); return; }
    setSaving(true); setErr(null); setNotice(null);
    try {
      const payload = {
        title: f.title.trim(), description: f.description, category: f.category, reward_kind: f.reward_kind,
        reward_value: f.reward_kind === 'none' ? 0 : num(f.reward_value), min_deposit: num(f.min_deposit),
        max_reward: f.reward_kind === 'percentage' && f.max_reward != null ? num(f.max_reward) : null,
        starts_at: f.starts_at, ends_at: f.ends_at, is_active: f.is_active, display_order: num(f.display_order),
      };
      const { error } = await supabase.rpc('admin_upsert_promotion', { p_id: editing.id, p_data: payload });
      if (error) throw new Error(friendly(error.message));
      setNotice(editing.id ? 'Promotion updated.' : 'Promotion created.');
      setEditing(null);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not save promotion.')); } finally { setSaving(false); }
  }

  async function toggleActive(p: Promotion) {
    setBusyId(p.id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_set_promotion_active', { p_id: p.id, p_active: !p.is_active });
      if (error) throw new Error(friendly(error.message));
      setNotice(`"${p.title}" ${p.is_active ? 'deactivated' : 'activated'}.`);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not change status.')); } finally { setBusyId(null); }
  }

  async function doDelete(p: Promotion) {
    setBusyId(p.id); setErr(null); setNotice(null);
    try {
      const { error } = await supabase.rpc('admin_delete_promotion', { p_id: p.id });
      if (error) throw new Error(friendly(error.message));
      setNotice(`"${p.title}" deleted.`);
      setDeleteRow(null);
      await load();
    } catch (e2) { setErr(errMsg(e2, 'Could not delete promotion.')); } finally { setBusyId(null); }
  }

  const f = editing?.form;
  const setForm = (patch: Partial<PromotionInput>) => setEditing(prev => prev ? { ...prev, form: { ...prev.form, ...patch } } : prev);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex gap-1 bg-slate-100 border border-line rounded-lg p-1 flex-wrap">
          {FILTERS.map(t => (
            <button key={t.k} onClick={() => setFilter(t.k)} aria-current={filter === t.k ? 'page' : undefined}
              className={'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ' + (filter === t.k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {notice && <span role="status" className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-up text-[12px] max-w-[360px] truncate" title={notice}>{notice}</span>}
          {err && <span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[360px] truncate" title={err}>{err}</span>}
          <button onClick={openCreate} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors">
            <Plus size={15} />New promotion
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-medium text-muted text-[12px]">Promotion</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] hidden sm:table-cell">Category</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px]">Reward</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] hidden lg:table-cell">Window</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px]">Status</th>
                <th className="px-4 py-3 font-medium text-muted text-[12px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-faint text-sm">Loading promotions&hellip;</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-faint text-sm">No {filter === 'all' ? '' : filter + ' '}promotions.</td></tr>}
              {!loading && rows.map(p => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas/60 transition-colors">
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="text-ink font-medium truncate" title={p.title}>{p.title}</div>
                    {p.description && <div className="text-[12px] text-muted truncate" title={p.description}>{p.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted hidden sm:table-cell">{CATEGORY_LABEL[p.category] ?? p.category}</td>
                  <td className="px-4 py-3 text-ink tabular-nums">{rewardLabel(p)}{num(p.min_deposit) > 0 && <span className="block text-[11px] text-faint">min {fmtKsh(p.min_deposit)}</span>}</td>
                  <td className="px-4 py-3 text-muted text-[12px] hidden lg:table-cell whitespace-nowrap">
                    {p.starts_at || p.ends_at ? <>{fmtDateTime(p.starts_at)}<span className="text-faint"> → </span>{p.ends_at ? fmtDateTime(p.ends_at) : 'open'}</> : <span className="text-faint">Always</span>}
                  </td>
                  <td className="px-4 py-3"><span className={'inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ' + statusBadge(p.runtime_status)}>{p.runtime_status}</span></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => toggleActive(p)} disabled={busyId === p.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:border-brand/40 text-[12px] font-semibold transition-colors disabled:opacity-40">
                        {busyId === p.id && <Spin />}{p.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => openEdit(p)} aria-label="Edit" title="Edit"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => { setErr(null); setDeleteRow(p); }} aria-label="Delete" title="Delete"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-down hover:bg-rose-50 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor modal */}
      {editing && f && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => saving ? null : setEditing(null)}>
          <form onSubmit={save} onClick={e => e.stopPropagation()} className="bg-surface border border-line rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-ink font-semibold text-lg">{editing.id ? 'Edit promotion' : 'New promotion'}</h3>
            <div className="mt-4 space-y-4">
              <Field label="Title">
                <input value={f.title} onChange={e => setForm({ title: e.target.value })} autoFocus maxLength={120} required className={inputCls} placeholder="e.g. 100% first-deposit match" />
              </Field>
              <Field label="Description">
                <textarea value={f.description} onChange={e => setForm({ description: e.target.value })} rows={2} className={inputCls + ' resize-none'} placeholder="Shown to players when this is surfaced (optional)" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Category">
                  <select value={f.category} onChange={e => setForm({ category: e.target.value as PromotionCategory })} className={inputCls}>
                    {CATEGORIES.map(c => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Reward type">
                  <select value={f.reward_kind} onChange={e => setForm({ reward_kind: e.target.value as PromotionRewardKind })} className={inputCls}>
                    {REWARD_KINDS.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}
                  </select>
                </Field>
              </div>
              {f.reward_kind !== 'none' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label={f.reward_kind === 'percentage' ? 'Percentage' : 'Amount (KSh)'}>
                    <input type="number" min={0} max={f.reward_kind === 'percentage' ? 100 : undefined} step="0.01" value={f.reward_value}
                      onChange={e => setForm({ reward_value: Number(e.target.value) })} className={inputCls + ' text-right tabular-nums'} />
                  </Field>
                  <Field label="Min deposit (KSh)">
                    <input type="number" min={0} step="1" value={f.min_deposit} onChange={e => setForm({ min_deposit: Number(e.target.value) })} className={inputCls + ' text-right tabular-nums'} />
                  </Field>
                  {f.reward_kind === 'percentage' && (
                    <Field label="Max reward (KSh)">
                      <input type="number" min={0} step="1" value={f.max_reward ?? ''} onChange={e => setForm({ max_reward: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls + ' text-right tabular-nums'} placeholder="none" />
                    </Field>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Starts (optional)">
                  <input type="datetime-local" value={isoToLocalInput(f.starts_at)} onChange={e => setForm({ starts_at: localInputToIso(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="Ends (optional)">
                  <input type="datetime-local" value={isoToLocalInput(f.ends_at)} onChange={e => setForm({ ends_at: localInputToIso(e.target.value) })} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <Field label="Display order">
                  <input type="number" step="1" value={f.display_order} onChange={e => setForm({ display_order: Number(e.target.value) })} className={inputCls + ' text-right tabular-nums'} />
                </Field>
                <label className="flex items-center gap-2.5 mt-5 select-none cursor-pointer">
                  <input type="checkbox" checked={f.is_active} onChange={e => setForm({ is_active: e.target.checked })} className="h-4 w-4 rounded border-line text-brand focus:ring-brand/40" />
                  <span className="text-sm text-ink">Active</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setEditing(null)} disabled={saving} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark">
                {saving && <Spin />}{editing.id ? 'Save changes' : 'Create promotion'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirm */}
      {deleteRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={() => busyId ? null : setDeleteRow(null)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Delete promotion</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">Permanently delete <span className="font-semibold text-ink">"{deleteRow.title}"</span>? This cannot be undone.</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDeleteRow(null)} disabled={busyId === deleteRow.id} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => doDelete(deleteRow)} disabled={busyId === deleteRow.id} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 bg-down hover:brightness-95">
                {busyId === deleteRow.id && <Spin />}Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
