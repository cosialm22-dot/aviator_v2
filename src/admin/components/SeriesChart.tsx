import { useMemo, useState } from 'react';

// Apple dark chart chrome: hairline gridlines in separator grey, tertiary-label axis text.
const GRID = '#38383a';
const AXIS = '#86868b';

export interface Series { key: string; label: string; color: string; kind?: 'bar' | 'line' }

/**
 * Daily chart: grouped bars (and optional lines) over a shared axis, with a hover read-out.
 * Pure SVG in a viewBox, so it scales to any width without measuring.
 */
export default function SeriesChart({ rows, series, xKey, format, height = 220, testId }: {
  rows: Record<string, number | string>[]; series: Series[]; xKey: string; format: (n: number) => string; height?: number; testId?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, L = 8, R = 8, T = 12, B = 26;
  const bars = series.filter((s) => s.kind !== 'line');
  const lines = series.filter((s) => s.kind === 'line');

  const { min, max } = useMemo(() => {
    let lo = 0, hi = 0;
    for (const r of rows) for (const s of series) { const v = Number(r[s.key]) || 0; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi === lo) hi = lo + 1;
    return { min: lo, max: hi * 1.08 };
  }, [rows, series]);

  const n = Math.max(1, rows.length);
  const slot = (W - L - R) / n;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const zero = y(0);
  const bw = Math.max(2, Math.min(18, (slot * 0.7) / Math.max(1, bars.length)));
  const label = (i: number) => {
    const d = String(rows[i]?.[xKey] ?? '');
    const dt = new Date(d + 'T00:00:00');
    return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  };
  const every = Math.ceil(n / 8);

  return (
    <div className="relative" data-testid={testId}>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className={s.kind === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-full'} style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.label).join(', ') + ' by day'}
        onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={L} x2={W - R} y1={T + (H - T - B) * (1 - f)} y2={T + (H - T - B) * (1 - f)} stroke={GRID} strokeOpacity={0.6} />
        ))}
        <line x1={L} x2={W - R} y1={zero} y2={zero} stroke={GRID} />
        {rows.map((r, i) => {
          const x0 = L + slot * i + (slot - bw * bars.length) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill={hover === i ? 'rgba(255,255,255,0.05)' : 'transparent'} rx={4} />
              {bars.map((s, j) => {
                const v = Number(r[s.key]) || 0;
                const top = Math.min(y(v), zero), h = Math.max(1, Math.abs(zero - y(v)));
                return <rect key={s.key} x={x0 + j * bw} y={top} width={bw - 1} height={h} rx={2} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.45} />;
              })}
              {i % every === 0 && <text x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize="13" fill={AXIS}>{label(i)}</text>}
            </g>
          );
        })}
        {lines.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            points={rows.map((r, i) => `${L + slot * i + slot / 2},${y(Number(r[s.key]) || 0)}`).join(' ')} />
        ))}
      </svg>
      {hover != null && rows[hover] && (
        <div className="pointer-events-none absolute right-2 top-8 min-w-[180px] rounded-xl bg-raised/90 px-3 py-2.5 text-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] backdrop-blur-xl" data-testid={testId ? testId + '-tip' : undefined}>
          <div className="mb-1.5 text-[13px] font-semibold text-ink">{label(hover)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
              <span className="inline-flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="font-medium tabular-nums text-ink">{format(Number(rows[hover][s.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
