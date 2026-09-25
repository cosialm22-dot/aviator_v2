import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_PAYMENT_CONFIG, parsePaymentConfig, type PaymentConfig } from '../lib/megapayClient';
import { getBrand, subscribeBrand } from '../brand/runtime';

// Limits, chips and the bonus offer of THIS brand (fn_public_payment_config: the signed-in
// player's brand, else the brand this page resolved to). Shared by every screen; refetched when
// the brand is saved (pushed on "config") or the account changes. Safe defaults until it arrives.
let cached: PaymentConfig | null = null;
let inflight: Promise<PaymentConfig> | null = null;
const subs = new Set<(c: PaymentConfig) => void>();

function load(force = false): Promise<PaymentConfig> {
  if (cached && !force) return Promise.resolve(cached);
  inflight = Promise.resolve(supabase.rpc('fn_public_payment_config', { p_site: getBrand().site_id })).then(({ data, error }) => {
    inflight = null;
    if (error) return cached ?? DEFAULT_PAYMENT_CONFIG;
    cached = parsePaymentConfig(data);
    subs.forEach((f) => f(cached!));
    return cached;
  }, () => { inflight = null; return cached ?? DEFAULT_PAYMENT_CONFIG; });
  return inflight;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  let version = getBrand().version, site = getBrand().site_id;
  subscribeBrand(() => {
    const b = getBrand();
    if (b.version !== version || b.site_id !== site) { version = b.version; site = b.site_id; void load(true); }
  });
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => { void load(true); }, 0);
  });
}

/** Deposit/bet limits, chips, switches and the live bonus offer of this brand. */
export function usePaymentConfig(): PaymentConfig {
  const [cfg, setCfg] = useState<PaymentConfig>(cached ?? DEFAULT_PAYMENT_CONFIG);
  useEffect(() => {
    wire();
    let live = true;
    const on = (c: PaymentConfig) => { if (live) setCfg(c); };
    subs.add(on);
    void load().then(on);
    return () => { live = false; subs.delete(on); };
  }, []);
  return cfg;
}
