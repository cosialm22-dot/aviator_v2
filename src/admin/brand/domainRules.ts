// Pure display + validation helpers for the Domains tab (unit-tested in domainRules.test.ts).
import type { Domain, DomainStage } from './domainsApi';

export const STEPS: { stage: DomainStage[]; label: string }[] = [
  { stage: ['queued', 'zone'], label: 'Added' },
  { stage: ['nameservers'], label: 'Nameservers' },
  { stage: ['attaching', 'conflict'], label: 'Connected' },
  { stage: ['ssl'], label: 'HTTPS' },
  { stage: ['live'], label: 'Live' },
];
/** Index of the current step (0..4); an error sits on the step it failed at. */
export function stepIndex(d: Pick<Domain, 'stage' | 'zone_status' | 'worker_status'>): number {
  if (d.stage === 'error') return d.worker_status ? 2 : d.zone_status && d.zone_status !== 'active' ? 1 : d.zone_status === 'active' ? 2 : 0;
  return Math.max(0, STEPS.findIndex((s) => s.stage.includes(d.stage)));
}
export function stageText(d: Pick<Domain, 'stage' | 'managed'>): { text: string; tone: 'up' | 'warn' | 'down' | 'muted' } {
  if (!d.managed) return { text: 'Connected by hand', tone: 'up' };
  switch (d.stage) {
    case 'live': return { text: 'Live', tone: 'up' };
    case 'queued': case 'zone': return { text: 'Setting up', tone: 'muted' };
    case 'nameservers': return { text: 'Waiting for nameservers', tone: 'warn' };
    case 'attaching': return { text: 'Connecting', tone: 'warn' };
    case 'conflict': return { text: 'DNS records in the way', tone: 'down' };
    case 'ssl': return { text: 'Issuing HTTPS certificate', tone: 'warn' };
    default: return { text: 'Needs attention', tone: 'down' };
  }
}
/** Do the domain's live nameservers equal the ones Cloudflare assigned? */
export function nsMatch(d: Pick<Domain, 'nameservers' | 'ns_current'>): boolean {
  const a = (d.nameservers ?? []).map((x) => x.toLowerCase()).sort();
  const b = (d.ns_current ?? []).map((x) => x.toLowerCase()).sort();
  return a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);
}
/** Which registrar the current nameservers belong to (for the guide). */
export function registrarOf(ns: string[] | null | undefined): 'namecheap' | 'godaddy' | 'cloudflare' | 'other' | null {
  if (!ns || ns.length === 0) return null;
  const s = ns.join(' ');
  if (/registrar-servers\.com/.test(s)) return 'namecheap';
  if (/domaincontrol\.com/.test(s)) return 'godaddy';
  if (/ns\.cloudflare\.com/.test(s)) return 'cloudflare';
  return 'other';
}
/** Mirror of public._domain_normalize: what the server will store for what was typed (null = refused). */
export function normalizeHost(input: string): string | null {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:[0-9]*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (!h || h.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(h)) return null;
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(h.split('.').pop()!)) return null;
  if (/(^|\.)(workers\.dev|pages\.dev|supabase\.co|supabase\.in|cloudflare\.com|localhost|local|test|example|invalid)$/.test(h)) return null;
  return h;
}
