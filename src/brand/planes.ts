// ============================================================================
// Plane library — the aircraft players see (marketers stream a bird instead; see birds.ts).
//
// Every model is a side view drawn in a 200 × 100 box, nose to the right, as layered SVG path
// strings. The same strings feed three renderers, so the plane is identical everywhere:
//   * the game canvas (Path2D, cached once per model, shaded with cached gradients),
//   * the header mark / admin previews (<PlaneMark> SVG),
//   * the generated favicon (an SVG data URI).
// Layers are tinted from the brand: `body`, `accent` (wings/tail/stripes), `canopy` (windows) and a
// derived `shade` (struts, intakes, nozzles). A propeller or an engine flame animates on top.
// "classic" is the original red sprite (/plane.png); "custom" is an uploaded image.
// ============================================================================
import { darken, lighten, mix, type Hex } from './color';

export type PlaneModel =
  | 'classic' | 'jet' | 'prop' | 'biplane' | 'fighter' | 'stealth' | 'rocket'
  | 'cargo' | 'glider' | 'seaplane' | 'concorde' | 'custom';

export interface PlaneSpec {
  id: PlaneModel;
  label: string;
  body: string[];
  accent: string[];
  canopy: string[];
  shade: string[];
  /** Propeller hub (x, y) and blade length, in model units. */
  prop?: { x: number; y: number; r: number };
  /** Engine exhaust (x, y) and flame length, in model units. */
  flame?: { x: number; y: number; len: number; w: number };
}

/** Round windows along a fuselage, as one path. */
function windows(x0: number, x1: number, y: number, r: number, step: number): string {
  let d = '';
  for (let x = x0; x <= x1; x += step) d += `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z `;
  return d.trim();
}

