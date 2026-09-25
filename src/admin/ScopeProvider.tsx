import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAdmin } from './roleContext';
import { ScopeContext, SCOPE_KEY, type Brand, type Scope } from './scopeContext';

function readSaved(): string | null {
  try { return localStorage.getItem(SCOPE_KEY) || null; } catch { return null; }
}

/**
 * Brand scope of the back office.
 *  - Owner: every brand (null) or one picked brand.
 *  - Platform admin: always one of its platform's brands (never "all") — defaults to the first.
 *  - Brand staff: their own brand.
 * The owner's / platform admin's pick is also written to the server (admin_set_acting_site), so
 * RPCs and RLS that follow "the caller's brand" (current_site / _staff_site) act on the same brand.
 */
export default function ScopeProvider({ children }: { children: ReactNode }) {
  const { isPlatform, isPlatformTier, siteId: ownSite } = useAdmin();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string | null>(() => (isPlatformTier ? readSaved() : null));

  useEffect(() => {
    let live = true;
    supabase.rpc('admin_my_sites').then(({ data, error }) => {
      if (!live) return;
      const list = error ? [] : ((data ?? []) as Brand[]);
      setBrands(list);
      setPicked((p) => {
        if (!isPlatformTier) return null;
        if (p && list.some((b) => b.id === p)) return p;
        return isPlatform ? null : (list[0]?.id ?? null);   // a platform admin always has a brand
      });
      setReady(true);
    });
    return () => { live = false; };
  }, [isPlatform, isPlatformTier]);

  // Keep the server's acting brand in step with the picker.
  useEffect(() => {
    if (!isPlatformTier || !ready) return;
    void supabase.rpc('admin_set_acting_site', { p_site: picked });
  }, [isPlatformTier, picked, ready]);

  const setSiteId = useCallback((id: string | null) => {
    if (!isPlatformTier) return;
    if (!id && !isPlatform) return;
    setPicked(id);
    try { if (id) localStorage.setItem(SCOPE_KEY, id); else localStorage.removeItem(SCOPE_KEY); } catch { /* private mode */ }
  }, [isPlatform, isPlatformTier]);

  const value = useMemo<Scope>(() => {
    const siteId = isPlatformTier ? picked : ownSite;
    const brand = brands.find((b) => b.id === siteId);
    return {
      brands, siteId, setSiteId, canSwitch: isPlatformTier && (isPlatform || brands.length > 1), canPickAll: isPlatform, ready,
      label: siteId ? (brand?.name ?? 'Your brand') : 'All brands',
      multiBrand: isPlatform && !siteId && brands.length > 1,
    };
  }, [brands, isPlatform, isPlatformTier, ownSite, picked, ready, setSiteId]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
