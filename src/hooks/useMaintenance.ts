import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// useMaintenance - reflects the server's `system.maintenance_mode` flag so the
// betting UI can lock the instant the platform is closed.
//
// The authoritative gate is the DB place_bet RPC (it raises MAINTENANCE_MODE);
// this hook only keeps the UI honest so players never tap "Bet" into a server
// rejection. We poll the public is_maintenance() RPC rather than subscribe via
// Realtime because system_settings is admin-only and not in the realtime
// publication. A lightweight poll is more than enough for an operational toggle
// that flips rarely; the value is also re-checked immediately on mount.
export function useMaintenance(pollMs = 20000): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data, error } = await supabase.rpc('is_maintenance');
      if (alive && !error) setOn(Boolean(data));
    };
    void check();
    const id = setInterval(check, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  return on;
}
