// Brand domain automation — pure logic, network injected (unit-tested in Node by vitest:
// supabase/functions/_shared/domains.test.ts). Ported from invest254 apps/api/src/domains.ts, adapted
// from Cloudflare Pages to Worker Custom Domains:
//
//   zone      find (or create) the Cloudflare zone for the registrable domain
//   nameservers  until the zone is active, compare the domain's live NS (DNS-over-HTTPS) with the
//                two Cloudflare assigned; when they match, ask Cloudflare to re-check now
//   attaching attach <host> (and www.<host>) to the app's Worker as Custom Domains — Cloudflare
//             creates the DNS records and issues the certificate itself
//   conflict  a DNS record already sits on the hostname: stop and show it (never deleted silently)
//   ssl       attached; waiting for the certificate / first HTTPS answer
//   live      https://<host>/__brand answers with THIS brand
//
// Every step is idempotent, so the same `advance()` runs for "Check now", the 5-minute sweep and a
// fresh add. Nothing here reads secrets from the environment; the caller passes them in.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CfConfig { token: string; accountId: string; service: string }
export interface Zone { id: string; name: string; status: string; name_servers: string[]; original_registrar?: string | null }
export interface WorkerDomain { id: string; hostname: string; service: string; zone_id: string; environment?: string }
export interface DnsRecord { id: string; type: string; name: string; content: string; proxied?: boolean }

export class CfError extends Error {
  constructor(message: string, readonly status: number, readonly codes: number[]) { super(message); }
}

// ── registrable domain (mirrors public._domain_apex in the migration; a test keeps them equal) ──
export const SECOND_LEVEL_SUFFIXES = [
  'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke', 'me.ke', 'mobi.ke', 'info.ke',
  'co.tz', 'or.tz', 'ne.tz', 'go.tz', 'ac.tz', 'co.ug', 'or.ug', 'ne.ug', 'go.ug', 'ac.ug', 'co.rw', 'ac.rw',
  'com.ng', 'org.ng', 'net.ng', 'co.za', 'org.za', 'net.za', 'com.gh', 'org.gh', 'co.zm', 'co.zw', 'co.mz', 'com.et',
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'net.nz', 'org.nz',
  'co.in', 'net.in', 'org.in', 'com.br', 'com.mx', 'co.jp', 'com.cn', 'com.tr', 'com.sg', 'com.my', 'com.ph', 'co.id',
];
export function apexOf(host: string): string {
  const l = host.toLowerCase().split('.');
  const n = l.length;
  if (n < 2) return host.toLowerCase();
  if (n >= 3 && SECOND_LEVEL_SUFFIXES.includes(`${l[n - 2]}.${l[n - 1]}`)) return l.slice(n - 3).join('.');
  return l.slice(n - 2).join('.');
}

// ── Cloudflare API ─────────────────────────────────────────────────────────────────────────────
const API = 'https://api.cloudflare.com/client/v4';

export function cloudflare(cfg: CfConfig, f: Fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20_000);
    let res: Response;
    try {
      res = await f(`${API}${path}`, {
        method, signal: ctl.signal,
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CfError(`Could not reach Cloudflare (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message})`, 0, []);
    } finally { clearTimeout(t); }
    const j = await res.json().catch(() => ({})) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
    if (!res.ok || j.success === false) {
      const errs = j.errors ?? [];
      throw new CfError(errs.map((e) => e.message).join('; ') || `HTTP ${res.status}`, res.status, errs.map((e) => e.code));
    }
    return j.result as T;
  }
  const A = encodeURIComponent(cfg.accountId);
  return {
    config: cfg,
    verifyToken: async (): Promise<{ status: string }> => {
      try { return await call('GET', `/accounts/${A}/tokens/verify`); }
      catch (e) { if (e instanceof CfError && e.status !== 0) return call('GET', '/user/tokens/verify'); throw e; }
    },
    workerExists: async (): Promise<boolean> => {
      try { await call('GET', `/accounts/${A}/workers/services/${encodeURIComponent(cfg.service)}`); return true; }
      catch (e) { if (e instanceof CfError && e.status === 404) return false; throw e; }
    },
    findZone: async (name: string): Promise<Zone | null> =>
      (await call<Zone[]>('GET', `/zones?name=${encodeURIComponent(name)}&account.id=${A}&per_page=5`))[0] ?? null,
    createZone: (name: string): Promise<Zone> => call<Zone>('POST', '/zones', { name, account: { id: cfg.accountId }, type: 'full' }),
    activationCheck: (zoneId: string) => call('PUT', `/zones/${encodeURIComponent(zoneId)}/activation_check`),
    workerDomains: async (q: { zoneId?: string; hostname?: string; service?: string }): Promise<WorkerDomain[]> => {
      const p = new URLSearchParams();
      if (q.zoneId) p.set('zone_id', q.zoneId);
      if (q.hostname) p.set('hostname', q.hostname);
      if (q.service) p.set('service', q.service);
      return call<WorkerDomain[]>('GET', `/accounts/${A}/workers/domains?${p}`);
    },
    attach: (hostname: string, zoneId: string): Promise<WorkerDomain> =>
      call<WorkerDomain>('PUT', `/accounts/${A}/workers/domains`, { hostname, service: cfg.service, zone_id: zoneId, environment: 'production' }),
    detach: (id: string) => call('DELETE', `/accounts/${A}/workers/domains/${encodeURIComponent(id)}`),
    dnsRecords: (zoneId: string, name: string): Promise<DnsRecord[]> =>
      call<DnsRecord[]>('GET', `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}&per_page=50`),
    deleteDnsRecord: (zoneId: string, id: string) => call('DELETE', `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`),
  };
}
export type Cloudflare = ReturnType<typeof cloudflare>;

