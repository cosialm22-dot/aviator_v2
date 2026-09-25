// Brand console data layer: typed wrappers over the brand RPCs (see migrations 2026093009*).
import { supabase } from '../../lib/supabase';

export type SettingKind = 'bool' | 'int' | 'number' | 'money' | 'text' | 'longtext' | 'enum' | 'color' | 'url' | 'email' | 'phone' | 'list';
export type Tier = 'owner' | 'platform' | 'brand';
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface SettingDef {
  key: string; section: string; kind: SettingKind; label: string; help: string | null;
  default: Json; inherit: string | null; inherited: Json;
  min: number | null; max: number | null; options: [string, string][] | null; pattern: string | null; max_len: number | null;
  public: boolean; tier: Tier; floor: string | null; ceil: string | null;
}
export interface BrandSchema { settings: SettingDef[]; fonts: string[] }

export interface Identity {
  name: string; status: 'active' | 'suspended' | 'disabled'; wordmark_text: string | null; logo_url: string | null;
  favicon_url: string | null; locale: string; support_email: string | null; licence_line: string | null;
}
export interface DomainRow {
  hostname: string; site_id: string; is_primary: boolean; status: 'pending' | 'active' | 'error';
  zone_id: string | null; zone_status: string | null; nameservers: string[] | null; worker_status: string | null;
  ssl_status: string | null; last_checked_at: string | null; last_error: string | null; created_at: string;
}
export interface BrandDoc {
  site_id: string; slug: string; version: number; created_at: string; updated_at: string;
  platform_id: string | null; platform_name: string | null;
  identity: Identity; theme_tokens: Record<string, string>; config: Record<string, Json>; effective: Record<string, Json>;
  domains: DomainRow[];
  default_marketer: { id: string; username: string; phone: string | null; referral_code: string | null } | null;
  marketers: { id: string; username: string }[];
  staff: { id: string; username: string; role: string }[];
  players: number;
  can: { owner: boolean; platform: boolean; brand: boolean };
}
export interface Version { version: number; diff: Record<string, [Json, Json]>; note: string | null; changed_at: string; changed_by: string | null }
export interface BrandRow {
  site_id: string; name: string; slug: string; status: string; withdrawals_enabled: boolean;
  default_marketer_id: string | null; default_marketer_username: string | null; created_at: string;
  player_count: number; marketer_count: number; deposit_total: number; ggr: number;
  withdrawal_pending_count: number; withdrawal_pending_total: number; withdrawal_paid_total: number; net_cashflow: number;
  platform_id: string | null; primary_domain: string | null; theme_tokens: Record<string, string>; config_version: number;
  logo_url: string | null; plane_model: string; stream_bird: string;
}
export interface FoundUser {
  id: string; username: string; role: string; phone: string | null; site_id: string | null; site_name: string | null;
  platform_id: string | null; owns_brand: string | null; referred_players: number;
}
export interface Platform { id: string; slug: string; name: string; status: string; notes: string | null; created_at: string; brands: number; admins: { id: string; username: string }[] }

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

let schemaCache: Promise<BrandSchema> | null = null;
export function brandSchema(): Promise<BrandSchema> {
  schemaCache ??= call<BrandSchema>('admin_brand_schema').catch((e) => { schemaCache = null; throw e; });
  return schemaCache;
}
export const getBrand = (site: string) => call<BrandDoc>('admin_brand_get', { p_site: site });
export const brandVersions = (site: string) => call<Version[]>('admin_brand_versions', { p_site: site, p_limit: 100 });
export const saveBrand = (site: string, expected: number | null, patch: { identity?: Partial<Identity> | null; tokens?: Record<string, string> | null; config?: Record<string, Json> | null; note?: string | null }) =>
  call<{ site_id: string; version: number; changed: boolean; diff?: Record<string, [Json, Json]> }>('admin_brand_save', {
    p_site: site, p_expected_version: expected, p_identity: patch.identity ?? null, p_tokens: patch.tokens ?? null,
    p_config: patch.config ?? null, p_note: patch.note ?? null,
  });
export const rollbackBrand = (site: string, version: number) => call<{ version: number }>('admin_brand_rollback', { p_site: site, p_version: version });
export const listBrands = () => call<BrandRow[]>('platform_sites_overview');
export const createBrand = (a: { slug: string; name: string; platform?: string | null; tokens?: Record<string, string> | null; config?: Record<string, Json> | null }) =>
  call<{ site_id: string; slug: string }>('platform_create_site', {
    p_slug: a.slug, p_name: a.name, p_currency: 'KES', p_locale: 'en-KE', p_platform: a.platform ?? null,
    p_theme_tokens: a.tokens ?? null, p_config: a.config ?? null,
  });
export const assignMarketer = (site: string, user: string | null) => call('platform_assign_marketer', { p_site: site, p_user: user });
export const findUsers = (q: string) => call<FoundUser[]>('platform_find_users', { p_q: q, p_limit: 20 });
export const setSitePlatform = (site: string, platform: string | null) => call('platform_set_site_platform', { p_site: site, p_platform: platform });
export const listPlatforms = () => call<Platform[]>('platform_list_platforms');
export const upsertPlatform = (p: { id?: string | null; slug: string; name: string; status: string; notes?: string | null }) =>
  call<{ id: string }>('platform_upsert_platform', { p_id: p.id ?? null, p_slug: p.slug, p_name: p.name, p_status: p.status, p_notes: p.notes ?? null });
