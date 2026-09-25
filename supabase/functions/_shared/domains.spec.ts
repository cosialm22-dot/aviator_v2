// vitest (Node): the domain state machine against a fake Cloudflare, the API client's request
// shapes and error mapping, and parity of the registrable-domain list with the SQL migration.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  advance, apexOf, cloudflare, CfError, detachAll, explain, lookupNs, replaceConflicts, SECOND_LEVEL_SUFFIXES,
  type Cloudflare, type DomainRow, type Probe, type WorkerDomain, type Zone,
} from './domains';

const SITE = '11111111-1111-1111-1111-111111111111';

function fakeCf(o: {
  zone?: Zone | null; createZone?: () => Zone; attached?: WorkerDomain[];
  attachError?: (h: string) => Error | null; records?: { id: string; type: string; name: string; content: string }[];
}) {
  const log: string[] = [];
  let attached = [...(o.attached ?? [])];
  let records = [...(o.records ?? [])];
  const cf = {
    config: { token: 't', accountId: 'a'.repeat(32), service: 'aviatorv2' },
    verifyToken: async () => ({ status: 'active' }),
    workerExists: async () => true,
    findZone: async () => { log.push('findZone'); return o.zone ?? null; },
    createZone: async (n: string) => { log.push(`createZone ${n}`); if (!o.createZone) throw new Error('no'); return o.createZone(); },
    activationCheck: async () => { log.push('activationCheck'); return {}; },
    workerDomains: async () => attached,
    attach: async (h: string, z: string) => {
      const err = o.attachError?.(h); if (err) throw err;
      log.push(`attach ${h}`); const w = { id: `wd-${h}`, hostname: h, service: 'aviatorv2', zone_id: z }; attached.push(w); return w;
    },
    detach: async (id: string) => { log.push(`detach ${id}`); attached = attached.filter((a) => a.id !== id); return {}; },
    dnsRecords: async (_z: string, name: string) => records.filter((r) => r.name === name),
    deleteDnsRecord: async (_z: string, id: string) => { log.push(`deleteDns ${id}`); records = records.filter((r) => r.id !== id); return {}; },
  } as unknown as Cloudflare;
  return { cf, log };
}
const row = (p: Partial<DomainRow> = {}): DomainRow => ({
  hostname: 'lucky.co.ke', apex: 'lucky.co.ke', site_id: SITE, include_www: true, stage: 'queued',
  zone_id: null, nameservers: null, worker_domains: {}, conflict_records: null, ...p,
});
const ZONE_PENDING: Zone = { id: 'z1', name: 'lucky.co.ke', status: 'pending', name_servers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'] };
const ZONE_ACTIVE: Zone = { ...ZONE_PENDING, status: 'active' };
const okProbe = async (): Promise<Probe> => ({ ok: true, siteId: SITE });

describe('registrable domain', () => {
  it('handles second-level suffixes', () => {
    expect(apexOf('play.lucky.co.ke')).toBe('lucky.co.ke');
    expect(apexOf('lucky.co.ke')).toBe('lucky.co.ke');
    expect(apexOf('a.b.example.com')).toBe('example.com');
    expect(apexOf('example.ke')).toBe('example.ke');
  });
  it('matches the SQL list in the migration', () => {
    const dir = join(__dirname, '../../migrations');
    const f = readdirSync(dir).find((n) => n.includes('integrations_domains'))!;
    const sql = readFileSync(join(dir, f), 'utf8');
    const block = sql.slice(sql.indexOf('_domain_apex(p_host text)'), sql.indexOf('_domain_normalize(p_input text)'));
    const list = [...block.matchAll(/'([a-z]+\.[a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(list)).toEqual(new Set(SECOND_LEVEL_SUFFIXES));
  });
});

describe('advance()', () => {
  it('creates the zone and waits for nameservers', async () => {
    const { cf, log } = fakeCf({ zone: null, createZone: () => ZONE_PENDING });
    const p = await advance(row(), { cf, ns: async () => ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'], probe: okProbe });
    expect(log).toContain('createZone lucky.co.ke');
    expect(p).toMatchObject({ stage: 'nameservers', zone_id: 'z1', nameservers: ZONE_PENDING.name_servers, ns_current: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'] });
    expect(log).not.toContain('activationCheck');
  });
  it('asks Cloudflare to re-check once the nameservers point at it', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_PENDING });
    const p = await advance(row(), { cf, ns: async () => ['bob.ns.cloudflare.com', 'ana.ns.cloudflare.com'], probe: okProbe });
    expect(log).toContain('activationCheck');
    expect(p).toMatchObject({ stage: 'nameservers', next_check_seconds: 120 });
  });
  it('says so when the domain has no delegation', async () => {
    const { cf } = fakeCf({ zone: ZONE_PENDING });
    const p = await advance(row(), { cf, ns: async () => [], probe: okProbe });
    expect(String(p.last_error)).toMatch(/no nameservers/);
  });
  it('attaches apex + www and goes live when HTTPS answers for this brand', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE });
    const p = await advance(row(), { cf, ns: async () => null, probe: okProbe });
    expect(log).toEqual(expect.arrayContaining(['attach lucky.co.ke', 'attach www.lucky.co.ke']));
    expect(p).toMatchObject({ stage: 'live', https_ok: true, worker_domains: { 'lucky.co.ke': 'wd-lucky.co.ke', 'www.lucky.co.ke': 'wd-www.lucky.co.ke' } });
  });
  it('a subdomain attaches only itself', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE });
    await advance(row({ hostname: 'play.lucky.co.ke', include_www: true }), { cf, ns: async () => null, probe: okProbe });
    expect(log.filter((l) => l.startsWith('attach'))).toEqual(['attach play.lucky.co.ke']);
  });
  it('is idempotent: already attached → no new attach', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE, attached: [
      { id: 'x1', hostname: 'lucky.co.ke', service: 'aviatorv2', zone_id: 'z1' }, { id: 'x2', hostname: 'www.lucky.co.ke', service: 'aviatorv2', zone_id: 'z1' }] });
    const p = await advance(row(), { cf, ns: async () => null, probe: okProbe });
    expect(log.filter((l) => l.startsWith('attach'))).toEqual([]);
    expect(p).toMatchObject({ stage: 'live', worker_domains: { 'lucky.co.ke': 'x1', 'www.lucky.co.ke': 'x2' } });
  });
  it('refuses a hostname that belongs to another Worker', async () => {
    const { cf } = fakeCf({ zone: ZONE_ACTIVE, attached: [{ id: 'x1', hostname: 'lucky.co.ke', service: 'other', zone_id: 'z1' }] });
    const p = await advance(row(), { cf, ns: async () => null, probe: okProbe });
    expect(p).toMatchObject({ stage: 'error' });
    expect(String(p.last_error)).toMatch(/another Worker \("other"\)/);
  });
  it('stops on existing DNS records and lists them', async () => {
    const { cf } = fakeCf({ zone: ZONE_ACTIVE,
      attachError: (h) => (h === 'lucky.co.ke' ? new CfError('Hostname already has externally managed DNS records', 409, [100117]) : null),
      records: [{ id: 'r1', type: 'A', name: 'lucky.co.ke', content: '1.2.3.4' }, { id: 'r2', type: 'MX', name: 'lucky.co.ke', content: 'mx' }] });
    const p = await advance(row(), { cf, ns: async () => null, probe: okProbe });
    expect(p).toMatchObject({ stage: 'conflict', conflict_records: [{ id: 'r1', type: 'A', name: 'lucky.co.ke', content: '1.2.3.4' }] });
  });
  it('replace deletes only the listed A/AAAA/CNAME records of wanted hosts, then attaches', async () => {
    let blocked = true;
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE, attachError: () => (blocked ? new CfError('externally managed DNS records', 409, [100117]) : null) });
    const d = row({ zone_id: 'z1', conflict_records: [
      { id: 'r1', type: 'A', name: 'lucky.co.ke', content: '1.2.3.4' },
      { id: 'r9', type: 'A', name: 'mail.lucky.co.ke', content: '9.9.9.9' },     // not a wanted host: kept
      { id: 'r2', type: 'MX', name: 'lucky.co.ke', content: 'mx' }] });          // not A/AAAA/CNAME: kept
    blocked = false;
    const p = await replaceConflicts(d, { cf, ns: async () => null, probe: okProbe });
    expect(log.filter((l) => l.startsWith('deleteDns'))).toEqual(['deleteDns r1']);
    expect(p.stage).toBe('live');
  });
  it('waits for the certificate while HTTPS fails', async () => {
    const { cf } = fakeCf({ zone: ZONE_ACTIVE });
    const p = await advance(row(), { cf, ns: async () => null, probe: async () => ({ ok: false, error: 'handshake failure' }) });
    expect(p).toMatchObject({ stage: 'ssl', ssl_status: 'issuing', next_check_seconds: 120 });
  });
  it('flags a domain that answers for another brand', async () => {
    const { cf } = fakeCf({ zone: ZONE_ACTIVE });
    const p = await advance(row(), { cf, ns: async () => null, probe: async () => ({ ok: true, siteId: 'someone-else' }) });
    expect(p.stage).toBe('error');
  });
  it('detaches www when it is no longer wanted', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE, attached: [{ id: 'x1', hostname: 'lucky.co.ke', service: 'aviatorv2', zone_id: 'z1' }] });
    await advance(row({ include_www: false, worker_domains: { 'lucky.co.ke': 'x1', 'www.lucky.co.ke': 'x2' } }), { cf, ns: async () => null, probe: okProbe });
    expect(log).toContain('detach x2');
  });
  it('zone errors become plain words', async () => {
    const { cf } = fakeCf({ zone: null, createZone: () => { throw new CfError('invalid domain', 400, [1099]); } });
    const p = await advance(row(), { cf, ns: async () => null, probe: okProbe });
    expect(p).toMatchObject({ stage: 'error' });
    expect(String(p.last_error)).toMatch(/not a registered domain/);
  });
  it('detachAll removes stored and looked-up attachments', async () => {
    const { cf, log } = fakeCf({ zone: ZONE_ACTIVE, attached: [{ id: 'x2', hostname: 'www.lucky.co.ke', service: 'aviatorv2', zone_id: 'z1' }] });
    const done = await detachAll(row({ worker_domains: { 'lucky.co.ke': 'x1' } }), cf);
    expect(log).toEqual(expect.arrayContaining(['detach x1', 'detach x2']));
    expect(done.sort()).toEqual(['lucky.co.ke', 'www.lucky.co.ke']);
  });
});

