import { createContext, useContext } from 'react';

export interface Brand { id: string; name: string; slug: string; status: string; platform_id?: string | null; primary_domain?: string | null }

/**
 * Which brand the admin pages show.
 *  - Platform owner: `siteId` null = all brands, or one brand they picked (remembered per browser).
 *  - Platform admin: one of its platform's brands.
 *  - Everyone else: always their own brand (the server enforces this too).
 * Pages pass `siteId` as `p_site` to the scoped RPCs.
 */
export interface Scope {
  brands: Brand[];
  siteId: string | null;
  setSiteId: (id: string | null) => void;
  canSwitch: boolean;
  /** Only the owner may look at every brand at once. */
  canPickAll: boolean;
  /** "All brands" or the brand name. */
  label: string;
  /** Show a Brand column in lists when several brands can appear. */
  multiBrand: boolean;
  ready: boolean;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const v = useContext(ScopeContext);
  if (!v) throw new Error('useScope must be used within ScopeProvider');
  return v;
}

export const SCOPE_KEY = 'admin:scope';
