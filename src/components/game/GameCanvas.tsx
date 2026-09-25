import { useEffect, useRef } from 'react';
import type { GameStatus } from '../../types';
import { multiplierColor, planeParkFactor } from './canvasMotion';
import { BIRD_MAP, DEFAULT_BIRD, drawBird, drawBirdPerched } from './birds';
import { useBrand } from '../../brand/useBrand';
import { canvasThemeFor, type CanvasTheme } from './canvasTheme';
import { drawPlaneModel, PLANE_MAP } from '../../brand/planes';

interface Props {
  status: GameStatus;
  /** 60fps multiplier sampler from the game engine (drives all canvas motion). */
  getMultiplier: () => number;
  /** Final multiplier of the crashed round. */
  crashPoint: number;
  /** Seconds remaining in the waiting phase (0 when unknown). */
  countdown: number;
  /** Streamer-mode bird species (marketers). Players see the brand's plane. */
  planeSkin?: string;
  /** Broadcast-safe render: no 'x' on the multiplier, no crash text. */
  streamer?: boolean;
}

// ── Flight-path mapping ──────────────────────────────────────────────────────
// Both relationships were fitted from the reference recording (plane positions
// measured frame-by-frame):
//   • x advances with flight time, which is ∝ ln(multiplier):
//       xNorm(m) = clamp(0.147 + 1.487·ln m, 0, X_MAX)
//   • the plane rides a convex arc whose height ∝ x^CURVE_EXP.
// The plane parks toward the top-right (X_MAX) for large multipliers, exactly as
// in the reference, so it always stays on-screen while the number keeps rising.
const CURVE_EXP = 1.78;
const X_A       = 1.487;   // ln(m) coefficient
const X_MAX     = 0.93;
const PLOT_TOP    = 0.07;   // curve ceiling (fraction of height, from top)
const PLOT_BOTTOM = 1.0;    // baseline = the x-axis, at the true bottom edge, so
                            // the flight line originates exactly at (0,0) (the
                            // bottom-left corner) rather than floating above it.

function xTipNorm(m: number): number {
  // Time-proportional (ln m) with NO intercept: x=0 at m=1 so the plane lifts off
  // smoothly from the origin instead of jumping to a fixed offset on the first frame.
  const x = X_A * Math.log(Math.max(1.0001, m));
  return Math.min(X_MAX, Math.max(0, x));
}
// Screen position (logical px) for a point at normalised x along the arc.
function curveX(W: number, xn: number) { return xn * W; }
function curveY(H: number, xn: number) {
  const h = Math.pow(xn, CURVE_EXP);                 // height fraction from baseline
  return PLOT_BOTTOM * H - (PLOT_BOTTOM - PLOT_TOP) * H * h;
}

// ── Plane sprite (the project's existing red-plane art) ──────────────────────
// Drawn via drawImage once decoded; until then a compact vector plane is used so
// the flight tip is never empty on a slow network.
// The active bird species for this site, set by the component each frame. The
// canvas reads it in the RAF loop so switching sites/skins swaps the bird live.
let activeBird = DEFAULT_BIRD;
let activeStreamer = false;
function birdSpec() { return BIRD_MAP[activeBird] ?? BIRD_MAP[DEFAULT_BIRD]; }

