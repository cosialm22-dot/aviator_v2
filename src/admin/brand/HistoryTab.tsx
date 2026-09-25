import { useCallback, useEffect, useState } from 'react';
import { Card, ConfirmButton, ErrorState, Notice, Skeleton } from '../ui/kit';
import { dateTime } from '../ui/format';
import { brandError, brandVersions, rollbackBrand, type Json, type Version } from './api';
import type { BrandDraft } from './useBrandDraft';

// Every save of this brand, newest first, with exactly what changed; restore any earlier version
// (it becomes a new version — history is never rewritten).
const show = (v: Json) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function HistoryTab({ draft }: { draft: BrandDraft }) {
  const doc = draft.doc!;
  const [rows, setRows] = useState<Version[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { setErr(null); try { setRows(await brandVersions(doc.site_id)); } catch (e) { setErr(brandError(e)); } }, [doc.site_id]);
  useEffect(() => { void load(); }, [load, doc.version]);
  const label = (path: string) => {
    const k = path.replace(/^config\./, '');
    return draft.defs.get(k)?.label ?? path.replace(/^identity\./, '').replace(/^theme_tokens\./, 'Theme · ').replace(/_/g, ' ');
  };
  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!rows) return <Card><Skeleton className="h-24 w-full" /></Card>;
  return (
    <div className="space-y-3">
      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {rows.map((v) => (
        <Card key={v.version} testId={`version-${v.version}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-raised px-2 py-0.5 text-[12px] font-semibold tabular-nums text-ink">v{v.version}</span>
            <span className="text-[13px] text-ink">{v.note ?? `${Object.keys(v.diff).length} change${Object.keys(v.diff).length === 1 ? '' : 's'}`}</span>
            <span className="text-[12px] text-faint">{dateTime(v.changed_at)}{v.changed_by ? ` · ${v.changed_by}` : ''}</span>
            <span className="flex-1" />
            {v.version === doc.version ? <span className="text-[12px] text-up">Current</span>
              : doc.can.platform && <ConfirmButton confirmLabel={`Restore v${v.version}`} variant="warn" testId={`restore-${v.version}`}
                  onConfirm={async () => { try { await rollbackBrand(doc.site_id, v.version); setMsg(`Restored version ${v.version}.`); await draft.reload(); } catch (e) { setMsg(brandError(e)); } }}>Restore</ConfirmButton>}
          </div>
          {Object.keys(v.diff).length > 0 && (
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[minmax(140px,220px)_1fr]">
              {Object.entries(v.diff).map(([path, [from, to]]) => (
                <div key={path} className="contents">
                  <dt className="truncate text-faint">{label(path)}</dt>
                  <dd className="min-w-0 break-words text-muted"><span className="line-through decoration-down/60">{show(from).slice(0, 120)}</span> → <span className="text-ink">{show(to).slice(0, 120)}</span></dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      ))}
    </div>
  );
}
