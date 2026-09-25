import { useSyncExternalStore } from 'react';
import { getBrand, subscribeBrand, type Brand } from './runtime';
import type { BrandSettings } from './settings.generated';

/** The brand this page is serving (live: re-renders when the brand console saves). */
export function useBrand(): Brand {
  return useSyncExternalStore(subscribeBrand, getBrand, getBrand);
}

/** One typed public setting of this brand. */
export function useBrandSetting<K extends keyof BrandSettings>(key: K): BrandSettings[K] {
  return useSyncExternalStore(subscribeBrand, () => getBrand().config[key], () => getBrand().config[key]);
}