/** The domain's live nameservers from public DNS (Cloudflare DoH, then Google). */
export async function lookupNs(name: string, f: Fetch = fetch): Promise<string[] | null> {
  for (const url of [`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=NS`, `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=NS`]) {
    try {
      const r = await f(url, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const j = await r.json() as { Status: number; Answer?: { type: number; data: string }[] };
      if (j.Status === 3) return [];                                  // NXDOMAIN: not registered / no delegation
      return (j.Answer ?? []).filter((a) => a.type === 2).map((a) => a.data.toLowerCase().replace(/\.$/, '')).sort();
    } catch { /* next resolver */ }
  }
  return null;
}

export interface Probe { ok: boolean; siteId?: string; status?: number; error?: string }
/** Does https://<host>/__brand answer, and for which brand? */
export async function probe(host: string, f: Fetch = fetch): Promise<Probe> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await f(`https://${host}/__brand`, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'brand-domains/1.0' } });
    if (r.status !== 200) return { ok: false, status: r.status, error: `answered HTTP ${r.status}` };
    const j = await r.json().catch(() => null) as { site_id?: string } | null;
    return j?.site_id ? { ok: true, siteId: j.site_id, status: 200 } : { ok: false, status: 200, error: 'answered, but not from the app' };
  } catch (e) {
    const m = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message;
    return { ok: false, error: m.slice(0, 160) };
  } finally { clearTimeout(t); }
}

// ── plain-words errors ─────────────────────────────────────────────────────────────────────────
export const TOKEN_HELP = 'The Cloudflare token needs: Account · Workers Scripts · Edit, and for all zones: Zone · Edit, DNS · Edit, Workers Routes · Edit.';
export function explain(e: unknown): string {
  if (!(e instanceof CfError)) return String((e as Error)?.message ?? e).slice(0, 300);
  const c = new Set(e.codes);
  const m = e.message.toLowerCase();
  if (e.status === 0) return e.message;
  if (c.has(1097) || c.has(1099) || c.has(1049) || m.includes('not a registered domain') || m.includes('invalid domain'))
    return 'This is not a registered domain yet. Buy it at a registrar (for example Namecheap) first, then check again.';
  if (c.has(1061) || m.includes('already exists')) return 'This domain is already in a Cloudflare account. Remove it there, then check again.';
  if (c.has(1118) || m.includes('pending zones') || m.includes('zone limit')) return 'The Cloudflare account has too many domains waiting for nameservers. Finish or remove some, then check again.';
  if (c.has(1105)) return 'Cloudflare is busy; this will be retried automatically.';
  if (e.status === 401 || e.status === 403 || c.has(10000) || c.has(9109) || c.has(1068) || m.includes('authentication') || m.includes('unauthorized'))
    return `Cloudflare refused the request. ${TOKEN_HELP}`;
  if (c.has(100117) || m.includes('externally managed dns') || m.includes('existing dns record')) return 'A DNS record already exists on this hostname.';
  return `Cloudflare: ${e.message.slice(0, 240)}`;
}
const isConflict = (e: unknown) => e instanceof CfError && (e.codes.includes(100117) || /externally managed dns|dns record.*(exist|conflict)|existing dns record/i.test(e.message));

// ── the state machine ──────────────────────────────────────────────────────────────────────────
export interface DomainRow {
  hostname: string; apex: string; site_id: string; include_www: boolean; stage: string;
  zone_id: string | null; nameservers: string[] | null; worker_domains: Record<string, string>;
  conflict_records: { id: string; type: string; name: string; content: string }[] | null;
}
export type Patch = Record<string, unknown>;
export interface Deps { cf: Cloudflare; ns: (name: string) => Promise<string[] | null>; probe: (host: string) => Promise<Probe> }