export const PLANES: PlaneSpec[] = [
  {
    id: 'jet', label: 'Jet',
    body: ['M18 50 C18 44 26 40 40 40 L160 40 C176 40 190 46 196 50 C190 54 176 58 160 58 L40 58 C26 58 18 56 18 50 Z'],
    accent: ['M22 42 L10 14 L30 14 L54 40 Z', 'M20 50 L6 59 L27 59 L46 52 Z', 'M84 54 L58 82 L78 82 L122 56 Z', 'M40 51.5 L162 51.5 L160 54.5 L40 54.5 Z'],
    canopy: ['M172 44 C177 44 183 46 187 48.5 L172 48.5 Z', windows(62, 152, 45.5, 1.9, 9)],
    shade: ['M90 62 C90 58 95 57 101 57 L118 57 C121 57 123 59 123 61.5 C123 64 121 66 118 66 L101 66 C95 66 90 65 90 62 Z'],
    flame: { x: 90, y: 61.5, len: 22, w: 7 },
  },
  {
    id: 'prop', label: 'Propeller',
    body: ['M30 50 C30 45 40 41 56 41 L150 43 C165 44 176 46 180 50 C176 54 165 56 150 57 L56 59 C40 59 30 55 30 50 Z'],
    accent: ['M160 43.5 L180 46 C184 47 186 48.5 186 50 C186 51.5 184 53 180 54 L160 56.5 Z', 'M96 53 L76 72 L92 74 L126 55 Z', 'M34 44 L24 21 L41 21 L60 42 Z', 'M32 50 L17 57 L37 58 L54 52 Z'],
    canopy: ['M104 42 C110 33 125 31 135 36 L141 42.5 Z'],
    shade: ['M186 46 C192 47 195.5 49 195.5 50 C195.5 51 192 53 186 54 Z'],
    prop: { x: 195, y: 50, r: 18 },
  },
  {
    id: 'biplane', label: 'Biplane',
    body: ['M36 50 C36 46 44 43 58 43 L150 45 C162 46 170 47.5 172 50 C170 52.5 162 54 150 55 L58 57 C44 57 36 54 36 50 Z'],
    accent: ['M86 29 L150 29 C154 29 157 31 157 33.5 C157 36 154 37.5 150 37.5 L86 37.5 C82 37.5 79 35.5 79 33.25 C79 31 82 29 86 29 Z',
      'M84 58 L150 58 C154 58 157 60 157 62.5 C157 65 154 66.5 150 66.5 L84 66.5 C80 66.5 77 64.5 77 62.25 C77 60 80 58 84 58 Z',
      'M40 45 L29 23 L45 23 L63 44 Z', 'M38 50 L23 57 L41 58 L57 52 Z', 'M160 45 L172 46.5 C176 47.5 178 49 178 50 C178 51 176 52.5 172 53.5 L160 55 Z'],
    canopy: ['M117 44.5 C119 38 128 36.5 133 40 L135 44.5 Z'],
    shade: ['M100 37.5 L102 58 L104.8 58 L102.8 37.5 Z', 'M136 37.5 L138 58 L140.8 58 L138.8 37.5 Z', 'M178 47 C182 48 184 49 184 50 C184 51 182 52 178 53 Z'],
    prop: { x: 184, y: 50, r: 18 },
  },
  {
    id: 'fighter', label: 'Fighter',
    body: ['M20 48 L60 42 L150 42 C170 42 186 46 199 50 C186 53 170 56 150 56 L60 58 L20 54 Z'],
    accent: ['M78 55 L142 55 L92 81 L74 81 Z', 'M24 47 L13 15 L32 15 L62 43 Z', 'M22 52 L5 63 L27 63 L52 54 Z', 'M150 47.4 L194 49.3 L194 50.7 L150 51.2 Z'],
    canopy: ['M118 42.5 C127 31 147 31 158 42.5 Z'],
    shade: ['M102 47.5 L124 47.5 L124 54 L102 54 Z', 'M14 49 L22 47.5 L22 55 L14 53.5 Z'],
    flame: { x: 15, y: 51.3, len: 30, w: 8 },
  },
  {
    id: 'stealth', label: 'Stealth',
    body: ['M14 52 L50 40 L110 34 L197 50 L110 60 L50 61 Z'],
    accent: ['M28 46 L15 17 L35 21 L58 42 Z', 'M58 60 L150 55.5 L108 70 L48 68 Z'],
    canopy: ['M138 41 L167 45.5 L150 47.5 L130 44.5 Z'],
    shade: ['M14 50 L26 48 L26 56 L14 54 Z'],
    flame: { x: 14, y: 52, len: 18, w: 5 },
  },
  {
    id: 'rocket', label: 'Rocket',
    body: ['M30 40 L150 40 C150 40 150 60 150 60 L30 60 Z'],
    accent: ['M150 40 C172 40 188 45 199 50 C188 55 172 60 150 60 Z', 'M32 40 L14 20 L40 20 L64 40 Z', 'M32 60 L14 80 L40 80 L64 60 Z', 'M88 40 L99 40 L99 60 L88 60 Z'],
    canopy: ['M121 50 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 Z'],
    shade: ['M20 43 L30 41 L30 59 L20 57 Z'],
    flame: { x: 20, y: 50, len: 42, w: 13 },
  },
  {
    id: 'cargo', label: 'Cargo',
    body: ['M14 40 L56 34 L150 36 C170 37 184 42 191 50 C184 60 170 64 150 64 L70 64 C50 64 32 58 14 44 Z'],
    accent: ['M86 31 L152 31 C156 31 158 32.6 158 34.5 C158 36.4 156 38 152 38 L86 38 C82 38 80 36.4 80 34.5 C80 32.6 82 31 86 31 Z',
      'M18 41 L7 8 L28 8 L52 36 Z', 'M16 41 L1 47 L22 47 L42 43 Z', 'M40 51.5 L172 51.5 L169 55 L40 55 Z'],
    canopy: ['M165 41 C172 42 178 44.5 183 48 L165 48 Z', windows(70, 140, 44, 2.1, 14)],
    shade: ['M120 38 L152 38 C157 38 160 39.8 160 42 C160 44.2 157 46 152 46 L120 46 Z'],
    prop: { x: 161, y: 42, r: 14 },
  },
  {
    id: 'glider', label: 'Glider',
    body: ['M20 50 C20 47.5 30 46 50 46 L150 46.5 C168 47 182 48.5 193 50 C182 51.5 168 53 150 53.5 L50 54 C30 54 20 52.5 20 50 Z'],
    accent: ['M98 52 L36 78 L48 80 L120 53.5 Z', 'M26 48 L17 21 L30 21 L47 47 Z', 'M12 20 L42 20 L42 23.5 L12 23.5 Z'],
    canopy: ['M138 47 C145 39.5 160 39.5 169 47 Z'],
    shade: ['M100 47 L58 29 L67 28 L121 46 Z'],
  },
  {
    id: 'seaplane', label: 'Seaplane',
    body: ['M30 48 C30 43 40 40 56 40 L150 42 C164 43 174 45 178 48 C174 52 164 54 150 55 L56 57 C40 57 30 53 30 48 Z'],
    accent: ['M84 35 L148 35 C152 35 155 36.6 155 38.5 C155 40.4 152 42 148 42 L84 42 C80 42 77 40.4 77 38.5 C77 36.6 80 35 84 35 Z',
      'M60 72 L170 72 C178 72 184 74 186.5 76 C184 78 178 80 170 80 L60 80 C54 80 51.5 78 51.5 76 C51.5 74 54 72 60 72 Z',
      'M34 44 L24 21 L41 21 L59 42 Z', 'M32 48 L17 54 L37 55 L53 50 Z', 'M160 42.5 L178 45 C182 46 184 47 184 48 C184 49 182 50.5 178 51.5 L160 54 Z'],
    canopy: ['M111 40.5 C115 33.5 128 32.5 136 35.5 L141 41 Z'],
    shade: ['M90 55 L92 72 L94.8 72 L92.8 55 Z', 'M140 54 L142 72 L144.8 72 L142.8 54 Z'],
    prop: { x: 187, y: 48, r: 16 },
  },
  {
    id: 'concorde', label: 'Supersonic',
    body: ['M14 50 C14 47 24 45 40 45 L170 46 C182 46.5 192 48 199.5 50.5 C192 52 182 53 170 53.5 L40 55 C24 55 14 53 14 50 Z'],
    accent: ['M44 53 L142 53 L72 76 L48 76 Z', 'M18 47 L11 17 L26 17 L49 46 Z', 'M40 49.8 L168 49.8 L168 51.4 L40 51.4 Z'],
    canopy: ['M176 47 L187 48.8 L176 49.8 Z', windows(60, 160, 47.6, 1.4, 8)],
    shade: ['M58 62 L100 58 L100 65 L58 67 Z'],
    flame: { x: 58, y: 64.5, len: 26, w: 6 },
  },
];

