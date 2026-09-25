import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// useMaintenance - reflects the server's `system.maintenance_mode` flag so the betting UI can
// lock the instant the platform is closed.
//
// The authoritative gate is the place_bet RPC (it raises MAINTENANCE_MODE); this hook only keeps
// the UI honest. The flag is PUSHED on the public broadcast topic "config" when it changes, so
// pages no longer poll. It is read once on load, after every (re)connect, and every 5 minutes as
// a safety net in case a message is missed.
const SAFETY_POLL_MS = 5 * 60_000;

export function useMaintenance(): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data, error } = await supabase.rpc('is_maintenance');
      if (alive && !error) setOn(Boolean(data));
    };
    const ch = supabase
      .channel('config')
      .on('broadcast', { event: 'maintenance' }, ({ payload }) => {
        if (alive && typeof payload?.maintenance === 'boolean') setOn(payload.maintenance);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void check(); });
    const id = setInterval(check, SAFETY_POLL_MS);
    return () => { alive = false; clearInterval(id); void supabase.removeChannel(ch); };
  }, []);

  return on;
}
