import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Globe, RefreshCw, Star, X } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorState, Notice, Pills, Skeleton, Switch, inputCls } from '../ui/kit';
import { dateTime, relTime } from '../ui/format';
import { useAdmin } from '../roleContext';
import { brandError } from './api';
import {
  addDomain, addManualDomain, adoptDomain, checkDomain, listDomains, normalizeHost, nsMatch, registrarOf, removeDomain, replaceRecords,
  stageText, stepIndex, STEPS, unassignedDomains, updateDomain, type Domain, type DomainsDoc,
} from './domainsApi';
import type { BrandDraft } from './useBrandDraft';
import { apexOf } from '../../../supabase/functions/_shared/domains';

// ============================================================================
// Domains — every brand gets its own address. Adding a domain creates its Cloudflare zone, tells
// the operator which two nameservers to set at the registrar (Namecheap guide below), then connects
// the domain to the app and waits for HTTPS — all automatic, re-checked every 5 minutes by the
// server (brand-domains edge function + pg_cron). invest254 docs/21 step 4, automated.
// ============================================================================
type Msg = { tone: 'ok' | 'error' | 'warn'; text: string } | null;

export default function DomainsTab({ draft }: { draft: BrandDraft }) {
  const site = draft.doc!.site_id;
  const me = useAdmin();
  const [doc, setDoc] = useState<DomainsDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => {
    try { setDoc(await listDomains(site)); setErr(null); } catch (e) { setErr(brandError(e)); }
  }, [site]);
  useEffect(() => { void load(); }, [load]);
  // Watch pending domains: the server advances them; refresh the view while the page is visible.
  const pending = !!doc?.domains.some((d) => d.managed && d.stage !== 'live');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    return () => clearInterval(t);
  }, [pending, load]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!doc) return <Skeleton className="h-40 w-full" />;
  const replace = (d: Domain) => setDoc((x) => x && ({ ...x, domains: x.domains.map((y) => (y.hostname === d.hostname ? d : y)) }));

  return (
    <div className="space-y-4" data-testid="domains-tab">
      {!doc.automation && (
        <Notice tone="warn">
          Domain automation is not set up, so new domains are saved but not connected.{' '}
          {me.isPlatform ? <Link to="/admin/integrations" className="font-medium underline">Set up Cloudflare</Link> : 'Ask the System owner to set up Cloudflare.'}
        </Notice>
      )}
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {doc.can_manage && <AddDomain site={site} automation={doc.automation} owner={me.isPlatform} onAdded={(t) => { setMsg(t); void load(); void draft.reload(); }} />}

      {doc.domains.length === 0
        ? <Card><Empty icon={<Globe size={20} />} title="No domain yet" body={doc.can_manage ? 'Add the domain this brand\'s marketer will share. Players on it see this brand\'s look.' : 'The platform will connect this brand\'s domain.'} /></Card>
        : doc.domains.map((d) => (
          <DomainCard key={d.hostname} d={d} canManage={doc.can_manage} automation={doc.automation}
            onChange={(x) => { replace(x); void draft.reload(); }}
            onRemoved={(t) => { setMsg({ tone: 'ok', text: t }); void load(); void draft.reload(); }}
            onMessage={setMsg} reload={load} />
        ))}

      {me.isPlatform && doc.automation && doc.can_manage && <Unassigned site={site} onAdopted={(t) => { setMsg({ tone: 'ok', text: t }); void load(); void draft.reload(); }} />}
    </div>
  );
}

