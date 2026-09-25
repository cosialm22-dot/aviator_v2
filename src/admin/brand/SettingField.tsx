import { useEffect, useState } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { Switch, inputCls } from '../ui/kit';
import type { Json, SettingDef } from './api';
import type { BrandDraft } from './useBrandDraft';

// One brand setting, rendered from its registry row (brand_setting_defs): the control follows the
// type, the bounds and help come from the server, an overridden value can be reset to the platform
// value / default, and a setting above the editor's tier is shown locked.

const fmt = (v: Json) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

export function SettingField({ def, draft, compact }: { def: SettingDef; draft: BrandDraft; compact?: boolean }) {
  const v = draft.value(def.key);
  const over = draft.overridden(def.key);
  const editable = draft.canEdit(def);
  const base = def.inherit ? def.inherited : def.default;
  const id = `bs-${def.key.replace(/\./g, '-')}`;
  const [raw, setRaw] = useState(fmt(over ? draft.config[def.key] : null));
  // Follow outside changes (reset, discard, a look applied) without fighting the typing: keep what
  // was typed while it still means the stored value ("1." for 1, "100,200" for [100, 200]).
  const stored = over ? draft.config[def.key] : null;
  useEffect(() => {
    setRaw((prev) => {
      const norm = def.kind === 'list' ? prev.split(/[,\s]+/).filter(Boolean).map(Number).join(', ')
        : (def.kind === 'int' || def.kind === 'number' || def.kind === 'money') ? (prev.trim() === '' ? '' : String(Number(prev)))
        : prev.trim() === '' ? '' : prev;
      return norm === fmt(stored) ? prev : fmt(stored);
    });
  }, [stored, def.kind]);

  const reset = over && editable ? (
    <button type="button" onClick={() => draft.set(def.key, null)} title={def.inherit ? 'Use the platform value' : 'Use the default'}
      aria-label={`Reset ${def.label}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-white/[0.06] hover:text-ink">
      <RotateCcw size={13} />
    </button>
  ) : null;
  const lock = !editable ? <span title={def.tier === 'owner' ? 'Only the platform owner can change this' : 'Only the platform can change this'} className="text-faint"><Lock size={12} /></span> : null;
  const hint = [def.help, def.inherit ? `Platform: ${fmt(def.inherited)}${def.kind === 'money' ? ' KES' : ''}` : null].filter(Boolean).join(' · ');

  if (def.kind === 'bool') {
    return (
      <div className="flex items-center gap-3 py-2" data-setting={def.key}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">{def.label}{lock}{over && <span className="h-1.5 w-1.5 rounded-full bg-brand" title="Changed for this brand" />}</div>
          {hint && !compact && <div className="text-[12px] text-faint">{hint}</div>}
        </div>
        {reset}
        <Switch checked={v === true} onChange={(on) => draft.set(def.key, on)} label={def.label} disabled={!editable} testId={id} />
      </div>
    );
  }

  let control: JSX.Element;
  const common = { id, disabled: !editable, 'aria-label': def.label, 'data-testid': id };
  if (def.kind === 'enum') {
    control = (
      <select {...common} value={String(v ?? '')} onChange={(e) => draft.set(def.key, e.target.value)} className={inputCls}>
        {(def.options ?? []).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
      </select>
    );
  } else if (def.kind === 'color') {
    const hex = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000';
    control = (
      <div className="flex items-center gap-2">
        <input type="color" value={hex} disabled={!editable} onChange={(e) => draft.set(def.key, e.target.value)} aria-label={`${def.label} colour`}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border-0 bg-raised p-1 disabled:cursor-not-allowed" />
        <input {...common} value={raw || (v == null ? '' : String(v))} placeholder={fmt(base) || 'none'} maxLength={7}
          onChange={(e) => { setRaw(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) draft.set(def.key, e.target.value.toLowerCase()); if (e.target.value === '') draft.set(def.key, null); }}
          className={`${inputCls} font-mono uppercase`} />
      </div>
    );
  } else if (def.kind === 'longtext') {
    control = (
      <div>
        <textarea {...common} value={raw} placeholder={fmt(base)} rows={8} maxLength={def.max_len ?? 40000}
          onChange={(e) => { setRaw(e.target.value); draft.set(def.key, e.target.value.trim() ? e.target.value : null); }}
          className={`${inputCls} h-auto py-2 font-mono text-[12px] leading-relaxed`} />
        <div className="mt-1 text-right text-[11px] tabular-nums text-faint">{raw.length.toLocaleString()} / {(def.max_len ?? 40000).toLocaleString()}</div>
      </div>
    );
  } else if (def.kind === 'int' || def.kind === 'number' || def.kind === 'money') {
    control = (
      <div className="relative">
        <input {...common} inputMode="decimal" value={raw} placeholder={fmt(base)}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, '');
            setRaw(t);
            const n = Number(t);
            draft.set(def.key, t === '' ? null : Number.isFinite(n) ? n : null);
          }}
          className={`${inputCls} tabular-nums ${def.kind === 'money' ? 'pr-12' : ''}`} />
        {def.kind === 'money' && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">KES</span>}
      </div>
    );
  } else if (def.kind === 'list') {
    control = (
      <input {...common} value={raw} placeholder={fmt(base) || 'e.g. 100, 200, 500'}
        onChange={(e) => {
          setRaw(e.target.value);
          const nums = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number);
          draft.set(def.key, e.target.value.trim() === '' ? null : nums.every((n) => Number.isFinite(n)) ? nums : (e.target.value as unknown as Json));
        }}
        className={`${inputCls} tabular-nums`} />
    );
  } else {
    control = (
      <input {...common} value={raw} placeholder={fmt(base)} maxLength={def.max_len ?? 200}
        type={def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : def.kind === 'phone' ? 'tel' : 'text'}
        onChange={(e) => { setRaw(e.target.value); draft.set(def.key, e.target.value.trim() ? e.target.value : null); }}
        className={inputCls} />
    );
  }

  return (
    <div className="py-1.5" data-setting={def.key}>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
        {def.label}{lock}{over && <span className="h-1.5 w-1.5 rounded-full bg-brand" title="Changed for this brand" />}
      </label>
      <div className="flex items-start gap-1.5"><div className="min-w-0 flex-1">{control}</div>{reset}</div>
      {hint && <p className="mt-1 text-[12px] text-faint">{hint}</p>}
    </div>
  );
}

/** Every setting of the given sections, in registry order, in a responsive grid. */
export function SettingsGrid({ draft, sections, keys, cols = 2 }: { draft: BrandDraft; sections?: string[]; keys?: string[]; cols?: 1 | 2 }) {
  const defs = (draft.schema?.settings ?? []).filter((s) => (sections ? sections.includes(s.section) : true) && (keys ? keys.includes(s.key) : true));
  const bools = defs.filter((d) => d.kind === 'bool');
  const rest = defs.filter((d) => d.kind !== 'bool');
  return (
    <div className="space-y-3">
      {rest.length > 0 && (
        <div className={`grid gap-x-5 gap-y-1 ${cols === 2 ? 'sm:grid-cols-2' : ''}`}>
          {rest.map((d) => <div key={d.key} className={d.kind === 'longtext' ? 'sm:col-span-2' : ''}><SettingField def={d} draft={draft} /></div>)}
        </div>
      )}
      {bools.length > 0 && <div className="divide-y divide-line/60">{bools.map((d) => <SettingField key={d.key} def={d} draft={draft} />)}</div>}
    </div>
  );
}