export const setPlatformAdmin = (user: string, platform: string | null) => call('platform_set_platform_admin', { p_user: user, p_platform: platform });
export const setRole = (user: string, role: string) => call('admin_set_role', { p_user_id: user, p_role: role });

/** Upload an image into the brand's folder of the public brand-assets bucket; returns its public URL. */
export async function uploadBrandAsset(site: string, kind: 'plane' | 'logo' | 'favicon' | 'icon' | 'og', file: File): Promise<string> {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' } as Record<string, string>)[file.type];
  if (!ext) throw new Error('UPLOAD_TYPE');
  if (file.size > 2 * 1024 * 1024) throw new Error('UPLOAD_SIZE');
  const path = `${site}/${kind}/${Date.now().toString(36)}.${ext}`;
  const { error } = await supabase.storage.from('brand-assets').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(error.message.includes('row-level security') ? 'NOT_AUTHORIZED' : error.message);
  return supabase.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
}

/** Staff copy for the brand RPC error codes. */
const withStop = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

export function brandError(e: unknown, schema?: BrandSchema | null): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const [code, key, ...rest] = msg.split(':');
  const label = (k: string) => schema?.settings.find((s) => s.key === k)?.label ?? k.replace(/^identity\./, '').replace(/_/g, ' ');
  switch (code.trim()) {
    case 'VERSION_CONFLICT': return 'Someone else saved this brand a moment ago. Reload to see their changes, then save again.';
    case 'INVALID_SETTING': return `${label(key)}: ${rest.join(':').trim() || 'invalid value'}.`;
    case 'UNKNOWN_SETTING': return `Unknown setting ${key}.`;
    case 'INVALID_THEME': return `Theme: ${key?.trim() || 'invalid value'}.`;
    case 'NOT_AUTHORIZED': return key ? `Your role cannot change ${label(key)}.` : 'Your role cannot do this.';
    case 'FORBIDDEN': return 'Your role cannot do this.';
    case 'FORBIDDEN_SITE': return 'That person belongs to a brand outside your scope.';
    case 'SITE_NOT_FOUND': case 'NOT_FOUND': return 'Not found.';
    case 'SLUG_TAKEN': return 'That address name is taken.';
    case 'INVALID_SLUG': return 'Address name: 3–40 lowercase letters, numbers or hyphens.';
    case 'NAME_REQUIRED': return 'Give the brand a name (up to 60 characters).';
    case 'MARKETER_OWNS_ANOTHER_BRAND': return 'This marketer already owns another brand.';
    case 'MARKETER_HAS_PLAYERS': return 'This marketer has players on another brand and cannot be moved.';
    case 'NOT_A_MARKETER': return 'Only a player or a marketer can own a brand\'s audience.';
    case 'USER_NOT_FOUND': return 'That person no longer exists.';
    case 'SUPER_ADMIN_LOCKED': return 'Only the platform can appoint or change a brand owner.';
    case 'USE_PLATFORM_CONSOLE': return 'Change platform roles on the Platforms page.';
    case 'PLATFORM_NOT_FOUND': return 'That platform no longer exists.';
    case 'DEMOTE_MARKETER_FIRST': return 'Remove the marketer role first.';
    case 'CANNOT_TARGET_SELF': return 'You cannot change your own role.';
    case 'INVALID_ROLE': return 'Unknown role.';
    case 'UPLOAD_TYPE': return 'Use a PNG, JPEG, WebP or ICO image.';
    case 'UPLOAD_SIZE': return 'Images must be 2 MB or smaller.';
    case 'CURRENCY_UNSUPPORTED': return 'Only KES is supported.';
    // domains + integrations: the server already wrote the words after the code
    case 'DOMAIN_TAKEN': case 'INVALID_DOMAIN': case 'TOO_MANY_DOMAINS': case 'PRIMARY_REQUIRED': case 'PRIMARY_REDIRECT': case 'INVALID_URL': case 'NOT_CONFIGURED': case 'CLOUDFLARE':
      return withStop([key, ...rest].join(':').trim() || 'Not possible.');
    case 'REQUIRED': return `${[key, ...rest].join(':').trim()} is required.`;
    case 'INVALID': return withStop(`${[key, ...rest].join(':').trim()} is not valid`);
    case 'TOO_LONG': return `${[key, ...rest].join(':').trim()} is too long.`;
    case 'SCOPE_NOT_ALLOWED': return 'This provider cannot be set up here.';
    case 'UNKNOWN_PROVIDER': case 'UNKNOWN_SECRET': case 'UNKNOWN_FIELD': return 'The console is out of date. Reload the page.';
    case 'UNAUTHENTICATED': return 'Your session has ended. Sign in again.';
    default: return 'Something went wrong. Please try again.';
  }
}