export const PLANE_MAP: Record<string, PlaneSpec> = Object.fromEntries(PLANES.map((p) => [p.id, p]));

/** Every selectable model, in menu order (the server's enum uses the same ids). */
export const PLANE_MODELS: { id: PlaneModel; label: string }[] = [
  { id: 'classic', label: 'Classic' }, ...PLANES.map((p) => ({ id: p.id, label: p.label })), { id: 'custom', label: 'Uploaded image' },
];

export interface PlaneColors { body: Hex; accent: Hex; canopy: Hex }
export const DEFAULT_PLANE_COLORS: PlaneColors = { body: '#e51e3c', accent: '#b3122e', canopy: '#bfe6ff' };

// ── Canvas renderer ─────────────────────────────────────────────────────────────
interface Compiled { body: Path2D[]; accent: Path2D[]; canopy: Path2D[]; shade: Path2D[] }
const compiled = new Map<string, Compiled>();
function compile(spec: PlaneSpec): Compiled {
  let c = compiled.get(spec.id);
  if (!c) {
    const p = (a: string[]) => a.map((d) => new Path2D(d));
    c = { body: p(spec.body), accent: p(spec.accent), canopy: p(spec.canopy), shade: p(spec.shade) };
    compiled.set(spec.id, c);
  }
  return c;
}

interface Fills { body: CanvasGradient; accent: CanvasGradient; canopy: CanvasGradient; shade: string; line: string }
const fillCache = new WeakMap<CanvasRenderingContext2D, Map<string, Fills>>();
function fills(ctx: CanvasRenderingContext2D, c: PlaneColors): Fills {
  let m = fillCache.get(ctx);
  if (!m) { m = new Map(); fillCache.set(ctx, m); }
  const key = `${c.body}|${c.accent}|${c.canopy}`;
  let f = m.get(key);
  if (!f) {
    // Gradients live in model space (0..100 vertically), so one set serves every size and angle.
    const g = (top: Hex, bottom: Hex) => { const gr = ctx.createLinearGradient(0, 30, 0, 70); gr.addColorStop(0, top); gr.addColorStop(1, bottom); return gr; };
    f = {
      body: g(lighten(c.body, 0.22), darken(c.body, 0.22)),
      accent: g(lighten(c.accent, 0.12), darken(c.accent, 0.28)),
      canopy: g(lighten(c.canopy, 0.55), darken(c.canopy, 0.25)),
      shade: darken(mix(c.body, c.accent, 0.5), 0.5),
      line: darken(c.body, 0.55),
    };
    m.set(key, f);
  }
  return f;
}

/**
 * Draw a model centred on (0, 0) of the current transform, `width` px long, nose along +x.
 * `t` (ms) animates the propeller / flame; `power` 0..1 scales the exhaust (0 = parked).
 */
