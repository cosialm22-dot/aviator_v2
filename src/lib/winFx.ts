// ============================================================================
// Win "fly to balance": when a bet is cashed out, the won amount leaves the bet button as a green
// chip, arcs up to the balance in the header with a short trail of coins, and the balance pulses
// and counts up as it lands.
//
// Performance: everything moves with the Web Animations API on transform/opacity only, which the
// browser runs on the compositor thread, so the flight stays smooth even while the main thread is
// busy (web.dev "animations guide"; motion.dev "performance tier list"). The chips are plain DOM
// nodes in a fixed, pointer-events-none layer and are removed when they land. Reduced motion:
// no flight, the balance just updates with a short highlight.
// ============================================================================

const LANDED = 'aviator:win-landed';
let inFlight = 0;

/** A flight is on its way: the header holds a balance increase until it lands (see useWinBalance). */
export const winInFlight = (): boolean => inFlight > 0;

export function onWinLanded(fn: () => void): () => void {
  window.addEventListener(LANDED, fn);
  return () => window.removeEventListener(LANDED, fn);
}

function visibleTarget(): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-balance-target]'));
  return els.find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
}

function layer(): HTMLElement {
  let l = document.getElementById('win-fx-layer');
  if (!l) {
    l = document.createElement('div');
    l.id = 'win-fx-layer';
    l.setAttribute('aria-hidden', 'true');
    l.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden';
    document.body.appendChild(l);
  }
  return l;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function pulse(target: HTMLElement) {
  target.animate?.([
    { transform: 'scale(1)', filter: 'brightness(1)' },
    { transform: 'scale(1.14)', filter: 'brightness(1.6)', offset: 0.35 },
    { transform: 'scale(1)', filter: 'brightness(1)' },
  ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  try { navigator.vibrate?.(12); } catch { /* not allowed */ }
}

/** Fly `label` (e.g. "+75.00") from the bet button of `slot` to the balance; resolves on landing. */
export function flyWin(label: string, slot: 1 | 2): Promise<void> {
  const from = document.querySelector<HTMLElement>(`[data-bet-action="${slot}"]`);
  return flyToBalance(label, from ? from.getBoundingClientRect() : null);
}

/** Fly `label` from a screen rectangle (e.g. where the Deposit button was) into the balance. */
export function flyToBalance(label: string, fromRect: DOMRect | null): Promise<void> {
  const land = () => window.dispatchEvent(new Event(LANDED));
  const to = visibleTarget();
  if (!fromRect || !to || typeof document.body.animate !== 'function' || document.visibilityState !== 'visible') { land(); return Promise.resolve(); }
  if (reducedMotion()) { pulse(to); land(); return Promise.resolve(); }

  const a = fromRect;
  const b = to.getBoundingClientRect();
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const dur = Math.min(1000, 520 + dist * 0.4);
  // Arc: bow the path sideways (towards the screen centre) so it reads as a throw, not a slide.
  const bow = Math.min(120, dist * 0.25) * (x0 > innerWidth / 2 ? -1 : 1);
  const mid = (t: number) => ({ x: dx * t + bow * Math.sin(Math.PI * t), y: dy * t - Math.min(60, dist * 0.12) * Math.sin(Math.PI * t) });
  const path = (scaleFrom: number, scaleTo: number) => [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const p = mid(t);
    return { transform: `translate(${p.x}px, ${p.y}px) scale(${scaleFrom + (scaleTo - scaleFrom) * t})`, offset: t };
  });

  const l = layer();
  inFlight++;
  const nodes: HTMLElement[] = [];
  const spawn = (text: string, css: string, inner = '') => {
    const n = document.createElement('div');
    if (text) { const sp = document.createElement('span'); sp.textContent = text; sp.style.cssText = inner; n.appendChild(sp); }
    n.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;will-change:transform,opacity;${css}`;
    l.appendChild(n); nodes.push(n); return n;
  };

  // Coins: small gold discs that follow the chip a beat behind.
  const coins = Array.from({ length: 5 }, (_, i) => {
    const c = spawn('', `width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:9999px;background:radial-gradient(circle at 35% 35%,#fff7c2,#f5c518 55%,#b8860b);box-shadow:0 0 6px rgba(245,197,24,.7)`);
    return c.animate([
      { transform: 'translate(0,0) scale(0.2)', opacity: 0 },
      { transform: `translate(${(i - 2) * 9}px, ${-14 - (i % 2) * 8}px) scale(1)`, opacity: 1, offset: 0.12 },
      ...path(1, 0.6).slice(1).map((k) => ({ ...k, opacity: 1, offset: 0.12 + (k.offset as number) * 0.88 })),
    ], { duration: dur, delay: 90 + i * 55, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'both' });
  });

  // The amount chip: pops, then flies and shrinks into the balance.
  const chip = spawn(label, '', 'display:block;transform:translate(-50%,-50%);white-space:nowrap;border-radius:9999px;background:#0e0f0e;color:#6ee048;border:1.5px solid #5cd334;font:800 17px/1 Inter,system-ui,sans-serif;padding:8px 14px;box-shadow:0 0 0 3px rgba(92,211,52,.18),0 8px 22px rgba(0,0,0,.55);font-variant-numeric:tabular-nums');
  const chipAnim = chip.animate([
    { transform: 'translate(0,0) scale(0.6)', opacity: 0 },
    { transform: 'translate(0,-10px) scale(1.15)', opacity: 1, offset: 0.14 },
    { transform: 'translate(0,-10px) scale(1)', opacity: 1, offset: 0.24 },
    ...path(1, 0.45).slice(1).map((k) => ({ ...k, opacity: (k.offset as number) > 0.9 ? 0.2 : 1, offset: 0.24 + (k.offset as number) * 0.76 })),
  ], { duration: dur + 220, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      inFlight = Math.max(0, inFlight - 1);
      pulse(to);
      land();
      // Let the last coins arrive, then clean up.
      setTimeout(() => nodes.forEach((n) => n.remove()), 450);
      resolve();
    };
    chipAnim.finished.then(finish, finish);
    coins.forEach((c) => c.finished.catch(() => {}));
    setTimeout(finish, dur + 900); // safety net (e.g. tab hidden mid-flight)
  });
}
