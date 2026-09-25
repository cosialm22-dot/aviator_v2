import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_PAYMENT_CONFIG, parsePaymentConfig, type PaymentConfig } from '../lib/megapayClient';

// One fetch per page load, shared by every screen (limits, bonus offer). Safe defaults until it
// arrives or if it fails.
let cached: PaymentConfig | null = null;
let inflight: Promise<PaymentConfig> | null = null;
function load(): Promise<PaymentConfig> {
  if (cached) return Promise.resolve(cached);
  inflight ??= Promise.resolve(supabase.rpc('fn_public_payment_config')).then(({ data, error }) => {
    if (error) { inflight = null; return DEFAULT_PAYMENT_CONFIG; }
    cached = parsePaymentConfig(data);
    return cached;
  }, () => { inflight = null; return DEFAULT_PAYMENT_CONFIG; });
  return inflight;
}

/** Deposit/bet limits and the live bonus offer from fn_public_payment_config(). */
export function usePaymentConfig(): PaymentConfig {
  const [cfg, setCfg] = useState<PaymentConfig>(cached ?? DEFAULT_PAYMENT_CONFIG);
  useEffect(() => {
    let live = true;
    void load().then((c) => { if (live) setCfg(c); });
    return () => { live = false; };
  }, []);
  return cfg;
}
