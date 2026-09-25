// Back-compat facade over the brand runtime (src/brand/runtime.ts). Signup reads the brand slug
// synchronously so a new account is attributed to the site it signed up on.
import { getBrand, loadBrand, type Brand } from '../brand/runtime';

export type SiteBrand = Brand;

export function getCachedSiteBrand(): SiteBrand | null { return getBrand(); }
export function getCachedSiteSlug(): string | undefined { return getBrand().slug; }
export function getCachedSiteId(): string { return getBrand().site_id; }
export function resolveSiteBrand(): Promise<SiteBrand | null> { return loadBrand(); }
