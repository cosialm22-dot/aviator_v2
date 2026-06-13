import { useEffect, useRef } from 'react';
import type { GameStatus } from '../../types';

interface Props {
  status: GameStatus;
  multiplier: number;
  getMultiplier: () => number;
  crashPoint: number;
}

const PAD_X       = 72;
const PAD_Y       = 60;
const VIEWPORT_K  = 1.5;
const MIN_VIEWPORT = 2.0;
const PLANE_SCALE = 2.0;

// ── Animated background objects ────────────────────────────────────────────

interface Star { x: number; y: number; r: number; speed: number; alpha: number; twinkleOffset: number }
interface Cloud { x: number; y: number; w: number; h: number; speed: number; alpha: number }

function makeStar(W: number, H: number): Star {
  return {
    x: Math.random() * W,
    y: Math.random() * H * 0.75,
    r: 0.5 + Math.random() * 1.8,
    speed: 0.12 + Math.random() * 0.25,
    alpha: 0.4 + Math.random() * 0.6,
    twinkleOffset: Math.random() * Math.PI * 2,
  };
}

function makeCloud(W: number, H: number): Cloud {
  return {
    x: W + Math.random() * 200,
    y: H * 0.05 + Math.random() * H * 0.55,
    w: 60 + Math.random() * 120,
    h: 18 + Math.random() * 30,
    speed: 0.18 + Math.random() * 0.35,
    alpha: 0.04 + Math.random() * 0.10,
  };
}

function vMax(m: number): number {
  return Math.max(m * VIEWPORT_K, MIN_VIEWPORT);
}

function getPos(W: number, H: number, m: number, vm: number) {
  const t = Math.min(1, Math.log(Math.max(1.0001, m)) / Math.log(vm));
  return {
    x: PAD_X + (W - PAD_X) * 0.92 * t,
    y: (H - PAD_Y) - (H - PAD_Y) * 0.88 * Math.pow(t, 1.4),
  };
}

