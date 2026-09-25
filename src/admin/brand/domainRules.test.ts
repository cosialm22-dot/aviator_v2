import { describe, expect, it } from 'vitest';
import { normalizeHost, nsMatch, registrarOf, stageText, stepIndex } from './domainRules';

describe('domain rules (mirror of public._domain_normalize)', () => {
  it('cleans what operators paste', () => {
    expect(normalizeHost(' https://WWW.Lucky.co.ke:443/path?q=1 ')).toBe('lucky.co.ke');
    expect(normalizeHost('play.lucky.com.')).toBe('play.lucky.com');
    expect(normalizeHost('user@lucky.com')).toBe('lucky.com');
  });
  it('refuses what the server refuses', () => {
    for (const bad of ['', 'nodot', '1.2.3.4', 'a..b.com', '-bad.com', 'x.workers.dev', 'x.pages.dev', 'x.supabase.co', 'x.localhost', 'x.test', `${'a'.repeat(64)}.com`, 'bad_char.com'])
      expect(normalizeHost(bad), bad).toBeNull();
  });
  it('accepts punycode TLDs', () => { expect(normalizeHost('shop.xn--p1ai')).toBe('shop.xn--p1ai'); });
});

describe('domain progress', () => {
  it('maps stages to the five steps', () => {
    expect(stepIndex({ stage: 'queued', zone_status: null, worker_status: null })).toBe(0);
    expect(stepIndex({ stage: 'nameservers', zone_status: 'pending', worker_status: null })).toBe(1);
    expect(stepIndex({ stage: 'conflict', zone_status: 'active', worker_status: 'conflict' })).toBe(2);
    expect(stepIndex({ stage: 'ssl', zone_status: 'active', worker_status: 'active' })).toBe(3);
    expect(stepIndex({ stage: 'live', zone_status: 'active', worker_status: 'active' })).toBe(4);
  });
  it('an error sits on the step that failed', () => {
    expect(stepIndex({ stage: 'error', zone_status: null, worker_status: null })).toBe(0);
    expect(stepIndex({ stage: 'error', zone_status: 'pending', worker_status: null })).toBe(1);
    expect(stepIndex({ stage: 'error', zone_status: 'active', worker_status: null })).toBe(2);
  });
  it('labels', () => {
    expect(stageText({ stage: 'live', managed: true }).tone).toBe('up');
    expect(stageText({ stage: 'queued', managed: false }).text).toBe('Connected by hand');
    expect(stageText({ stage: 'conflict', managed: true }).tone).toBe('down');
  });
  it('nameserver match ignores order and case', () => {
    expect(nsMatch({ nameservers: ['a.ns.cloudflare.com', 'B.ns.cloudflare.com'], ns_current: ['b.ns.cloudflare.com', 'a.ns.cloudflare.com'] })).toBe(true);
    expect(nsMatch({ nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'], ns_current: ['a.ns.cloudflare.com'] })).toBe(false);
    expect(nsMatch({ nameservers: [], ns_current: [] })).toBe(false);
  });
  it('recognises the registrar from its nameservers', () => {
    expect(registrarOf(['dns1.registrar-servers.com'])).toBe('namecheap');
    expect(registrarOf(['ns01.domaincontrol.com'])).toBe('godaddy');
    expect(registrarOf(['x.ns.cloudflare.com'])).toBe('cloudflare');
    expect(registrarOf(['ns1.other.net'])).toBe('other');
    expect(registrarOf([])).toBeNull();
  });
});
