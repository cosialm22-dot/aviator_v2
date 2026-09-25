// Listens to the public "game" broadcast topic and writes every event with its local receive
// time (ms) as JSON lines to OUT. Used by supabase/tests/engine_live_e2e.py.
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… OUT=events.jsonl DUR=90 node e2e/broadcast_listener.mjs
// Behind an HTTPS proxy (CI sandbox) it tunnels the websocket through HTTPS_PROXY when the
// optional packages `ws` and `https-proxy-agent` are resolvable.
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT ?? 'events.jsonl';
const DUR = Number(process.env.DUR ?? 90) * 1000;
let transport;
if (process.env.HTTPS_PROXY) {
  try {
    const { default: WebSocket } = await import('ws');
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    transport = class extends WebSocket { constructor(u, p) { super(u, p, { agent }); } };
  } catch { /* no proxy support installed: connect directly */ }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, transport ? { realtime: { transport } } : {});
writeFileSync(OUT, '');
const ch = sb.channel('game');
for (const ev of ['round', 'bet']) {
  ch.on('broadcast', { event: ev }, (m) => appendFileSync(OUT, JSON.stringify({ at: Date.now(), event: ev, payload: m.payload }) + '\n'));
}
ch.subscribe((s) => appendFileSync(OUT, JSON.stringify({ at: Date.now(), event: 'status', payload: s }) + '\n'));
setTimeout(() => process.exit(0), DUR);
