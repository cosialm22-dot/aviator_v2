import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Shrinks its text until it fits the width its container gives it, so a figure is never cut
 * off with "…". Only use it where the container's width comes from the layout (grid cell,
 * card), never inside a box that sizes itself to its content.
 */
export default function FitText({ children, max = 26, min = 12, className = '' }: {
  children: ReactNode; max?: number; min?: number; className?: string;
}) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      let s = max;
      i.style.fontSize = `${s}px`;
      while (s > min && i.scrollWidth > o.clientWidth) { s -= 1; i.style.fontSize = `${s}px`; }
      setSize(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    return () => ro.disconnect();
  }, [children, max, min]);

  return (
    <span ref={outer} className={`block min-w-0 w-full overflow-hidden ${className}`}>
      <span ref={inner} className="inline-block whitespace-nowrap leading-tight" style={{ fontSize: size }}>{children}</span>
    </span>
  );
}