export const wantedHosts = (d: Pick<DomainRow, 'hostname' | 'apex' | 'include_www'>) =>
  d.hostname === d.apex && d.include_www ? [d.hostname, `www.${d.hostname}`] : [d.hostname];

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export async function advance(d: DomainRow, x: Deps): Promise<Patch> {
  const svc = x.cf.config.service;
  // 1. zone
  let zone: Zone | null;
  try {
    zone = await x.cf.findZone(d.apex);
    if (!zone) zone = await x.cf.createZone(d.apex);
  } catch (e) {
    return { stage: 'error', last_error: explain(e) };
  }
  const base: Patch = { zone_id: zone.id, zone_status: zone.status, nameservers: zone.name_servers ?? [] };

  // 2. nameservers
  if (zone.status !== 'active') {
    const live = await x.ns(d.apex);
    const assigned = (zone.name_servers ?? []).map((n) => n.toLowerCase());
    const pointed = !!live && live.length > 0 && sameSet(live, assigned);
    if (pointed) { try { await x.cf.activationCheck(zone.id); } catch { /* rate limited: the next sweep asks again */ } }
    return {
      ...base, stage: 'nameservers', ns_current: live ?? [], worker_status: null, ssl_status: null, https_ok: false,
      last_error: live && live.length === 0 ? 'The domain has no nameservers in public DNS yet (is it registered?).' : null,
      // pointed → Cloudflare usually activates within minutes: look again soon
      ...(pointed ? { next_check_seconds: 120 } : {}),
    };
  }

  // 3. attach to the Worker
  const want = wantedHosts(d);
  let existing: WorkerDomain[];
  try { existing = await x.cf.workerDomains({ zoneId: zone.id }); } catch (e) { return { ...base, stage: 'error', last_error: explain(e) }; }
  const ids: Record<string, string> = {};
  for (const h of want) {
    const e = existing.find((w) => w.hostname === h);
    if (e && e.service === svc) { ids[h] = e.id; continue; }
    if (e) return { ...base, stage: 'error', worker_domains: ids, last_error: `${h} is connected to another Worker ("${e.service}") in Cloudflare. Remove it there first.` };
    try {
      const r = await x.cf.attach(h, zone.id);
      ids[h] = r.id;
    } catch (err) {
      if (isConflict(err)) {
        let recs: DnsRecord[] = [];
        try { recs = await x.cf.dnsRecords(zone.id, h); } catch { /* shown without the list */ }
        return {
          ...base, stage: 'conflict', worker_domains: ids, worker_status: 'conflict',
          conflict_records: recs.filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.type)).map((r) => ({ id: r.id, type: r.type, name: r.name, content: r.content })),
          last_error: `${h} already has DNS records. Replace them to connect it to the app.`,
        };
      }
      return { ...base, stage: 'error', worker_domains: ids, last_error: explain(err) };
    }
  }
  // www no longer wanted: detach what this automation attached
  for (const [h, id] of Object.entries(d.worker_domains ?? {})) {
    if (!want.includes(h)) { try { await x.cf.detach(id); } catch { /* already gone */ } }
  }

  // 4. HTTPS answers with this brand
  const probes = await Promise.all(want.map((h) => x.probe(h)));
  const wrong = probes.find((p) => p.ok && p.siteId !== d.site_id);
  if (wrong) return { ...base, stage: 'error', worker_domains: ids, worker_status: 'active', https_ok: true, last_error: 'The domain answers for a different brand. Check it is not listed twice.' };
  if (probes.every((p) => p.ok)) {
    return { ...base, stage: 'live', worker_domains: ids, worker_status: 'active', ssl_status: 'active', https_ok: true, conflict_records: null, last_error: null, ns_current: zone.name_servers };
  }
  const why = probes.map((p, i) => (p.ok ? null : `${want[i]}: ${p.error}`)).filter(Boolean).join('; ');
  return { ...base, stage: 'ssl', worker_domains: ids, worker_status: 'active', ssl_status: 'issuing', https_ok: false, conflict_records: null,
    last_error: `Waiting for the certificate (${why}). This usually takes a few minutes.`, next_check_seconds: 120 };
}

/** Delete exactly the conflicting A/AAAA/CNAME records recorded for this domain, then advance. */
export async function replaceConflicts(d: DomainRow, x: Deps): Promise<Patch> {
  if (!d.zone_id || !d.conflict_records?.length) return advance(d, x);
  const allowed = new Set(wantedHosts(d));
  for (const r of d.conflict_records) {
    if (!allowed.has(r.name) || !['A', 'AAAA', 'CNAME'].includes(r.type)) continue;
    try { await x.cf.deleteDnsRecord(d.zone_id, r.id); } catch (e) { if (!(e instanceof CfError && e.status === 404)) return { stage: 'conflict', last_error: explain(e) }; }
  }
  return advance({ ...d, conflict_records: null }, x);
}

/** Detach every Worker custom domain of this domain (by stored id, then by hostname). */
export async function detachAll(d: DomainRow, cf: Cloudflare): Promise<string[]> {
  const done: string[] = [];
  const ids = new Map(Object.entries(d.worker_domains ?? {}));
  for (const h of wantedHosts(d)) {
    if (ids.has(h)) continue;
    try { const found = (await cf.workerDomains({ hostname: h })).find((w) => w.service === cf.config.service); if (found) ids.set(h, found.id); } catch { /* none */ }
  }
  for (const [h, id] of ids) { try { await cf.detach(id); done.push(h); } catch (e) { if (e instanceof CfError && e.status === 404) done.push(h); else throw e; } }
  return done;
}
