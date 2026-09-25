import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button, Card, Empty, Select, Switch, inputCls } from '../../ui/kit';
import { resolveField, serialize, type FieldDef, type SettingsTabId } from './registry';

// Renders the system_settings for one tab (general / game / finance) with a
// typed control per setting, grouped into labelled sections. Editing is local
// (draft) until Save; the actual persistence + validation + audit lives in the
// server RPC (admin_set_setting), invoked via the `onSave` callback passed in
// from SettingsPage. Only engine-consumed keys are registered, so every control
// shown here has a real effect.

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

  if (fields.length === 0) {
    return <div className="rounded-xl bg-surface"><Empty title="No settings in this section." /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(group => {
        const groupFields = fields.filter(x => x.field.group === group);
        return (
          <Card key={group} title={group} pad={false}>
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
          </Card>
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
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{field.label}</div>
        {field.help && <div className="mt-0.5 text-[12px] leading-snug text-faint">{field.help}</div>}
        <div className="mt-1 font-mono text-[12px] text-faint">{field.key}</div>
        {error && <div role="alert" className="mt-1 text-[13px] text-down">{error}</div>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <Control field={field} working={working} onChange={onChange} />
        {saved && !dirty && <Check size={16} className="text-up" aria-label="Saved" />}
        {dirty && (
          <>
            <Button size="sm" variant="primary" onClick={onSave} loading={saving}>Save</Button>
            <Button size="sm" onClick={onReset} disabled={saving}>Reset</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Control({ field, working, onChange }: { field: FieldDef; working: string | boolean; onChange: (v: string | boolean) => void }) {
  if (field.type === 'toggle') {
    return <Switch checked={Boolean(working)} onChange={onChange} label={field.label} />;
  }
  if (field.type === 'select') {
    return <Select value={String(working)} onChange={onChange} options={field.options ?? []} label={field.label} />;
  }
  // number / text
  const prefix = field.unitPos === 'prefix' ? field.unit : undefined;
  const suffix = field.unitPos === 'suffix' ? field.unit : undefined;
  return (
    <div className="relative w-32">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{prefix}</span>}
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={String(working)}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={e => onChange(e.target.value)}
        aria-label={field.label}
        className={inputCls + ' text-right tabular-nums' + (prefix ? ' pl-11' : '') + (suffix ? ' pr-9' : '')}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{suffix}</span>}
    </div>
  );
}