// ── add ─────────────────────────────────────────────────────────────────────────────────────────
function AddDomain({ site, automation, owner, onAdded }: { site: string; automation: boolean; owner: boolean; onAdded: (m: Msg) => void }) {
  const [host, setHost] = useState('');
  const [www, setWww] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const clean = normalizeHost(host);
  const isSub = !!clean && apexOf(clean) !== clean;
  const submit = async () => {
    if (!clean) { setErr('Enter a domain like mybrand.com'); return; }
    setBusy(true); setErr(null);
    try {
      if (manual) {
        await addManualDomain(site, clean, www && !isSub);
        onAdded({ tone: 'ok', text: `${clean} recorded as connected by hand.` });
      } else {
        const r = await addDomain(site, clean, www && !isSub);
        onAdded(r.automation
          ? { tone: r.domain.stage === 'error' ? 'error' : 'ok', text: r.domain.stage === 'error' ? `${clean} was added, but: ${r.domain.last_error}` : `${clean} added. Follow the steps on its card.` }
          : { tone: 'warn', text: r.message ?? `${clean} saved.` });
      }
      setHost(''); setManual(false);
    } catch (e) { setErr(brandError(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="Add a domain">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-[12px] text-muted">Domain</span>
          <input value={host} onChange={(e) => { setHost(e.target.value); setErr(null); }} placeholder="mybrand.com" className={`${inputCls} font-mono`}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} data-testid="domain-input" aria-label="Domain" />
        </label>
        <Button variant="primary" type="submit" loading={busy} disabled={!host.trim()} data-testid="domain-add">{manual ? 'Record' : 'Add domain'}</Button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
        {!isSub && <label className="flex items-center gap-2"><input type="checkbox" checked={www} onChange={(e) => setWww(e.target.checked)} data-testid="domain-www" />Also connect www.{clean ?? 'mybrand.com'}</label>}
        {host.trim() && (clean ? <span>Will connect <b className="font-mono text-ink">{clean}</b>{!isSub && www ? <> and <b className="font-mono text-ink">www.{clean}</b></> : null}</span>
          : <span className="text-down">Not a domain we can serve.</span>)}
      </div>
      {!automation && !manual && <p className="mt-2 text-[12px] text-faint">Without Cloudflare set up, the domain is only saved.</p>}
      {owner && (
        <label className="mt-3 flex items-center gap-2 text-[12px] text-faint">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} data-testid="domain-manual" />
          Already connected to the app by hand (skip automation)
        </label>
      )}
      {err && <p className="mt-2 text-[12px] text-down" role="alert">{err}</p>}
    </Card>
  );
}

// ── one domain ──────────────────────────────────────────────────────────────────────────────────
function DomainCard({ d, canManage, automation, onChange, onRemoved, onMessage, reload }: {
  d: Domain; canManage: boolean; automation: boolean; onChange: (d: Domain) => void; onRemoved: (t: string) => void; onMessage: (m: Msg) => void; reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const st = stageText(d);
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); onMessage(null);
    try { await fn(); } catch (e) { onMessage({ tone: 'error', text: `${d.hostname}: ${brandError(e)}` }); await reload(); } finally { setBusy(null); }
  };
  const set = (patch: Parameters<typeof updateDomain>[1]) => act('opt', async () => onChange(await updateDomain(d.hostname, patch)));
  const isApex = d.hostname === d.apex;
  const hosts = [d.hostname, ...(d.include_www && isApex ? [`www.${d.hostname}`] : [])];

  return (
    <Card testId={`domain-${d.hostname}`}
      title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{d.hostname}</span>{d.is_primary && <Badge tone="brand"><Star size={10} />Primary</Badge>}</span>}
      action={<Badge tone={st.tone}>{st.text}</Badge>}>
      {d.managed && <Stepper d={d} />}

      {d.managed && d.stage === 'nameservers' && <NameserverGuide d={d} />}
      {d.stage === 'conflict' && (
        <div className="mt-3 rounded-lg border border-down/30 bg-down/5 p-3 text-[13px]">
          <p className="text-ink">These DNS records sit on the address the app needs. Replacing them points the address at this brand (email records are kept).</p>
          <ul className="mt-2 space-y-1 font-mono text-[12px] text-muted">
            {(d.conflict_records ?? []).map((r) => <li key={r.id}>{r.type} {r.name} → {r.content}</li>)}
          </ul>
          {canManage && <div className="mt-2"><ConfirmButton testId={`replace-${d.hostname}`} confirmLabel="Replace them" variant="danger" onConfirm={() => act('replace', async () => onChange((await replaceRecords(d.hostname)).domain))}>Replace these records</ConfirmButton></div>}
        </div>
      )}
      {d.stage === 'ssl' && <p className="mt-3 text-[13px] text-muted">Connected. Cloudflare is issuing the HTTPS certificate, usually within 2–15 minutes.</p>}
      {d.stage === 'error' && d.last_error && <div className="mt-3"><Notice tone="error">{d.last_error}</Notice></div>}
      {d.stage !== 'error' && d.stage !== 'conflict' && d.last_error && d.stage !== 'ssl' && <p className="mt-2 text-[12px] text-warn">{d.last_error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
        {hosts.map((h) => (
          <a key={h} href={`https://${h}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-muted hover:text-ink">{h}<ExternalLink size={11} /></a>
        ))}
        {d.stage === 'live' && d.activated_at && <span>Live since {dateTime(d.activated_at)}</span>}
        {d.last_checked_at && <span title={dateTime(d.last_checked_at)}>Checked {relTime(d.last_checked_at)}</span>}
        {d.managed && d.stage !== 'live' && automation && <span>Next automatic check around {new Date(d.next_check_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {canManage && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {isApex && <Switch label={`Also serve www.${d.hostname}`} checked={d.include_www} onChange={(v) => set({ include_www: v })} disabled={!!busy} testId={`opt-www-${d.hostname}`} />}
          {isApex && d.include_www && <Switch label={`Send www.${d.hostname} to ${d.hostname}`} checked={d.www_redirect} onChange={(v) => set({ www_redirect: v })} disabled={!!busy} testId={`opt-wwwredir-${d.hostname}`} />}
          {!d.is_primary && <Switch label="Send visitors to the primary domain" checked={d.redirect_to_primary} onChange={(v) => set({ redirect_to_primary: v })} disabled={!!busy} testId={`opt-primary-redir-${d.hostname}`} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {d.managed && automation && <Button size="sm" loading={busy === 'check'} onClick={() => act('check', async () => { const r = await checkDomain(d.hostname); onChange(r.domain); })} data-testid={`check-${d.hostname}`}><RefreshCw size={13} />Check now</Button>}
            {!d.is_primary && <Button size="sm" disabled={!!busy} onClick={() => set({ is_primary: true })} data-testid={`primary-${d.hostname}`}><Star size={13} />Make primary</Button>}
            <span className="flex-1" />
            <ConfirmButton testId={`remove-${d.hostname}`} confirmLabel="Remove domain" disabled={!!busy}
              onConfirm={() => act('remove', async () => { const r = await removeDomain(d.hostname); onRemoved(`${r.removed} removed${r.detached.length ? ' and disconnected from the app' : ''}. Its Cloudflare zone and your email records are left as they were.`); })}>Remove</ConfirmButton>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stepper({ d }: { d: Domain }) {
  const at = stepIndex(d);
  const failed = d.stage === 'error' || d.stage === 'conflict';
  return (
    <ol className="flex items-center gap-1" aria-label="Progress" data-testid={`steps-${d.hostname}`}>
      {STEPS.map((s, i) => {
        const done = i < at || d.stage === 'live';
        const cur = i === at && d.stage !== 'live';
        return (
          <li key={s.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" aria-current={cur ? 'step' : undefined}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${done ? 'bg-up text-white' : cur ? (failed ? 'bg-down text-white' : 'bg-warn text-black') : 'bg-raised text-faint'}`}>
              {done ? <Check size={12} /> : cur && failed ? <X size={12} /> : i + 1}
            </span>
            <span className={`truncate text-[11px] ${cur ? 'font-medium text-ink' : 'text-faint'}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── the registrar step, guided ──────────────────────────────────────────────────────────────────
function CopyBox({ value, testId }: { value: string; testId?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" data-testid={testId} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}
      className="flex w-full items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2 text-left font-mono text-[13px] text-ink hover:bg-raised/70" aria-label={`Copy ${value}`}>
      <span className="truncate">{value}</span>{ok ? <Check size={14} className="text-up" /> : <Copy size={14} className="text-faint" />}
    </button>
  );
}

type Registrar = 'namecheap' | 'godaddy' | 'other';
const GUIDES: Record<Registrar, string[]> = {
  namecheap: [
    'Sign in at namecheap.com → Domain List.',
    'Click Manage next to the domain.',
    'Under NAMESERVERS, choose Custom DNS.',
    'Paste the two nameservers shown above (one per line) and click the green ✓.',
    'If Advanced DNS → DNSSEC is on, turn it off first; it blocks the switch.',
  ],
  godaddy: [
    'Sign in at godaddy.com → My Products → Domains.',
    'Open the domain → DNS → Nameservers → Change nameservers.',
    'Choose "I\'ll use my own nameservers", enter the two shown above, and save.',
    'Turn DNSSEC off first if it is on.',
  ],
  other: [
    'Open the domain\'s settings at the company you bought it from.',
    'Find "Nameservers" (sometimes "DNS servers"), choose custom nameservers.',
    'Replace all existing ones with the two shown above, and save.',
    'Turn DNSSEC off first if it is on.',
  ],
};

function NameserverGuide({ d }: { d: Domain }) {
  const detected = registrarOf(d.ns_current);
  const [reg, setReg] = useState<Registrar>(detected === 'godaddy' ? 'godaddy' : detected === 'namecheap' || !detected ? 'namecheap' : 'other');
  const pointed = nsMatch(d);
  const assigned = useMemo(() => d.nameservers ?? [], [d.nameservers]);
  return (
    <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-3" data-testid={`ns-guide-${d.hostname}`}>
      <p className="text-[13px] font-medium text-ink">Point <span className="font-mono">{d.apex}</span> at Cloudflare</p>
      <p className="mt-0.5 text-[12px] text-muted">A one-time step at the company you bought the domain from. If the domain receives email, add its MX records in Cloudflare first: they are not copied over.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {assigned.map((n, i) => <CopyBox key={n} value={n} testId={`ns-${i}-${d.hostname}`} />)}
      </div>
      <div className="mt-3"><Pills label="Registrar" value={reg} onChange={setReg} items={[{ value: 'namecheap', label: 'Namecheap' }, { value: 'godaddy', label: 'GoDaddy' }, { value: 'other', label: 'Other' }]} /></div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-muted">{GUIDES[reg].map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="mt-3 text-[12px]">
        <span className="text-faint">Right now the domain uses: </span>
        {d.ns_current && d.ns_current.length > 0
          ? <span className={`font-mono ${pointed ? 'text-up' : 'text-ink'}`}>{d.ns_current.join(', ')}</span>
          : <span className="text-faint">no nameservers found yet</span>}
        {pointed
          ? <p className="mt-1 text-up">✓ The nameservers are set. Cloudflare activates the domain within minutes (rarely up to 24 hours).</p>
          : <p className="mt-1 text-faint">Changes usually show within an hour. We check every few minutes; nothing else to do.</p>}
      </div>
    </div>
  );
}

// ── owner: domains already on the app that no brand claims ────────────────────────────────────
function Unassigned({ site, onAdopted }: { site: string; onAdopted: (t: string) => void }) {
  const [rows, setRows] = useState<{ hostname: string; with_www: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const look = async () => { setErr(null); try { setRows((await unassignedDomains()).hosts); } catch (e) { setErr(brandError(e)); } };
  return (
    <Card title="Domains on the app without a brand" action={<Button size="sm" onClick={look} data-testid="find-unassigned">Look</Button>}>
      <p className="text-[12px] text-muted">Domains connected to the app's Worker in Cloudflare that no brand claims. They show the default brand until one does.</p>
      {err && <p className="mt-2 text-[12px] text-down">{err}</p>}
      {rows && (rows.length === 0 ? <p className="mt-2 text-[12px] text-faint">None.</p> : (
        <ul className="mt-2 divide-y divide-line/60">
          {rows.map((r) => (
            <li key={r.hostname} className="flex items-center gap-3 py-2">
              <span className="flex-1 font-mono text-[13px] text-ink">{r.hostname}{r.with_www && <span className="text-faint"> + www</span>}</span>
              <Button size="sm" loading={busy === r.hostname} data-testid={`adopt-${r.hostname}`}
                onClick={async () => { setBusy(r.hostname); try { await adoptDomain(site, r.hostname, r.with_www); onAdopted(`${r.hostname} now belongs to this brand.`); setRows((x) => x?.filter((y) => y.hostname !== r.hostname) ?? null); } catch (e) { setErr(brandError(e)); } finally { setBusy(null); } }}>
                Assign to this brand
              </Button>
            </li>
          ))}
        </ul>
      ))}
    </Card>
  );
}
