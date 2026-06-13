import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { resolveField, serialize, DISTRIBUTION_KEYS, type FieldDef, type SettingsTabId } from './registry';

// Renders the system_settings for one tab (general / game / finance) with a
// typed control per setting, grouped into labelled sections. Editing is local
// (draft) until Save; the actual persistence + audit lives in SettingsPage and
// is passed in as `onSave`. The crash-distribution group shows a running total
// because those six percentages must sum to 100.

export interface SettingRecord {
  key: string;
  value: unknown;
  category: string;
  description: string | null;
  updated_at: string;
}

type Working = string | boolean;
type SaveResult = { ok: boolean; error?: string };

function persistedToWorking(type: FieldDef['type'], value: unknown): Working {
  return type === 'toggle' ? Boolean(value) : value == null ? '' : String(value);
}

function isDirty(type: FieldDef['type'], working: Working, persisted: unknown): boolean {
  if (type === 'toggle') return Boolean(working) !== Boolean(persisted);
  if (type === 'number') return Number(working) !== Number(persisted);
  return String(working) !== (persisted == null ? '' : String(persisted));
}

export default function SystemSettingsTab({
  tab, rows, onSave,
}: {
  tab: SettingsTabId;
  rows: SettingRecord[];
  onSave: (key: string, value: string | number | boolean) => Promise<SaveResult>;
}) {
  // Draft only holds keys the operator has actually edited; everything else
  // falls back to the persisted value, so reloads never clobber edits and a
  // successful save simply drops the draft entry.
  const [draft, setDraft] = useState<Record<string, Working>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const fields = rows
    .map(r => ({ row: r, field: resolveField(r.key, r.category) }))
    .filter(x => x.field.tab === tab);

  // Preserve registry group order (first appearance wins).
  const groups: string[] = [];
  for (const { field } of fields) if (!groups.includes(field.group)) groups.push(field.group);

  const workingOf = (f: FieldDef, row: SettingRecord): Working =>
    f.key in draft ? draft[f.key] : persistedToWorking(f.type, row.value);

  function setField(key: string, v: Working) {
    setDraft(d => ({ ...d, [key]: v }));
    setSaved(s => (s === key ? null : s));
    setRowErr(e => { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; });
  }
  function resetField(key: string) {
    setDraft(d => { const n = { ...d }; delete n[key]; return n; });
    setRowErr(e => { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; });
  }

  async function save(f: FieldDef, row: SettingRecord) {
    const working = workingOf(f, row);
    const value = serialize(f.type, working);
    setSaving(f.key);
    setRowErr(e => { const n = { ...e }; delete n[f.key]; return n; });
    const res = await onSave(f.key, value);
    setSaving(null);
    if (res.ok) {
      resetField(f.key);
      setSaved(f.key);
      setTimeout(() => setSaved(s => (s === f.key ? null : s)), 1800);
    } else {
      setRowErr(e => ({ ...e, [f.key]: res.error ?? 'Could not save.' }));
    }
  }

  // Crash-distribution running total (uses current working values).
  const distRows = fields.filter(x => x.field.distribution);
  const distTotal = distRows.reduce((sum, x) => sum + (Number(workingOf(x.field, x.row)) || 0), 0);
  const distComplete = distRows.length === DISTRIBUTION_KEYS.length;

  if (fields.length === 0) {
    return <div className="rounded-xl border border-line bg-surface p-10 text-center text-faint text-[13px]">No settings in this section.</div>;
  }

  return (
    <div className="space-y-6">
      {groups.map(group => {
        const groupFields = fields.filter(x => x.field.group === group);
        const isDist = group === 'Crash distribution';
        return (
          <section key={group} className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em]">{group}</h3>
              {isDist && distComplete && (
                <span className={'inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded border ' +
                  (distTotal === 100 ? 'bg-emerald-50 text-up border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                  {distTotal !== 100 && <AlertTriangle size={12} />}
                  Total {distTotal}%
                </span>
              )}
            </div>
            {isDist && distComplete && distTotal !== 100 && (
              <p className="px-5 pt-3 text-[12px] text-amber-700">
                Crash-distribution percentages should sum to exactly 100%. They currently total {distTotal}%.
              </p>
            )}
            <div className="divide-y divide-line">
              {groupFields.map(({ field, row }) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  working={workingOf(field, row)}
                  dirty={isDirty(field.type, workingOf(field, row), row.value)}
                  saving={saving === field.key}
                  saved={saved === field.key}
                  error={rowErr[field.key]}
                  onChange={v => setField(field.key, v)}
                  onSave={() => save(field, row)}
                  onReset={() => resetField(field.key)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SettingRow({
  field, working, dirty, saving, saved, error, onChange, onSave, onReset,
}: {
  field: FieldDef;
  working: string | boolean;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error?: string;
  onChange: (v: string | boolean) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="px-5 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink font-medium">{field.label}</div>
        {field.help && <div className="text-[12px] text-muted mt-0.5 leading-snug">{field.help}</div>}
        <div className="text-[10px] text-faint mt-1 font-mono">{field.key}</div>
        {error && <div role="alert" className="text-[12px] text-down mt-1">{error}</div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        <Control field={field} working={working} onChange={onChange} />
        {saved && !dirty && <Check size={16} className="text-up" aria-label="Saved" />}
        {dirty && (
          <>
            <button onClick={onSave} disabled={saving}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-brand text-white hover:bg-brand-dark transition-colors disabled:opacity-50">
              {saving && <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" />}Save
            </button>
            <button onClick={onReset} disabled={saving}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-line text-muted hover:text-ink transition-colors disabled:opacity-50">Reset</button>
          </>
        )}
      </div>
    </div>
  );
}

function Control({ field, working, onChange }: { field: FieldDef; working: string | boolean; onChange: (v: string | boolean) => void }) {
  if (field.type === 'toggle') {
    const on = Boolean(working);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={field.label}
        onClick={() => onChange(!on)}
        className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ' + (on ? 'bg-brand' : 'bg-slate-300')}
      >
        <span className={'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ' + (on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    );
  }
  if (field.type === 'select') {
    return (
      <select
        value={String(working)}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition"
      >
        {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  // number / text
  const prefix = field.unitPos === 'prefix' ? field.unit : undefined;
  const suffix = field.unitPos === 'suffix' ? field.unit : undefined;
  return (
    <div className="relative">
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">{prefix}</span>}
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={String(working)}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={e => onChange(e.target.value)}
        aria-label={field.label}
        className={'w-32 py-2 bg-surface border border-line rounded-lg text-sm text-right text-ink tabular-nums font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition ' +
          (prefix ? 'pl-10 pr-3 ' : 'pr-3 ') + (suffix ? 'pr-9 ' : '')}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">{suffix}</span>}
    </div>
  );
}