// ── Player-mode plane (the exact original Aviator red plane) ─────────────────
// Player mode renders the classic red plane from /plane.png; Streamer Mode (marketers)
// renders the animated bird instead. The plane is the fixed original art (not a per-site
// skin) so the standard player experience is unchanged.
const PLANE_ASPECT = 2.38;                 // source art width:height
const planeImg: HTMLImageElement | null = typeof Image !== 'undefined' ? new Image() : null;
let planeReady = false;
if (planeImg) {
  planeImg.onload = () => { planeReady = true; };
  planeImg.onerror = () => { planeReady = false; };
  planeImg.src = '/plane.png';
}
function drawVectorPlane(ctx: CanvasRenderingContext2D, pw: number) {
  const s = pw / 116;
  ctx.scale(s, s);
  ctx.fillStyle = '#e51e3c';
  ctx.beginPath();
  ctx.moveTo(-40, 6); ctx.quadraticCurveTo(0, -18, 44, -2);
  ctx.quadraticCurveTo(30, 12, -40, 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b3122e';
  ctx.beginPath();
  ctx.moveTo(-10, 4); ctx.lineTo(-26, -14); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
}
function drawPlaneSprite(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, W: number, power = 1) {
  const pw = planeWidth(W);
  const tilt = Math.max(-0.18, Math.min(0.05, angle * 0.35));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const p = theme.plane;
  const spec = PLANE_MAP[p.model];
  if (spec) {
    drawPlaneModel(ctx, spec, p.colors, pw, performance.now(), p.exhaust ? power : 0, lowPower);
  } else if (p.model === 'custom' && customImg && customReady) {
    const ph = pw / (customImg.naturalWidth / Math.max(1, customImg.naturalHeight) || 2);
    ctx.drawImage(customImg, -pw * 0.5, -ph * 0.55, pw, ph);
  } else if (planeImg && planeReady) {
    const ph = pw / PLANE_ASPECT;
    ctx.drawImage(planeImg, -pw * 0.5, -ph * 0.55, pw, ph);
  } else {
    drawVectorPlane(ctx, pw);
  }
  ctx.restore();
}

// Uploaded plane image (brand setting plane.image_url), loaded once per URL.
let customImg: HTMLImageElement | null = null;
let customReady = false;
let customSrc = '';
function loadCustom(url: string | null) {
  if (typeof Image === 'undefined' || !url || url === customSrc) return;
  customSrc = url; customReady = false;
  customImg = new Image();
  customImg.onload = () => { customReady = true; };
  customImg.onerror = () => { customReady = false; };
  customImg.src = url;
}

/** Plane length in px for this canvas width (the brand's size setting scales it). */
function planeWidth(W: number): number {
  return Math.max(64, Math.min(W * 0.11, 150)) * theme.plane.scale;
}

// ── Palette: the brand's game-screen colours (look.* settings; defaults = the reference look) ──
let theme: CanvasTheme = canvasThemeFor(null, null);

// Set once per session when frames are too expensive (see the adaptive quality check).
let lowPower = false;

export default function GameCanvas({ status, getMultiplier, crashPoint, countdown, planeSkin, streamer }: Props) {
  activeBird = (planeSkin || DEFAULT_BIRD).toLowerCase();
  activeStreamer = !!streamer;
  const brand = useBrand();
  theme = canvasThemeFor(brand.config, brand.theme_tokens as Record<string, unknown>, !!streamer);
  loadCustom(theme.plane.model === 'custom' ? theme.plane.image : null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const prevStatus = useRef<GameStatus>('idle');
  const escapeRef  = useRef(0);       // crash fly-off progress
  const glowRef    = useRef(0);       // eased flight-glow intensity 0..1
  const flashRef   = useRef(0);       // crash flash frames
  const dimRef     = useRef({ w: 0, h: 0, dpr: 1 });
  const cdRef      = useRef({ value: 0, at: 0, total: 0 }); // smooths the whole-second countdown
  const resizeRef  = useRef<() => void>(() => {});
  const costRef    = useRef({ ema: 0, n: 0 });                 // draw cost per frame (ms)

  const stateRef = useRef({ status, crashPoint, getMultiplier, countdown });
  stateRef.current = { status, crashPoint, getMultiplier, countdown };

  // DPR-aware sizing for crisp text + lines on retina displays.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 2);
      dimRef.current = { w: r.width, h: r.height, dpr };
      canvas.width  = Math.round(r.width  * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    resizeRef.current = resize;
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, []);

  // Reset transient animation state on round transitions.
  useEffect(() => {
    if (status === 'waiting' || (status === 'flying' && prevStatus.current !== 'flying')) {
      escapeRef.current = 0;
      flashRef.current  = 0;
    }
    if (status === 'crashed' && prevStatus.current !== 'crashed') {
      flashRef.current = 1;
    }
    prevStatus.current = status;
  }, [status]);

  // Single RAF scene loop. Reads live state via refs so it is created once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const frame = () => {
      const t0 = performance.now();
      // Adaptive quality: if drawing a frame costs too much (low-end phone), drop to 1x pixels and
      // no blurs for the rest of the session so the plane keeps moving smoothly.
      const c = costRef.current;
      if (!lowPower && c.n > 90 && c.ema > 9) { lowPower = true; resizeRef.current(); }
      const { status, getMultiplier, crashPoint, countdown } = stateRef.current;
      const { w: W, h: H } = dimRef.current;
      if (W === 0 || H === 0) { rafRef.current = requestAnimationFrame(frame); return; }
      const now  = performance.now();
      const mult = getMultiplier();
      const flying = status === 'flying';

      // Ease the cyan glow in during flight, out otherwise.
      const glowTarget = flying ? 1 : status === 'crashed' ? 0.55 : 0;
      glowRef.current += (glowTarget - glowRef.current) * 0.06;

      const colorMult = status === 'crashed' ? crashPoint : flying ? mult : 1.0;
      drawBackground(ctx, W, H, now, theme.glow ? glowRef.current : 0, multiplierColor(colorMult));

      const cd = cdRef.current;
      if (status !== 'waiting') { cd.total = 0; cd.value = 0; }
      else if (countdown !== cd.value) {
        if (countdown > cd.value || cd.total === 0) cd.total = countdown;
        cd.value = countdown; cd.at = now;
      }
      if (status === 'idle' || status === 'waiting') {
        const remain = countdown > 0 ? Math.max(countdown - 1, countdown - (now - cd.at) / 1000) : 0;
        drawRestingPlane(ctx, W, H, now);
        drawWaiting(ctx, W, H, now, status === 'waiting' && cd.total > 0 ? remain / cd.total : -1);
        track(t0);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // flying | crashed ────────────────────────────────────────────────────
      const isCrashed   = status === 'crashed';
      const displayMult = isCrashed ? crashPoint : (crashPoint > 0 ? Math.min(mult, crashPoint) : mult);
      const parkFactor  = isCrashed ? 0 : planeParkFactor(displayMult);

      // Right-wall safety: the plane sprite is centred on the trail tip, so the
      // tip's x must leave room for the plane's half-width (incl. its maximum
      // tilt) plus the worst-case rightward hover plus a clear gap — otherwise the
      // parked plane touches or is clipped by the right edge. Derive the largest
      // normalised tip x that keeps the WHOLE plane on-screen and clamp to it (in
      // addition to the artistic X_MAX cap inside xTipNorm). This guarantees
      // (tip.x + planeRightExt) <= W - wallGap for every W, multiplier and hover
      // phase, since tip.x <= xt*W + maxHoverRight.
      const planeW        = planeWidth(W);                            // must match drawPlane()
      const planeRightExt = planeW * 0.56;            // sprite half-width at max tilt
      const wallGap       = Math.max(10, W * 0.02);   // never-touch clearance
      const maxHoverRight = W * 0.04 * parkFactor;    // worst-case rightward wander
      const xMaxFit       = Math.max(0, 1 - (maxHoverRight + planeRightExt + wallGap) / W);
      const xt            = Math.min(xTipNorm(displayMult), xMaxFit);

      // Crash flash (brief red wash).
      if (isCrashed && flashRef.current > 0 && flashRef.current < 16) {
        ctx.save();
        ctx.globalAlpha = (1 - flashRef.current / 16) * 0.4;
        ctx.fillStyle = theme.crash;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        flashRef.current++;
      }

      // Parked-plane hover: once the multiplier is high the plane no longer
      // climbs (xt is clamped above); instead it wanders along a NW–SE diagonal
      // — as it drifts up its x decreases, as it drifts down its x increases (and
      // back), so it keeps fluctuating. parkFactor ramps the wander in from 2x to 10x.
      const ht   = now * 0.0016;
      const hOsc = Math.sin(ht) * 0.6 + Math.sin(ht * 0.61 + 1.3) * 0.4; // organic ~[-1,1]
      const hoverX = -hOsc * (W * 0.04)  * parkFactor;   // up ⇒ left, down ⇒ right
      const hoverY = -hOsc * (H * 0.085) * parkFactor;

      // Build the arc points origin → (hovering) tip. The hover offset is
      // distributed across the WHOLE trail via a full-range smoothstep weight
      // b(f): b(0)=0 pins the origin at the corner, b(1)=1 keeps the trail end on
      // the plane, and b'(0)=b'(1)=0 give a clean origin pin and a stable tip
      // tangent. So the entire curve bends with the plane's movement (no rigid
      // section), with the largest displacement mid-curve.
      const STEPS = 96;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const f  = i / STEPS;
        const xn = xt * f;
        const b  = f * f * (3 - 2 * f);                        // smoothstep over [0,1]
        pts.push({ x: curveX(W, xn) + hoverX * b, y: curveY(H, xn) + hoverY * b });
      }
      const origin = pts[0];
      const tip    = pts[pts.length - 1];
      const baseY  = PLOT_BOTTOM * H;

      // Filled area under the curve, bounded by a vertical edge at the tip.
      const fill = ctx.createLinearGradient(0, PLOT_TOP * H, 0, baseY);
      if (isCrashed) {
        fill.addColorStop(0, theme.fillDeadTop);
        fill.addColorStop(1, theme.fillDeadBottom);
      } else {
        fill.addColorStop(0, theme.fillTop);
        fill.addColorStop(1, theme.fillBottom);
      }
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(tip.x, baseY);
      ctx.lineTo(origin.x, baseY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // Curve edge with a soft red glow: a wide translucent stroke under the line (a Gaussian
      // shadowBlur on a 96-point path is one of the most expensive canvas operations on phones).
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      const lw = Math.max(2.5, W * 0.0038);
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      if (!isCrashed) {
        ctx.strokeStyle = theme.glow1; ctx.lineWidth = lw * 4; ctx.stroke();
        ctx.strokeStyle = theme.glow2; ctx.lineWidth = lw * 2.2; ctx.stroke();
      }
      ctx.strokeStyle = isCrashed ? theme.curveDead : theme.curve;
      ctx.lineWidth   = lw;
      ctx.stroke();
      ctx.restore();

      // Plane: rides the (possibly hovering) tip while flying; rockets off-tangent on crash.
      const prev    = pts[pts.length - 2] ?? pts[0];
      const tangent = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      if (!isCrashed) {
        const bob = Math.sin(now * 0.006) * H * 0.005;
        drawPlane(ctx, tip.x, tip.y + bob, tangent, W);
      } else {
        escapeRef.current += 0.05 + escapeRef.current * 0.18;
        const dist = escapeRef.current * W * 0.7;
        const ex = tip.x + Math.cos(tangent) * dist;
        const ey = tip.y + Math.sin(tangent) * dist;
        if (ex < W + 300 && ey > -300) drawPlane(ctx, ex, ey, tangent, W);
      }

      // Scene text.
      if (isCrashed) { if (!activeStreamer) drawCrashText(ctx, W, H, crashPoint); }
      else           drawMultiplier(ctx, W, H, mult, theme.multiplier);

      track(t0);
      rafRef.current = requestAnimationFrame(frame);
    };
    const track = (t0: number) => {
      const c = costRef.current;
      const dt = performance.now() - t0;
      c.ema = c.n === 0 ? dt : c.ema * 0.95 + dt * 0.05;
      c.n++;
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

// ── Background: the brand's sky (sunburst / soft rays / radar grid / stars / plain) + flight glow ──
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, glow: number, glowRgb: string) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  switch (theme.style) {
    case 'sunburst': drawSpokes(ctx, W, H, now, 72, theme.ray, theme.rayDark, 1); break;
    case 'rays': drawSpokes(ctx, W, H, now, 36, theme.ray, theme.bg, 0.55); break;
    case 'grid': drawGrid(ctx, W, H, now); break;
    case 'stars': drawStars(ctx, W, H, now); break;
    default: break;
  }

  // Radial glow behind the multiplier; colour shifts with the round (blue → purple → red).
  if (glow > 0.01) {
    const gx = W * 0.5, gy = H * 0.42, gr = W * 0.62;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0,    `rgba(${glowRgb}, ${0.50 * glow})`);
    g.addColorStop(0.45, `rgba(${glowRgb}, ${0.18 * glow})`);
    g.addColorStop(1,    `rgba(${glowRgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// Rotating fan of wedges from just outside the bottom-left corner. Only wedges that cross the
// canvas (~87° of the fan on every aspect ratio) are drawn. N must stay a multiple of 4.
function drawSpokes(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, N: number, light: string, dark: string, alpha: number) {
  const ox = -W * 0.02, oy = H * 1.02;
  const R  = Math.hypot(W, H) * 1.5;
  const rot = -now * 0.000045;           // clockwise about the bottom-left origin
  const TAU = Math.PI * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < N; i++) {
    const a0 = rot + i * (TAU / N);
    const a1 = rot + (i + 1) * (TAU / N);
    const m0 = ((a0 % TAU) + TAU) % TAU;
    if (m0 > Math.PI / 2 + 0.12 && m0 < TAU - 0.2) continue;
    if (i % 2 === 1 && dark === theme.bg) continue;   // soft rays: only the light wedges
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + R * Math.cos(a0), oy - R * Math.sin(a0));
    ctx.lineTo(ox + R * Math.cos(a1), oy - R * Math.sin(a1));
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? light : dark;
    ctx.fill();
  }
  ctx.restore();
}

// Radar grid: fine lines drifting slowly left, brighter towards the bottom-left origin.
function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  const step = Math.max(28, Math.min(W, H) / 9);
  const off = (now * 0.012) % step;
  ctx.save();
  ctx.strokeStyle = theme.ray;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -off; x < W; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); }
  for (let y = H - (off * 0.6) % step; y > 0; y -= step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
  ctx.stroke();
  const v = ctx.createRadialGradient(0, H, 0, 0, H, Math.hypot(W, H));
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, theme.bgFade);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Starfield: fixed pseudo-random stars twinkling and drifting slowly left.
const STARS = Array.from({ length: 90 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  return { x: r(1), y: r(2), s: 0.6 + r(3) * 1.4, p: r(4) * Math.PI * 2 };
});
function drawStars(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  ctx.save();
  ctx.fillStyle = theme.ray;
  for (const st of STARS) {
    const x = ((st.x * W - now * 0.004 * st.s) % W + W) % W;
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.0015 + st.p));
    ctx.fillRect(x, st.y * H, st.s, st.s);
  }
  ctx.restore();
}

// ── Resting plane (idle/waiting): parked at the origin corner, fully visible ──
function drawRestingPlane(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  const size = planeWidth(W);
  const halfLen = size * 0.5;
  const heading = -0.42;                       // nose/bird up-right along take-off tangent
  const bob = Math.sin(now * 0.0018) * H * 0.008;
  const x = Math.cos(heading) * halfLen;       // tail at the origin
  const y = PLOT_BOTTOM * H + Math.sin(heading) * halfLen + bob;
  if (activeStreamer) drawBirdPerched(ctx, birdSpec(), x, y, size, now);
  else                drawPlaneSprite(ctx, x, y, heading, W, 0.25);   // engine idling on the runway
}

// ── Waiting overlay: a bar that drains to take-off (no words). `frac` < 0 = not known yet
//    (connecting): an indeterminate sweep instead.
function drawWaiting(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, frac: number) {
  const bw = Math.min(W * 0.5, 280), bh = Math.max(6, Math.min(H * 0.022, 10));
  const bx = (W - bw) / 2, by = H * 0.44;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.clip();
  if (frac >= 0) {
    ctx.fillStyle = theme.wait;
    ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, frac)), bh);
  } else {
    const seg = bw * 0.32;
    const t = (now % 1400) / 1400;
    const sx = bx + (bw + seg) * t - seg;
    const grad = ctx.createLinearGradient(sx, 0, sx + seg, 0);
    grad.addColorStop(0, theme.waitClear);
    grad.addColorStop(0.5, theme.wait);
    grad.addColorStop(1, theme.waitClear);
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw, bh);
  }
  ctx.restore();
  ctx.restore();
}

// ── Multiplier (flying) ──────────────────────────────────────────────────────
function drawMultiplier(ctx: CanvasRenderingContext2D, W: number, H: number, m: number, color: string) {
  const fs = multFont(W, H);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${theme.weight} ${fs}px ${theme.font}`;
  ctx.shadowBlur = lowPower ? 0 : fs * 0.35;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.fillStyle = color;
  ctx.fillText(activeStreamer ? fmt(m) : `${fmt(m)}x`, W / 2, H * 0.40);
  ctx.restore();
}

// ── Crash text: the brand's fly-away line + the crash multiplier ─────────────
function drawCrashText(ctx: CanvasRenderingContext2D, W: number, H: number, m: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelFs = Math.max(16, Math.min(W * 0.045, 34));
  ctx.font = `700 ${labelFs}px ${theme.font}`;
  ctx.shadowBlur = lowPower ? 0 : 16; ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(theme.flewAway, W / 2, H * 0.34);

  const fs = multFont(W, H);
  ctx.font = `${theme.weight} ${fs}px ${theme.font}`;
  ctx.shadowBlur = lowPower ? 0 : fs * 0.4; ctx.shadowColor = theme.crashGlow;
  ctx.fillStyle = theme.crash;
  ctx.fillText(`${fmt(m)}x`, W / 2, H * 0.34 + labelFs * 0.7 + fs * 0.5);
  ctx.restore();
}

// ── Plane drawing (sprite with vector fallback) ──────────────────────────────
function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, W: number) {
  if (activeStreamer) {
    const size = planeWidth(W);                          // bird body length in px
    drawBird(ctx, birdSpec(), x, y, angle, size, performance.now());
  } else {
    drawPlaneSprite(ctx, x, y, angle, W);              // player mode: original red plane
  }
}


// ── helpers ──────────────────────────────────────────────────────────────────
/** Multiplier size: big on narrow phones (the number is the game), capped on wide screens. */
function multFont(W: number, H: number): number { return Math.min(Math.max(W * 0.11, Math.min(W * 0.19, 76)), H * 0.26, 132); }
function fmt(v: number): string { return v >= 100 ? v.toFixed(0) : v.toFixed(2); }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
