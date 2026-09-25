import { useCallback, useEffect, useMemo, useState } from 'react';
import { brandError, brandSchema, getBrand, saveBrand, type BrandDoc, type BrandSchema, type Identity, type Json, type SettingDef } from './api';

// One editable copy of a brand for the whole console page: every tab edits the same draft, the
// sticky save bar shows how many things changed, and Save sends them in ONE versioned save
// (identity + theme + settings), refusing if someone else saved in between.

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Change { path: string; label: string; from: unknown; to: unknown }

export function useBrandDraft(siteId: string | undefined) {
  const [schema, setSchema] = useState<BrandSchema | null>(null);
  const [doc, setDoc] = useState<BrandDoc | null>(null);
  const [identity, setIdentityState] = useState<Identity | null>(null);
  const [tokens, setTokensState] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, Json>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = (d: BrandDoc) => { setDoc(d); setIdentityState(d.identity); setTokensState(d.theme_tokens ?? {}); setConfig(d.config ?? {}); };

  const reload = useCallback(async () => {
    if (!siteId) return;
    setLoading(true); setError(null);
    try {
      const [s, d] = await Promise.all([brandSchema(), getBrand(siteId)]);
      setSchema(s); reset(d);
    } catch (e) { setError(brandError(e)); }
    finally { setLoading(false); }
  }, [siteId]);
  useEffect(() => { void reload(); }, [reload]);

  const defs = useMemo(() => new Map((schema?.settings ?? []).map((s) => [s.key, s])), [schema]);

  /** What a setting resolves to with the current draft: override → platform value → default. */
  const value = useCallback((key: string): Json => {
    if (key in config && config[key] !== null) return config[key];
    const d = defs.get(key);
    if (!d) return null;
    return (d.inherit && d.inherited !== null ? d.inherited : d.default) ?? null;
  }, [config, defs]);
  const overridden = useCallback((key: string) => key in config && config[key] !== null, [config]);
  const set = useCallback((key: string, v: Json) => {
    setConfig((c) => {
      const n = { ...c };
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete n[key]; else n[key] = v;
      return n;
    });
  }, []);
  const setMany = useCallback((patch: Record<string, Json>) => {
    setConfig((c) => { const n = { ...c }; for (const [k, v] of Object.entries(patch)) { if (v === null) delete n[k]; else n[k] = v; } return n; });
  }, []);
  const setIdentity = useCallback(<K extends keyof Identity>(k: K, v: Identity[K]) => setIdentityState((i) => (i ? { ...i, [k]: v } : i)), []);
  const setTokens = useCallback((t: Record<string, string>) => setTokensState(t), []);
  const setToken = useCallback((k: string, v: string) => setTokensState((t) => ({ ...t, [k]: v })), []);

  const changes = useMemo<Change[]>(() => {
    if (!doc || !identity) return [];
    const out: Change[] = [];
    for (const k of Object.keys(identity) as (keyof Identity)[]) {
      if (!same(identity[k], doc.identity[k])) out.push({ path: `identity.${k}`, label: k.replace(/_/g, ' '), from: doc.identity[k], to: identity[k] });
    }
    const tk = new Set([...Object.keys(tokens), ...Object.keys(doc.theme_tokens ?? {})]);
    for (const k of tk) if (!same(tokens[k], doc.theme_tokens?.[k])) out.push({ path: `theme.${k}`, label: `Theme ${k}`, from: doc.theme_tokens?.[k], to: tokens[k] });
    const ck = new Set([...Object.keys(config), ...Object.keys(doc.config ?? {})]);
    for (const k of ck) if (!same(config[k], doc.config?.[k])) out.push({ path: k, label: defs.get(k)?.label ?? k, from: doc.config?.[k] ?? null, to: config[k] ?? null });
    return out;
  }, [doc, identity, tokens, config, defs]);

  const discard = useCallback(() => { if (doc) reset(doc); }, [doc]);

  const save = useCallback(async (note?: string) => {
    if (!doc || !identity || !siteId) return { ok: false as const, message: 'Not loaded.' };
    const idPatch: Partial<Identity> = {};
    for (const k of Object.keys(identity) as (keyof Identity)[]) if (!same(identity[k], doc.identity[k])) (idPatch as Record<string, unknown>)[k] = identity[k] ?? '';
    const tokChanged = !same(tokens, doc.theme_tokens ?? {});
    const cfgPatch: Record<string, Json> = {};
    const ck = new Set([...Object.keys(config), ...Object.keys(doc.config ?? {})]);
    for (const k of ck) if (!same(config[k], doc.config?.[k])) cfgPatch[k] = config[k] ?? null;
    setSaving(true);
    try {
      await saveBrand(siteId, doc.version, {
        identity: Object.keys(idPatch).length ? idPatch : null,
        tokens: tokChanged ? tokens : null,
        config: Object.keys(cfgPatch).length ? cfgPatch : null,
        note: note ?? null,
      });
      const d = await getBrand(siteId);
      reset(d);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, message: brandError(e, schema), conflict: String((e as Error)?.message ?? '').startsWith('VERSION_CONFLICT') };
    } finally { setSaving(false); }
  }, [doc, identity, tokens, config, siteId, schema]);

  const canEdit = useCallback((d: SettingDef | { tier: string }) => {
    if (!doc) return false;
    return d.tier === 'owner' ? doc.can.owner : d.tier === 'platform' ? doc.can.platform : doc.can.brand;
  }, [doc]);

  return { schema, doc, defs, identity, tokens, config, loading, error, saving, reload, value, overridden, set, setMany, setIdentity, setTokens, setToken, changes, discard, save, canEdit };
}
export type BrandDraft = ReturnType<typeof useBrandDraft>;
