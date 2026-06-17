// ============================================================================
// charts.tsx - tiny, dependency-free SVG chart primitives for the admin panel.
// ----------------------------------------------------------------------------
// Why pure SVG (no recharts/chart.js): the panel uses a bespoke, token-driven
// design system (see tailwind.config.js). A heavyweight chart library would add
// bundle weight, a version-upgrade surface, and styling that fights our tokens.
// These primitives are small, fully typed, accessible (role/aria + <title>),
// responsive (viewBox-scaled), and theme-consistent. Colours are passed in as
// explicit hex/token values so callers stay the single source of styling truth.
//
// Components:
//   <DonutChart>      - part-to-whole composition with a center total + legend.
//   <TrendAreaChart>  - time-series area+line with hoverable points.
//   <CompareBars>     - horizontal labelled magnitude comparison.
// ============================================================================

export interface Segment {
  label: string;
  value: number;
  color: string;
}

// --- shared helpers ---------------------------------------------------------

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-KE');
}

// ============================================================================
// DonutChart
// ============================================================================
export function DonutChart({
  data,
  size = 160,
  thickness = 18,
  centerLabel,
  centerValue,
  valueFormatter = fmtCompact,
}: {
  data: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  valueFormatter?: (n: number) => string;
}) {
  const total = data.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let offset = 0;
  const arcs = data
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const dash = frac * c;
      const seg = { ...s, dash, gap: c - dash, dashoffset: -offset, frac };
      offset += dash;
      return seg;
    });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={(centerLabel ?? 'Composition') + ': ' + data.map((s) => `${s.label} ${valueFormatter(s.value)}`).join(', ')}
        className="shrink-0"
      >
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#26303c" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={a.dashoffset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cx})`}
            style={{ transition: 'stroke-dasharray .7s ease, stroke-dashoffset .7s ease' }}
          >
            <title>{`${a.label}: ${valueFormatter(a.value)} (${Math.round(a.frac * 100)}%)`}</title>
          </circle>
        ))}
        {(centerValue || centerLabel) && (
          <>
            <text x={cx} y={cx - 2} textAnchor="middle" className="fill-ink" style={{ fontSize: 19, fontWeight: 700 }}>
              {centerValue}
            </text>
            <text x={cx} y={cx + 16} textAnchor="middle" className="fill-muted" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {centerLabel}
            </text>
          </>
        )}
      </svg>

      <ul className="space-y-2 min-w-[120px]">
        {data.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.label} className="flex items-center gap-2.5 text-[12px]">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="ml-auto pl-3 text-ink font-medium tabular-nums">{valueFormatter(s.value)}</span>
              <span className="w-9 text-right text-faint tabular-nums">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// TrendAreaChart
// ============================================================================
export function TrendAreaChart({
  points,
  color = '#1f9bb8',
  height = 160,
  valueFormatter = fmtCompact,
}: {
  points: { x: string; y: number }[];
  color?: string;
  height?: number;
  valueFormatter?: (n: number) => string;
}) {
  const W = 600;
  const H = height;
  const padX = 8;
  const padTop = 14;
  const padBottom = 22;
  const n = points.length;

  if (n === 0) {
    return <div className="h-40 flex items-center justify-center text-faint text-[13px]">No data for this range</div>;
  }

  const maxY = Math.max(...points.map((p) => p.y), 1);
  const minY = Math.min(...points.map((p) => p.y), 0);
  const span = maxY - minY || 1;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const xAt = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padTop + innerH - ((v - minY) / span) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L ${xAt(n - 1).toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;
  const gradId = 'tg_' + color.replace(/[^a-z0-9]/gi, '');
  const zeroY = yAt(0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={'Trend: ' + points.map((p) => `${p.x} ${valueFormatter(p.y)}`).join(', ')}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* zero baseline (only when the range crosses zero) */}
      {minY < 0 && maxY > 0 && (
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#26303c" strokeWidth={1} strokeDasharray="3 3" />
      )}

      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

      {points.map((p, i) => (
        <g key={i}>
          <circle cx={xAt(i)} cy={yAt(p.y)} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
          <circle cx={xAt(i)} cy={yAt(p.y)} r={10} fill="transparent">
            <title>{`${p.x}: ${valueFormatter(p.y)}`}</title>
          </circle>
          {(i === 0 || i === n - 1 || n <= 8) && (
            <text x={xAt(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-faint" style={{ fontSize: 9 }}>
              {p.x}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ============================================================================
// CompareBars - horizontal labelled magnitude comparison
// ============================================================================
export function CompareBars({
  data,
  valueFormatter = fmtCompact,
}: {
  data: Segment[];
  valueFormatter?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  return (
    <div className="space-y-3.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-[12px] text-ink">{d.label}</span>
          <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden" role="img" aria-label={`${d.label}: ${valueFormatter(d.value)}`}>
            <div
              className="h-full rounded-full"
              style={{ width: Math.max((Math.abs(d.value) / max) * 100, 2) + '%', backgroundColor: d.color, transition: 'width .7s ease' }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-[12px] text-muted tabular-nums">{valueFormatter(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
