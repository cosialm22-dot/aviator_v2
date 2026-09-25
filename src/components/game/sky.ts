// The brand's sky behind the flight (look.canvas_style): shared by the game canvas and the brand
// console preview so both draw exactly the same thing.
import type { CanvasTheme } from './canvasTheme';

export function drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, theme: CanvasTheme) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  switch (theme.style) {
    case 'sunburst': drawSpokes(ctx, W, H, now, 72, theme.ray, theme.rayDark, 1, false); break;
    case 'rays': drawSpokes(ctx, W, H, now, 36, theme.ray, theme.bg, 0.55, true); break;
    case 'grid': drawGrid(ctx, W, H, now, theme); break;
    case 'stars': drawStars(ctx, W, H, now, theme); break;
    default: break;
  }
}

// Rotating fan of wedges from just outside the bottom-left corner. Only wedges that cross the
// canvas (~87° of the fan on every aspect ratio) are drawn. N must stay a multiple of 4.
function drawSpokes(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, N: number, light: string, dark: string, alpha: number, softOnly: boolean) {
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
    if (i % 2 === 1 && softOnly) continue;   // soft rays: only the light wedges
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
function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, theme: CanvasTheme) {
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
function drawStars(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, theme: CanvasTheme) {
  ctx.save();
  ctx.fillStyle = theme.ray;
  for (const st of STARS) {
    const x = ((st.x * W - now * 0.004 * st.s) % W + W) % W;
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.0015 + st.p));
    ctx.fillRect(x, st.y * H, st.s, st.s);
  }
  ctx.restore();
}

