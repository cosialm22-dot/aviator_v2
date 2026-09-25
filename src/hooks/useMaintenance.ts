import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onConfigConnected, onConfigEvent } from '../lib/configChannel';
import { useBrand } from '../brand/useBrand';

// useMaintenance — true while bets are closed: the platform-wide `system.maintenance_mode` flag or
// this brand's `features.maintenance` switch. The authoritative gate is place_bet (it raises
// MAINTENANCE_MODE); this only keeps the UI honest. The platform flag is PUSHED on the public
// broadcast topic "config" and re-read after every (re)connect and every 5 minutes; the brand switch
// arrives with the brand (also pushed on "config").
const SAFETY_POLL_MS = 5 * 60_000;

export function useMaintenance(): boolean {
  const [on, setOn] = useState(false);
  const brandOn = useBrand().config['features.maintenance'];

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data, error } = await supabase.rpc('is_maintenance');
      if (alive && !error) setOn(Boolean(data));
    };
    const off1 = onConfigEvent('maintenance', (p) => {
      const m = (p as { maintenance?: unknown })?.maintenance;
      if (alive && typeof m === 'boolean') setOn(m);
    });
    const off2 = onConfigConnected(() => { void check(); });
    void check();
    const id = setInterval(check, SAFETY_POLL_MS);
    return () => { alive = false; clearInterval(id); off1(); off2(); };
  }, []);

  return on || brandOn;
}
