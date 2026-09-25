import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// One subscription to the public broadcast topic "config" for the whole page. It carries
// platform-wide pushes (maintenance on/off) and brand saves ({site_id, version}); every consumer
// registers a handler here instead of opening its own channel.
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const onSubscribed = new Set<() => void>();
let channel: RealtimeChannel | null = null;

function ensure() {
  if (channel) return;
  channel = supabase.channel('config');
  for (const event of ['maintenance', 'brand']) {
    channel.on('broadcast', { event }, ({ payload }) => handlers.get(event)?.forEach((h) => h(payload)));
  }
  channel.subscribe((status) => { if (status === 'SUBSCRIBED') onSubscribed.forEach((f) => f()); });
}

/** Listen for one event on "config". Returns an unsubscribe function (the channel stays open). */
export function onConfigEvent(event: 'maintenance' | 'brand', h: Handler): () => void {
  ensure();
  let set = handlers.get(event);
  if (!set) { set = new Set(); handlers.set(event, set); }
  set.add(h);
  return () => { set?.delete(h); };
}

/** Run `f` every time the channel (re)connects — the moment to re-read state that may have been missed. */
export function onConfigConnected(f: () => void): () => void {
  ensure();
  onSubscribed.add(f);
  return () => { onSubscribed.delete(f); };
}
