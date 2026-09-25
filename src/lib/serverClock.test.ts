import { describe, it, expect } from 'vitest';
import { estimateOffset, syncClock, serverNow, setServerOffset } from './serverClock';

describe('server clock sync', () => {
  it('uses the fastest round trip and assumes the midpoint', () => {
    const r = estimateOffset([
      { sentAt: 1000, receivedAt: 1400, serverMs: 5000 },   // slow sample
      { sentAt: 2000, receivedAt: 2040, serverMs: 5520 },   // fast: midpoint 2020 → offset 3500
    ]);
    expect(r).toEqual({ offset: 3500, rtt: 40 });
  });
  it('ignores broken samples and returns null when there are none', () => {
    expect(estimateOffset([{ sentAt: 10, receivedAt: 5, serverMs: 1 }, { sentAt: 1, receivedAt: 2, serverMs: NaN }])).toBeNull();
  });
  it('detects a phone clock that runs fast', async () => {
    let t = 1_000_000; const now = () => t;
    const phoneAhead = 1500, latency = 30;
    const fetchServer = async () => { t += latency; const s = t - phoneAhead; t += latency; return s; };
    const r = await syncClock(fetchServer, 3, now);
    expect(r?.offset).toBe(-1500);
    expect(r?.rtt).toBe(60);
  });
  it('survives failed samples', async () => {
    let i = 0;
    const r = await syncClock(async () => { if (i++ === 0) throw new Error('x'); return Date.now(); }, 2);
    expect(r).not.toBeNull();
  });
  it('serverNow applies the offset', () => {
    setServerOffset(-2000);
    expect(Math.abs(serverNow() - (Date.now() - 2000))).toBeLessThan(5);
    setServerOffset(NaN);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(5);
  });
});
