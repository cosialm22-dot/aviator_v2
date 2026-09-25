// Domains + integrations data layer (migration 20260930095000, edge function brand-domains).
import { supabase } from '../../lib/supabase';

export type DomainStage = 'queued' | 'zone' | 'nameservers' | 'attaching' | 'conflict' | 'ssl' | 'live' | 'error';
export interface Domain {
  hostname: string; apex: string; site_id: string; is_primary: boolean; status: 'pending' | 'active' | 'error'; stage: DomainStage;
  include_www: boolean; www_redirect: boolean; redirect_to_primary: boolean; managed: boolean;
  zone_id: string | null; zone_status: string | null; nameservers: string[] | null; ns_current: string[] | null;
  worker_status: string | null; ssl_status: string | null; https_ok: boolean | null; worker_domains: Record<string, string>;
  conflict_records: { id: string; type: string; name: string; content: string }[] | null;
  last_checked_at: string | null; next_check_at: string; last_error: string | null; activated_at: string | null;
  attempts: number; created_at: string; created_by_name: string | null;
}
export interface DomainsDoc { can_manage: boolean; automation: boolean; domains: Domain[] }

export interface CatalogField { name: string; label: string; kind: 'text' | 'enum' | 'bool' | 'url' | 'email'; required?: boolean; default?: string; options?: string[]; pattern?: string; help?: string; owner_only?: boolean }
export interface CatalogEntry { label: string; help?: string; scopes: string[]; config: CatalogField[]; secrets: { name: string; label: string; required?: boolean; help?: string }[] }
export interface Integration {
  id: string; provider: string; scope_kind: 'global' | 'platform' | 'site'; scope_id: string | null; label: string | null; enabled: boolean;
  config: Record<string, string | boolean>; secrets: Record<string, { set: boolean; hint: string; set_at: string }>;
  test_ok: boolean | null; test_message: string | null; tested_at: string | null; updated_at: string; updated_by: string | null;
}
export interface IntegrationsDoc { catalog: Record<string, CatalogEntry>; items: Integration[] }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Call brand-domains; its error bodies are {error: CODE, message}. Thrown as "CODE: message". */
async function fn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('brand-domains', { body });
  if (error) {
    let j: { error?: string; message?: string } | null = null;
    try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
    throw new Error(j?.error ? `${j.error}${j.message ? `: ${j.message}` : ''}` : (error as Error).message);
  }
  return data as T;
}

export const listDomains = (site: string) => rpc<DomainsDoc>('admin_domains', { p_site: site });
export const updateDomain = (hostname: string, patch: Partial<Pick<Domain, 'is_primary' | 'include_www' | 'www_redirect' | 'redirect_to_primary'>>) =>
  rpc<Domain>('admin_domain_update', { p_hostname: hostname, p_patch: patch });
export const addDomain = (site: string, hostname: string, includeWww: boolean) =>
  fn<{ domain: Domain; automation: boolean; message?: string }>({ action: 'add', site_id: site, hostname, include_www: includeWww });
export const adoptDomain = (site: string, hostname: string, includeWww: boolean) =>
  fn<{ domain: Domain }>({ action: 'adopt', site_id: site, hostname, include_www: includeWww });
export const checkDomain = (hostname: string) => fn<{ domain: Domain; message?: string }>({ action: 'check', hostname });
export const replaceRecords = (hostname: string) => fn<{ domain: Domain }>({ action: 'replace', hostname });
export const removeDomain = (hostname: string) => fn<{ removed: string; detached: string[] }>({ action: 'remove', hostname });
export const unassignedDomains = () => fn<{ hosts: { hostname: string; with_www: boolean }[] }>({ action: 'unassigned' });
export const testCloudflare = () => fn<{ ok: boolean; message: string }>({ action: 'test' });
/** Owner only: record a domain connected by hand (no Cloudflare automation). */
export const addManualDomain = (site: string, hostname: string, includeWww: boolean) =>
  rpc<Domain>('admin_domain_add', { p_site: site, p_hostname: hostname, p_include_www: includeWww, p_managed: false });

export const listIntegrations = (scope: 'global' | 'platform' | 'site', id: string | null) =>
  rpc<IntegrationsDoc>('admin_integrations', { p_scope_kind: scope, p_scope_id: id });
export const saveIntegration = (a: { provider: string; scope: 'global' | 'platform' | 'site'; scopeId: string | null; config: Record<string, unknown>; secrets: Record<string, string | null>; enabled: boolean; label?: string | null }) =>
  rpc<Integration>('admin_integration_save', {
    p_provider: a.provider, p_scope_kind: a.scope, p_scope_id: a.scopeId, p_config: a.config, p_secrets: a.secrets, p_enabled: a.enabled, p_label: a.label ?? null,
  });
export const deleteIntegration = (id: string) => rpc<void>('admin_integration_delete', { p_id: id });

export { STEPS, stepIndex, stageText, nsMatch, registrarOf, normalizeHost } from './domainRules';