describe('Cloudflare client', () => {
  it('sends the documented requests', async () => {
    const calls: { url: string; method?: string; body?: string; auth?: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string, auth: (init?.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ success: true, result: url.includes('/zones?') ? [] : { id: 'x', hostname: 'h' } }));
    };
    const cf = cloudflare({ token: 'tok', accountId: 'acc', service: 'aviatorv2' }, f);
    await cf.findZone('lucky.co.ke');
    await cf.attach('lucky.co.ke', 'z1');
    await cf.createZone('lucky.co.ke');
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/zones?name=lucky.co.ke&account.id=acc&per_page=5');
    expect(calls[1]).toMatchObject({ url: 'https://api.cloudflare.com/client/v4/accounts/acc/workers/domains', method: 'PUT', auth: 'Bearer tok' });
    expect(JSON.parse(calls[1].body!)).toEqual({ hostname: 'lucky.co.ke', service: 'aviatorv2', zone_id: 'z1', environment: 'production' });
    expect(JSON.parse(calls[2].body!)).toEqual({ name: 'lucky.co.ke', account: { id: 'acc' }, type: 'full' });
  });
  it('turns Cloudflare errors into CfError with codes, and explains them', async () => {
    const f = async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 });
    const cf = cloudflare({ token: 'tok', accountId: 'acc', service: 's' }, f);
    const e = await cf.createZone('x.com').catch((x) => x);
    expect(e).toBeInstanceOf(CfError);
    expect(e.codes).toEqual([10000]);
    expect(explain(e)).toMatch(/Workers Scripts · Edit/);
  });
  it('never puts the token in an error message', async () => {
    const f = async () => { throw new Error('network down'); };
    const e = await cloudflare({ token: 'SECRET-TOKEN', accountId: 'acc', service: 's' }, f).findZone('x.com').catch((x) => x);
    expect(String(e.message)).not.toContain('SECRET-TOKEN');
  });
  it('reads nameservers from DNS-over-HTTPS', async () => {
    const f = async () => new Response(JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'B.ns.cloudflare.com.' }, { type: 2, data: 'a.ns.cloudflare.com.' }] }));
    expect(await lookupNs('x.com', f)).toEqual(['a.ns.cloudflare.com', 'b.ns.cloudflare.com']);
    const nx = async () => new Response(JSON.stringify({ Status: 3 }));
    expect(await lookupNs('x.com', nx)).toEqual([]);
  });
});