export function drawPlaneModel(ctx: CanvasRenderingContext2D, spec: PlaneSpec, colors: PlaneColors, width: number, t: number, power: number, lowPower = false) {
  const s = width / 200;
  const c = compile(spec);
  const f = fills(ctx, colors);
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-100, -50);

  if (spec.flame && power > 0.01) drawFlame(ctx, spec.flame, t, power, lowPower);

  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = f.line;
  // far-side parts first (shade), then body, accent, windows
  ctx.fillStyle = f.shade; for (const p of c.shade) ctx.fill(p);
  ctx.fillStyle = f.body; for (const p of c.body) { ctx.fill(p); ctx.stroke(p); }
  ctx.fillStyle = f.accent; for (const p of c.accent) { ctx.fill(p); ctx.stroke(p); }
  ctx.fillStyle = f.canopy; for (const p of c.canopy) ctx.fill(p);

  if (spec.prop) drawProp(ctx, spec.prop, t, power, f.shade);
  ctx.restore();
}

function drawProp(ctx: CanvasRenderingContext2D, p: { x: number; y: number; r: number }, t: number, power: number, hub: string) {
  const spin = 0.35 + power * 0.65;
  // Motion-blurred disc (a side view shows the prop as a thin ellipse) + one visible blade sweep.
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = `rgba(210, 220, 230, ${0.16 + 0.1 * spin})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 2.6, p.r, 0, 0, Math.PI * 2); ctx.fill();
  const a = Math.sin(t * 0.06 * spin);
  ctx.strokeStyle = 'rgba(40, 44, 52, 0.85)';
  ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -p.r * a); ctx.lineTo(0, p.r * a); ctx.stroke();
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawFlame(ctx: CanvasRenderingContext2D, fl: { x: number; y: number; len: number; w: number }, t: number, power: number, lowPower: boolean) {
  const flick = 0.82 + 0.18 * Math.sin(t * 0.045) * Math.sin(t * 0.017 + 1.3);
  const len = fl.len * power * flick;
  ctx.save();
  ctx.translate(fl.x, fl.y);
  const g = ctx.createLinearGradient(0, 0, -len, 0);
  g.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
  g.addColorStop(0.25, 'rgba(255, 196, 64, 0.85)');
  g.addColorStop(0.7, 'rgba(255, 90, 30, 0.45)');
  g.addColorStop(1, 'rgba(255, 60, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -fl.w / 2);
  ctx.quadraticCurveTo(-len * 0.55, -fl.w * 0.55, -len, 0);
  ctx.quadraticCurveTo(-len * 0.55, fl.w * 0.55, 0, fl.w / 2);
  ctx.closePath();
  if (!lowPower) { ctx.shadowColor = 'rgba(255, 140, 40, 0.6)'; ctx.shadowBlur = 8; }
  ctx.fill();
  ctx.restore();
}

// ── SVG (header mark, previews, favicon) ─────────────────────────────────────────
/** A standalone SVG string of a model (gradients baked from the colours). */
export function planeSvg(model: string, colors: PlaneColors, opts: { idSuffix?: string; size?: number } = {}): string {
  const spec = PLANE_MAP[model] ?? PLANE_MAP.jet;
  const id = (opts.idSuffix ?? model).replace(/[^a-zA-Z0-9_-]/g, '');
  const w = opts.size ?? 200, h = (w / 2);
  const grad = (n: string, top: Hex, bottom: Hex) =>
    `<linearGradient id="${n}-${id}" x1="0" y1="0.3" x2="0" y2="0.7"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const line = darken(colors.body, 0.55);
  const shade = darken(mix(colors.body, colors.accent, 0.5), 0.5);
  const paths = (arr: string[], fill: string, stroke = false) =>
    arr.map((d) => `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${line}" stroke-width="1.1" stroke-linejoin="round"` : ''}/>`).join('');
  const prop = spec.prop ? `<ellipse cx="${spec.prop.x}" cy="${spec.prop.y}" rx="2.6" ry="${spec.prop.r}" fill="rgba(210,220,230,0.35)"/><circle cx="${spec.prop.x}" cy="${spec.prop.y}" r="2.6" fill="${shade}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="${w}" height="${h}">` +
    `<defs>${grad('b', lighten(colors.body, 0.22), darken(colors.body, 0.22))}${grad('a', lighten(colors.accent, 0.12), darken(colors.accent, 0.28))}${grad('c', lighten(colors.canopy, 0.55), darken(colors.canopy, 0.25))}</defs>` +
    paths(spec.shade, shade) + paths(spec.body, `url(#b-${id})`, true) + paths(spec.accent, `url(#a-${id})`, true) + paths(spec.canopy, `url(#c-${id})`) + prop +
    `</svg>`;
}
