import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_PAYMENT_CONFIG, parsePaymentConfig, type PaymentConfig } from '../lib/megapayClient';

/** Deposit limits and gateway from fn_public_payment_config(); safe defaults until it loads or if it fails. */
export function usePaymentConfig(): PaymentConfig {
  const [cfg, setCfg] = useState<PaymentConfig>(DEFAULT_PAYMENT_CONFIG);
  useEffect(() => {
    let live = true;
    supabase.rpc('fn_public_payment_config').then(({ data, error }) => {
      if (live && !error) setCfg(parsePaymentConfig(data));
    });
    return () => { live = false; };
  }, []);
  return cfg;
}
