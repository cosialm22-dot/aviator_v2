import { useEffect, useRef } from 'react';
import type { GameStatus } from '../../types';

interface Props {
  status: GameStatus;
  /** Latest multiplier as React state (used only for the a11y live region upstream). */
  multiplier: number;
  /** 60fps multiplier sampler from the game engine (drives all canvas motion). */
  getMultiplier: () => number;
  /** Final multiplier of the crashed round. */
  crashPoint: number;
  /** Seconds remaining in the waiting phase (0 when unknown). */
  countdown: number;
}

// ── Flight-path mapping ──────────────────────────────────────────────────────
// Both relationships were fitted from the reference recording (plane positions
// measured frame-by-frame):
//   • x advances with flight time, which is ∝ ln(multiplier):
//       xNorm(m) = clamp(0.147 + 1.487·ln m, X_MIN, X_MAX)
//   • the plane rides a convex arc whose height ∝ x^CURVE_EXP.
// The plane parks toward the top-right (X_MAX) for large multipliers, exactly as
// in the reference, so it always stays on-screen while the number keeps rising.
const CURVE_EXP = 1.78;
const X_A       = 1.487;   // ln(m) coefficient
const X_B       = 0.147;   // ln(m=1) intercept
const X_MIN     = 0.04;
const X_MAX     = 0.93;
const PLOT_TOP    = 0.07;   // curve ceiling (fraction of height, from top)
const PLOT_BOTTOM = 0.95;   // baseline (fraction of height, from top)