export default function GameCanvas({ status, getMultiplier, crashPoint }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const prevStatus = useRef<GameStatus>('idle');
  const escapeRef  = useRef(0);
  const starsRef   = useRef<Star[]>([]);
  const cloudsRef  = useRef<Cloud[]>([]);
  const crashFlashRef = useRef(0); // frames since crash for flash effect

  const stateRef = useRef({ status, crashPoint, getMultiplier });
  stateRef.current = { status, crashPoint, getMultiplier };

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const W = r.width, H = r.height;
      canvas.width  = W;
      canvas.height = H;
      // Re-seed stars & clouds on resize
      starsRef.current  = Array.from({ length: 80 }, () => makeStar(W, H));
      cloudsRef.current = Array.from({ length: 7  }, () => makeCloud(W, H));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, []);

  // Reset escape / flash on round change
  useEffect(() => {
    if (status === 'waiting' || (status === 'flying' && prevStatus.current !== 'flying')) {
      escapeRef.current  = 0;
      crashFlashRef.current = 0;
    }
    if (status === 'crashed' && prevStatus.current !== 'crashed') {
      crashFlashRef.current = 1; // start flash
    }
    prevStatus.current = status;
  }, [status]);

  // Main RAF draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const frame = () => {
      const { status, getMultiplier, crashPoint } = stateRef.current;
      const multiplier = getMultiplier();
      const W = canvas.width;
      const H = canvas.height;
      const now = Date.now();
      const vm  = vMax(multiplier);

      // ── Background ────────────────────────────────────────────────────
      drawBackground(ctx, W, H);

      // Animate speed based on multiplier — higher mult = faster stars/clouds
      const speedMult = status === 'flying' ? Math.min(4, 1 + multiplier * 0.15) : 1;

      // Stars
      for (const s of starsRef.current) {
        s.x -= s.speed * speedMult;
        if (s.x < -4) s.x = W + 4;
        const twinkle = 0.5 + 0.5 * Math.sin(now * 0.002 + s.twinkleOffset);
        ctx.save();
        ctx.globalAlpha = s.alpha * (0.7 + 0.3 * twinkle);
        ctx.shadowBlur  = s.r * 3;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle   = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Clouds
      for (const c of cloudsRef.current) {
        c.x -= c.speed * speedMult;
        if (c.x + c.w < 0) {
          c.x = W + 50;
          c.y = H * 0.05 + Math.random() * H * 0.5;
          c.w = 60 + Math.random() * 120;
          c.alpha = 0.04 + Math.random() * 0.10;
        }
        drawCloud(ctx, c.x, c.y, c.w, c.h, c.alpha);
      }

      // Grid lines (faint horizontal altitude lines)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth   = 1;
      const lineCount = 5;
      for (let i = 1; i <= lineCount; i++) {
        const y = H * (i / (lineCount + 1));
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();

      // ── Curve + Plane ─────────────────────────────────────────────────
      if (status === 'waiting') {
        const origin = getPos(W, H, 1.0, MIN_VIEWPORT);
        // Gentle plane bob while waiting
        const bobY = Math.sin(now * 0.0018) * 4;
        drawRedPlane(ctx, origin.x, origin.y + bobY, 0);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      if (status === 'flying' || status === 'crashed') {
        const isCrashed   = status === 'crashed';
        const displayMult = isCrashed ? crashPoint : multiplier;
        const displayVm   = vMax(displayMult);

        // Crash flash overlay
        if (isCrashed) {
          if (crashFlashRef.current > 0 && crashFlashRef.current < 18) {
            const flashAlpha = (1 - crashFlashRef.current / 18) * 0.45;
            ctx.save();
            ctx.globalAlpha = flashAlpha;
            ctx.fillStyle   = '#cc0018';
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
            crashFlashRef.current++;
          }
        }

        // Build curve
        const STEPS = 150;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= STEPS; i++) {
          const m = Math.exp((i / STEPS) * Math.log(Math.max(1.0001, displayMult)));
          pts.push(getPos(W, H, m, displayVm));
        }
        const origin = pts[0];
        const tip    = pts[pts.length - 1];

        // Curved fill
        const fillGrad = ctx.createLinearGradient(0, 0, 0, H);
        if (isCrashed) {
          fillGrad.addColorStop(0,   'rgba(80, 0, 10, 0.65)');
          fillGrad.addColorStop(0.5, 'rgba(50, 0,  6, 0.72)');
          fillGrad.addColorStop(1,   'rgba(20, 0,  3, 0.78)');
        } else {
          fillGrad.addColorStop(0,   'rgba(200, 0, 35, 0.88)');
          fillGrad.addColorStop(0.5, 'rgba(110, 0, 18, 0.92)');
          fillGrad.addColorStop(1,   'rgba(45,  0,  7, 0.96)');
        }

        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(tip.x, H);
        ctx.lineTo(origin.x, H);
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Curve line glow
        ctx.save();
        ctx.shadowBlur  = isCrashed ? 4  : 16;
        ctx.shadowColor = isCrashed ? '#880000' : '#ff0033';
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = isCrashed ? '#aa1111' : '#ff1133';
        ctx.lineWidth   = 3;
        ctx.lineJoin    = 'round';
        ctx.stroke();
        ctx.restore();

        if (!isCrashed) {
          // Flying: plane at tip, follow tangent
          const mPrev   = Math.max(1.0, multiplier * 0.98);
          const prev    = getPos(W, H, mPrev, vm);
          const tangent = Math.atan2(tip.y - prev.y, tip.x - prev.x);
          drawRedPlane(ctx, tip.x, tip.y, tangent);
        } else {
          // Crashed: plane rockets off along tangent
          const mPrev   = Math.max(1.0, crashPoint * 0.98);
          const prev    = getPos(W, H, mPrev, displayVm);
          const tangent = Math.atan2(tip.y - prev.y, tip.x - prev.x);

          escapeRef.current += 0.06 + escapeRef.current * 0.20;
          const dist = escapeRef.current * W * 0.7;
          const ex   = tip.x + Math.cos(tangent) * dist;
          const ey   = tip.y + Math.sin(tangent) * dist;

          if (ex < W + 300 && ey > -300) {
            drawRedPlane(ctx, ex, ey, tangent);
          }

          // ── "FLEW AWAY!" overlay ──────────────────────────────────────
          const fontSize = Math.min(W * 0.08, 56);
          ctx.save();
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';

          // Outer glow pass
          ctx.font       = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
          ctx.shadowBlur  = 40;
          ctx.shadowColor = '#cc0018';
          ctx.fillStyle   = '#cc0018';
          ctx.fillText('FLEW AWAY!', W / 2, H / 2 - fontSize * 0.65);

          // Main text
          ctx.shadowBlur  = 18;
          ctx.shadowColor = '#ff3344';
          ctx.fillStyle   = '#ffffff';
          ctx.fillText('FLEW AWAY!', W / 2, H / 2 - fontSize * 0.65);

          // Crash multiplier — larger, bolder
          const subSize = fontSize * 0.72;
          ctx.font       = `900 ${subSize}px 'Arial Black', Arial, sans-serif`;
          ctx.shadowBlur  = 24;
          ctx.shadowColor = '#cc0018';
          ctx.fillStyle   = '#ff4455';
          ctx.fillText(`${crashPoint.toFixed(2)}x`, W / 2, H / 2 + fontSize * 0.22);
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

// ── Background (dark sky) ─────────────────────────────────────────────────────
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  // Deep dark sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   '#090912');
  sky.addColorStop(0.6, '#0e0e1a');
  sky.addColorStop(1,   '#12121f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Faint sunburst rays from bottom-left corner
  {
    const ox = 0, oy = H;
    const R  = Math.hypot(W, H) * 1.6;
    const N  = 28;
    const a0 = -Math.PI * 0.52;
    const a1 =  Math.PI * 0.04;
    const span = a1 - a0;
    for (let i = 0; i < N; i++) {
      const ta = a0 + (i       / N) * span;
      const tb = a0 + ((i + 1) / N) * span;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, R, ta, tb);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0
        ? 'rgba(255,255,255,0.018)'
        : 'rgba(255,255,255,0.005)';
      ctx.fill();
    }
  }

  // Soft red/maroon radial glow centre-left
  {
    const gx = W * 0.28, gy = H * 0.55, gr = W * 0.5;
    const g  = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0,    'rgba(140, 10, 25, 0.30)');
    g.addColorStop(0.40, 'rgba( 90,  5, 15, 0.14)');
    g.addColorStop(1,    'rgba( 40,  2,  6, 0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Dark vignette
  {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.50)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── Cloud puff ───────────────────────────────────────────────────────────────
function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = '#ffffff';
  // Draw a series of overlapping circles to form cloud shape
  const puffs = [
    { dx: 0,       dy: 0,      r: h * 0.6  },
    { dx: w * 0.2, dy: -h * 0.15, r: h * 0.75 },
    { dx: w * 0.45, dy: -h * 0.1, r: h * 0.65 },
    { dx: w * 0.65, dy: h * 0.05, r: h * 0.55 },
    { dx: w * 0.85, dy: h * 0.12, r: h * 0.45 },
  ];
  ctx.beginPath();
  for (const p of puffs) {
    ctx.moveTo(x + p.dx + p.r, y + p.dy);
    ctx.arc(x + p.dx, y + p.dy, p.r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

// ── Red propeller plane ───────────────────────────────────────────────────────
function drawRedPlane(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number) {
  const wobble  = Math.sin(Date.now() * 0.005) * 1.2;
  const propRot = (Date.now() * 0.018) % (Math.PI * 2);

  ctx.save();
  ctx.translate(cx, cy + wobble);
  ctx.rotate(angle);
  ctx.scale(PLANE_SCALE, PLANE_SCALE);

  const body   = '#cc0018';
  const dark   = '#880010';
  const bright = '#ee0028';

  // Engine exhaust glow
  const exhaust = ctx.createLinearGradient(-52, 0, -5, 0);
  exhaust.addColorStop(0,   'rgba(255,120,20,0)');
  exhaust.addColorStop(0.5, 'rgba(255,160,40,0.14)');
  exhaust.addColorStop(1,   'rgba(255,200,60,0.32)');
  ctx.fillStyle = exhaust;
  ctx.fillRect(-52, -5, 52, 10);

  // Flame jets
  ctx.save();
  ctx.shadowBlur  = 16;
  ctx.shadowColor = '#f97316';
  for (const dy of [-1.5, 1.5]) {
    const fl = ctx.createLinearGradient(-32, 0, -8, 0);
    fl.addColorStop(0,   'rgba(239,68,68,0)');
    fl.addColorStop(0.4, '#fbbf24');
    fl.addColorStop(1,   '#f97316');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.moveTo(-8,  dy - 2.5);
    ctx.lineTo(-32, dy);
    ctx.lineTo(-8,  dy + 2.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Fuselage
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.bezierCurveTo(22, -7,  8, -8, -8, -7);
  ctx.lineTo(-20, -5);
  ctx.lineTo(-25, -1);
  ctx.lineTo(-25,  1);
  ctx.lineTo(-20,  5);
  ctx.lineTo(-8,   7);
  ctx.bezierCurveTo(8,  8, 22,  7, 28, 0);
  ctx.closePath();
  ctx.fill();

  // Engine cowl
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(14, -1, 10, 8, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Cockpit glass
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.ellipse(16, -3, 5, 3.5, -0.25, 0, Math.PI);
  ctx.fill();

  // Wings
  ctx.fillStyle = bright;
  ctx.beginPath();
  ctx.moveTo( 6, -7); ctx.lineTo(-1, -27); ctx.lineTo(-12, -24); ctx.lineTo(-5, -7);
  ctx.closePath(); ctx.fill();

  ctx.beginPath();
  ctx.moveTo( 6,  5); ctx.lineTo(-1,  20); ctx.lineTo(-12,  18); ctx.lineTo(-5,  5);
  ctx.closePath(); ctx.fill();

  // Horizontal tail
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-17, -4); ctx.lineTo(-25, -15); ctx.lineTo(-28, -12); ctx.lineTo(-20, -4);
  ctx.closePath(); ctx.fill();

  // Vertical tail fin
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-16, -4); ctx.lineTo(-21, -15); ctx.lineTo(-25, -12); ctx.lineTo(-19, -4);
  ctx.closePath(); ctx.fill();

  // Engine front disc
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(22, 0, 7.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(22, 0, 5.0, 0, Math.PI * 2); ctx.fill();

  // Propeller
  ctx.save();
  ctx.translate(29, 0);
  ctx.rotate(propRot);
  ctx.scale(1 / 1.5, 1 / 1.5);
  for (let b = 0; b < 3; b++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(0, -13, 2.8, 13, 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = bright;
  ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.restore();
}
