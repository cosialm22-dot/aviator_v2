import { TabActions } from './components';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Promotion, PromotionInput, PromotionCategory, PromotionRewardKind } from '../../../types/marketing';
import { Badge, Button, Card, Empty, Field, Modal, Notice, Pills, Switch, TableWrap, Td, Th, inputCls } from '../../ui/kit';
import { fmtKsh, friendly, errMsg, statusBadge, fmtDateTime, num } from './shared';

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
const FILTER_ITEMS = FILTERS.map(t => ({ value: t.k, label: t.label }));

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
  // Stable closers so the kit Modal does not re-run its focus effect on every keystroke.
  const closeEditor = useCallback(() => { if (!saving) setEditing(null); }, [saving]);
  const closeDelete = useCallback(() => { if (!busyId) setDeleteRow(null); }, [busyId]);

  return (
    <div className="flex flex-col gap-6">
      <TabActions><Button variant="primary" onClick={openCreate}><Plus size={14} />New promotion</Button></TabActions>
      <Pills<Filter> items={FILTER_ITEMS} value={filter} onChange={setFilter} label="Promotion status" />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      <Card pad={false}>
        <TableWrap minWidth={0}>
          <thead>
            <tr>
              <Th>Promotion</Th>
              <Th className="hidden sm:table-cell">Category</Th>
              <Th>Reward</Th>
              <Th className="hidden lg:table-cell">Window</Th>
              <Th>Status</Th>
              <Th numeric>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-[13px] text-faint">Loading promotions&hellip;</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6}><Empty title={`No ${filter === 'all' ? '' : filter + ' '}promotions.`} /></td></tr>}
            {!loading && rows.map(p => (
              <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                <Td className="max-w-[280px]">
                  <div className="truncate font-medium text-ink" title={p.title}>{p.title}</div>
                  {p.description && <div className="truncate text-[12px] text-faint" title={p.description}>{p.description}</div>}
                </Td>
                <Td className="hidden sm:table-cell text-muted">{CATEGORY_LABEL[p.category] ?? p.category}</Td>
                <Td className="text-ink tabular-nums">{rewardLabel(p)}{num(p.min_deposit) > 0 && <span className="block text-[12px] text-faint">min {fmtKsh(p.min_deposit)}</span>}</Td>
                <Td className="hidden lg:table-cell whitespace-nowrap text-[12px] text-muted tabular-nums">
                  {p.starts_at || p.ends_at ? <>{fmtDateTime(p.starts_at)}<span className="text-faint"> → </span>{p.ends_at ? fmtDateTime(p.ends_at) : 'open'}</> : <span className="text-faint">Always</span>}
                </Td>
                <Td><Badge tone={statusBadge(p.runtime_status)}><span className="capitalize">{p.runtime_status}</span></Badge></Td>
                <Td className="whitespace-nowrap text-right">
                  <div className="inline-flex items-center gap-1">
                    <Button size="sm" onClick={() => toggleActive(p)} loading={busyId === p.id} className="mr-1">
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <button onClick={() => openEdit(p)} aria-label="Edit" title="Edit"
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"><Pencil size={14} /></button>
                    <button onClick={() => { setErr(null); setDeleteRow(p); }} aria-label="Delete" title="Delete"
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-down/10 hover:text-down"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Editor modal */}
      {editing && f && (
        <Modal title={editing.id ? 'Edit promotion' : 'New promotion'} onClose={closeEditor} width={560}
          footer={<>
            <Button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" form="promotion-editor" variant="primary" loading={saving}>{editing.id ? 'Save changes' : 'Create promotion'}</Button>
          </>}>
          <form id="promotion-editor" onSubmit={save} className="space-y-4">
            <Field label="Title">
              <input value={f.title} onChange={e => setForm({ title: e.target.value })} autoFocus maxLength={120} required className={inputCls} placeholder="e.g. 100% first-deposit match" />
            </Field>
            <Field label="Description">
              <textarea value={f.description} onChange={e => setForm({ description: e.target.value })} rows={2} className={areaCls} placeholder="Shown to players when this is surfaced (optional)" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <Field label="Display order">
                <input type="number" step="1" value={f.display_order} onChange={e => setForm({ display_order: Number(e.target.value) })} className={inputCls + ' text-right tabular-nums'} />
              </Field>
              <div className="flex h-9 items-center justify-between rounded-lg bg-raised px-3">
                <span className="text-[13px] text-ink">Active</span>
                <Switch checked={f.is_active} onChange={v => setForm({ is_active: v })} label="Active" />
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteRow && (
        <Modal title="Delete promotion" tone="danger" onClose={closeDelete}
          footer={<>
            <Button onClick={() => setDeleteRow(null)} disabled={busyId === deleteRow.id}>Cancel</Button>
            <Button variant="danger" onClick={() => doDelete(deleteRow)} loading={busyId === deleteRow.id}>Delete</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted">Permanently delete <span className="font-semibold text-ink">"{deleteRow.title}"</span>? This cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}

// Multi-line companion to the kit's inputCls (which fixes the height for single-line controls).
const areaCls = 'w-full resize-none rounded-lg bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50';
