import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAdmin } from './roleContext';
import { ScopeContext, SCOPE_KEY, type Brand, type Scope } from './scopeContext';

function readSaved(): string | null {
  try { return localStorage.getItem(SCOPE_KEY) || null; } catch { return null; }
}

export default function ScopeProvider({ children }: { children: ReactNode }) {
  const { isPlatform, siteId: ownSite } = useAdmin();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string | null>(() => (isPlatform ? readSaved() : null));

  useEffect(() => {
    let live = true;
    supabase.rpc('admin_my_sites').then(({ data, error }) => {
      if (!live) return;
      const list = error ? [] : ((data ?? []) as Brand[]);
      setBrands(list);
      // A remembered brand that no longer exists falls back to "all brands".
      if (isPlatform && picked && !list.some((b) => b.id === picked)) setPicked(null);
      setReady(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatform]);

  const setSiteId = useCallback((id: string | null) => {
    if (!isPlatform) return;
    setPicked(id);
    try { if (id) localStorage.setItem(SCOPE_KEY, id); else localStorage.removeItem(SCOPE_KEY); } catch { /* private mode */ }
  }, [isPlatform]);

  const value = useMemo<Scope>(() => {
    const siteId = isPlatform ? picked : ownSite;
    const brand = brands.find((b) => b.id === siteId);
    return {
      brands, siteId, setSiteId, canSwitch: isPlatform, ready,
      label: siteId ? (brand?.name ?? 'Your brand') : 'All brands',
      multiBrand: isPlatform && !siteId && brands.length > 1,
    };
  }, [brands, isPlatform, ownSite, picked, ready, setSiteId]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