function xTipNorm(m: number): number {
  const x = X_B + X_A * Math.log(Math.max(1.0001, m));
  return Math.min(X_MAX, Math.max(X_MIN, x));
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
const PLANE_IMG_SRC = '/plane.png';
const PLANE_ASPECT  = 2.38;          // source art width:height
const planeSprite: HTMLImageElement | null =
  typeof Image !== 'undefined' ? new Image() : null;
let planeSpriteReady = false;
if (planeSprite) {
  planeSprite.onload  = () => { planeSpriteReady = true; };
  planeSprite.onerror = () => { planeSpriteReady = false; };
  planeSprite.src = PLANE_IMG_SRC;
}

// ── Palette (sampled from the reference recording) ───────────────────────────
const C_BG          = '#07080c';
const C_SPOKE_LIGHT = '#181d26';
const C_SPOKE_DARK  = '#0a0b10';
const C_GLOW        = '48, 128, 170';   // cyan flight glow (rgb)
const C_TRAIL_LINE  = '#ff1840';
const C_TRAIL_DEAD  = '#7a2030';
const C_CRASH       = '#e8123c';

export default function GameCanvas({ status, getMultiplier, crashPoint, countdown }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const prevStatus = useRef<GameStatus>('idle');
  const escapeRef  = useRef(0);       // crash fly-off progress
  const glowRef    = useRef(0);       // eased flight-glow intensity 0..1
  const flashRef   = useRef(0);       // crash flash frames
  const dimRef     = useRef({ w: 0, h: 0, dpr: 1 });

  const stateRef = useRef({ status, crashPoint, getMultiplier, countdown });
  stateRef.current = { status, crashPoint, getMultiplier, countdown };

  // DPR-aware sizing for crisp text + lines on retina displays.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dimRef.current = { w: r.width, h: r.height, dpr };
      canvas.width  = Math.round(r.width  * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
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
      const { status, getMultiplier, crashPoint, countdown } = stateRef.current;
      const { w: W, h: H } = dimRef.current;
      if (W === 0 || H === 0) { rafRef.current = requestAnimationFrame(frame); return; }
      const now  = performance.now();
      const mult = getMultiplier();
      const flying = status === 'flying';

      // Ease the cyan glow in during flight, out otherwise.
      const glowTarget = flying ? 1 : status === 'crashed' ? 0.55 : 0;
      glowRef.current += (glowTarget - glowRef.current) * 0.06;

      drawBackground(ctx, W, H, now, glowRef.current);

      if (status === 'idle' || status === 'waiting') {
        drawRestingPlane(ctx, W, H, now);
        drawWaiting(ctx, W, H, now, countdown, status);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // flying | crashed ────────────────────────────────────────────────────
      const isCrashed   = status === 'crashed';
      const displayMult = isCrashed ? crashPoint : mult;
      const xt = xTipNorm(displayMult);

      // Crash flash (brief red wash).
      if (isCrashed && flashRef.current > 0 && flashRef.current < 16) {
        ctx.save();
        ctx.globalAlpha = (1 - flashRef.current / 16) * 0.4;
        ctx.fillStyle = C_CRASH;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        flashRef.current++;
      }

      // Build the arc points origin → tip.
      const STEPS = 96;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const xn = xt * (i / STEPS);
        pts.push({ x: curveX(W, xn), y: curveY(H, xn) });
      }
      const origin = pts[0];
      const tip    = pts[pts.length - 1];
      const baseY  = PLOT_BOTTOM * H;

      // Filled area under the curve, bounded by a vertical edge at the tip.
      const fill = ctx.createLinearGradient(0, PLOT_TOP * H, 0, baseY);
      if (isCrashed) {
        fill.addColorStop(0, 'rgba(120, 16, 34, 0.38)');
        fill.addColorStop(1, 'rgba(60, 6, 16, 0.20)');
      } else {
        fill.addColorStop(0, 'rgba(232, 22, 64, 0.55)');
        fill.addColorStop(1, 'rgba(150, 6, 30, 0.22)');
      }
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(tip.x, baseY);
      ctx.lineTo(origin.x, baseY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // Curve edge with a soft red glow.
      ctx.save();
      ctx.shadowBlur  = isCrashed ? 4 : 14;
      ctx.shadowColor = isCrashed ? '#5a1020' : '#ff1840';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = isCrashed ? C_TRAIL_DEAD : C_TRAIL_LINE;
      ctx.lineWidth   = Math.max(2.5, W * 0.0038);
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();

      // Plane: rides the tip while flying; rockets off-tangent on crash.
      const xnPrev = Math.max(0, xt - 0.02);
      const prev   = { x: curveX(W, xnPrev), y: curveY(H, xnPrev) };
      const tangent = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      if (!isCrashed) {
        const bob = Math.sin(now * 0.006) * H * 0.006;
        drawPlane(ctx, tip.x, tip.y + bob, tangent, W);
      } else {
        escapeRef.current += 0.05 + escapeRef.current * 0.18;
        const dist = escapeRef.current * W * 0.7;
        const ex = tip.x + Math.cos(tangent) * dist;
        const ey = tip.y + Math.sin(tangent) * dist;
        if (ex < W + 300 && ey > -300) drawPlane(ctx, ex, ey, tangent, W);
      }

      // Scene text.
      if (isCrashed) drawCrashText(ctx, W, H, crashPoint);
      else           drawMultiplier(ctx, W, H, mult, '#ffffff');

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

// ── Background: dark sky + rotating spoke sunburst + cyan flight glow ─────────
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, glow: number) {
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, W, H);

  // Spokes radiate from just outside the bottom-left corner and rotate slowly.
  const ox = -W * 0.02, oy = H * 1.02;
  const R  = Math.hypot(W, H) * 1.5;
  // Sunburst is a full rotating fan; only the wedges whose rays cross the canvas
  // are visible (the origin sits just off the bottom-left corner, so the on-screen
  // angular span is ~87° on every aspect ratio — measured portrait→ultrawide).
  // Visible spokes ≈ N × 87°/360° ≈ N/4. N = 72 → 18 spokes on screen at any time
  // (9 light + 9 dark). N must stay a multiple of 4 to keep the two shades balanced.
  const N  = 72;                       // 72 wedges → 18 visible (9 per colour)
  const rot = now * 0.000018;          // ≈0.06°/frame — subtle, matches reference
  ctx.save();
  for (let i = 0; i < N; i++) {
    const a0 = rot + (i)     * (Math.PI * 2 / N);
    const a1 = rot + (i + 1) * (Math.PI * 2 / N);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + R * Math.cos(a0), oy - R * Math.sin(a0));
    ctx.lineTo(ox + R * Math.cos(a1), oy - R * Math.sin(a1));
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? C_SPOKE_LIGHT : C_SPOKE_DARK;
    ctx.fill();
  }
  ctx.restore();

  // Cyan radial glow behind the multiplier (fades with flight intensity).
  if (glow > 0.01) {
    const gx = W * 0.5, gy = H * 0.42, gr = W * 0.5;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0,    `rgba(${C_GLOW}, ${0.42 * glow})`);
    g.addColorStop(0.45, `rgba(${C_GLOW}, ${0.16 * glow})`);
    g.addColorStop(1,    `rgba(${C_GLOW}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── Resting plane (idle/waiting): parked at the origin with a gentle bob ──────
function drawRestingPlane(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  const x = curveX(W, X_MIN + 0.01);
  const y = PLOT_BOTTOM * H + Math.sin(now * 0.0018) * H * 0.01;
  drawPlane(ctx, x, y, -0.05, W);
}

// ── Waiting overlay: "WAITING FOR NEXT ROUND" + animated loader bar ───────────
function drawWaiting(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, countdown: number, status: GameStatus) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.min(W * 0.028, 22);
  ctx.font = `700 ${fs}px Inter, Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(0,0,0,0.6)';
  const label = status === 'idle' ? 'CONNECTING…' : 'WAITING FOR NEXT ROUND';
  ctx.fillText(label, W / 2, H * 0.42);
  ctx.shadowBlur = 0;

  // Loader bar: indeterminate sweep, tinted red. Shows the countdown when known.
  const bw = Math.min(W * 0.42, 320), bh = Math.max(4, H * 0.012);
  const bx = (W - bw) / 2, by = H * 0.42 + fs * 1.4;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
  const seg = bw * 0.32;
  const t = (now % 1400) / 1400;
  const sx = bx + (bw + seg) * t - seg;
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.clip();
  const grad = ctx.createLinearGradient(sx, 0, sx + seg, 0);
  grad.addColorStop(0, 'rgba(232,18,60,0)');
  grad.addColorStop(0.5, 'rgba(232,18,60,1)');
  grad.addColorStop(1, 'rgba(232,18,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  if (countdown > 0) {
    ctx.font = `600 ${Math.min(W * 0.02, 14)}px Inter, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`Starting in ${countdown}s`, W / 2, by + bh + fs * 1.1);
  }
  ctx.restore();
}

// ── Multiplier (flying) ──────────────────────────────────────────────────────
function drawMultiplier(ctx: CanvasRenderingContext2D, W: number, H: number, m: number, color: string) {
  const fs = Math.min(W * 0.11, H * 0.26, 132);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${fs}px Inter, "Arial Black", Arial, sans-serif`;
  ctx.shadowBlur = fs * 0.35;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.fillStyle = color;
  ctx.fillText(`${fmt(m)}x`, W / 2, H * 0.40);
  ctx.restore();
}

// ── Crash text: "FLEW AWAY!" + red multiplier ────────────────────────────────
function drawCrashText(ctx: CanvasRenderingContext2D, W: number, H: number, m: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelFs = Math.min(W * 0.045, 34);
  ctx.font = `700 ${labelFs}px Inter, Arial, sans-serif`;
  ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('FLEW AWAY!', W / 2, H * 0.34);

  const fs = Math.min(W * 0.11, H * 0.26, 132);
  ctx.font = `800 ${fs}px Inter, "Arial Black", Arial, sans-serif`;
  ctx.shadowBlur = fs * 0.4; ctx.shadowColor = 'rgba(232,18,60,0.55)';
  ctx.fillStyle = C_CRASH;
  ctx.fillText(`${fmt(m)}x`, W / 2, H * 0.34 + fs * 0.62);
  ctx.restore();
}

// ── Plane drawing (sprite with vector fallback) ──────────────────────────────
function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, W: number) {
  const pw = Math.max(64, Math.min(W * 0.11, 150));
  const ph = pw / PLANE_ASPECT;
  // The reference plane stays nearly level; damp the tangent so it only tilts slightly.
  const tilt = Math.max(-0.18, Math.min(0.05, angle * 0.35));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  if (planeSprite && planeSpriteReady) {
    ctx.drawImage(planeSprite, -pw * 0.5, -ph * 0.55, pw, ph);
  } else {
    drawVectorPlane(ctx, pw);
  }
  ctx.restore();
}

function drawVectorPlane(ctx: CanvasRenderingContext2D, pw: number) {
  const s = pw / 116;
  ctx.scale(s, s);
  ctx.fillStyle = '#e8123c';
  ctx.beginPath();
  ctx.moveTo(-40, 6); ctx.quadraticCurveTo(0, -18, 44, -2);
  ctx.quadraticCurveTo(30, 12, -40, 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b50d2f';
  ctx.beginPath();
  ctx.moveTo(-10, 4); ctx.lineTo(-26, -14); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
}

// ── helpers ──────────────────────────────────────────────────────────────────
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
