import { useEffect, useRef } from 'react';
import { BIRD_MAP, DEFAULT_BIRD, drawBird } from './birds';

// ============================================================================
// BirdMark — a small live, flapping bird for headers/sidebars/admin chrome.
// Renders the site's species on a tiny canvas so the brand mark is animated
// (wing flaps) rather than a static image. Replaces the old /plane.png <img>.
// ============================================================================

interface Props {
  /** Species id (bird skin). Defaults to DEFAULT_BIRD. */
  skin?: string;
  /** Pixel width of the canvas; height derives from the species' proportions. */
  width?: number;
  className?: string;
}

export default function BirdMark({ skin, width = 40, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = BIRD_MAP[(skin || DEFAULT_BIRD).toLowerCase()] ?? BIRD_MAP[DEFAULT_BIRD];
  const height = Math.round(width * 0.62);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const frame = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawBird(ctx, spec, width * 0.5, height * 0.52, -0.12, width * 0.92, performance.now());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [spec, width, height]);

  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden="true" />;
}
