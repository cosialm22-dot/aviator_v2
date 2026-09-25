import { useCallback, useEffect, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, ConfirmButton, ErrorState, Notice, Skeleton } from '../ui/kit';
import { relTime } from '../ui/format';
import { brandError } from './api';
import IntegrationCard from './IntegrationCard';
import { listIntegrations, type IntegrationsDoc } from './domainsApi';

// ============================================================================
// Payment scopes (invest254 docs/43, PAY-1): whose Mega Pay account a brand's deposits go to.
// A brand's payment owner = its own account if live → its platform's if live → the System's.
// One panel for a brand (site) or a platform scope: the account, the go-live switch with its
// requirements, and (platform) where each of its brands' money goes today.
// ============================================================================
export type Scope = 'global' | 'platform' | 'site';
export interface Owner { kind: Scope; id: string | null; key: string; name: string }
export interface PaymentOverview {
  scope: string; can_manage: boolean; active: boolean; changed_at: string | null; changed_by: string | null;
  account: { id: string; enabled: boolean; complete: boolean; test_ok: boolean | null; env: string | null; email_hint: string | null } | null;
  owner?: Owner; ready?: boolean; platform?: { id: string; name: string; active: boolean } | null;
  brands?: { site_id: string; name: string; owner: Owner; ready: boolean }[];
  live_scopes?: { scope: string; kind: Scope; id: string; name: string; changed_at: string }[];
}

export const paymentOverview = async (kind: Scope, id: string | null) => {
  const { data, error } = await supabase.rpc('admin_payment_overview', { p_kind: kind, p_id: id });
  if (error) throw new Error(error.message);
  return data as PaymentOverview;
};
const setLive = async (kind: Scope, id: string, active: boolean) => {
  const { data, error } = await supabase.rpc('admin_payment_scope_set', { p_kind: kind, p_id: id, p_active: active });
  if (error) throw new Error(error.message);
  return data as PaymentOverview;
};
const testAt = async (kind: Scope, id: string | null) => {
  const { data, error } = await supabase.functions.invoke('megapay-admin', { body: { action: 'test', scope_kind: kind, scope_id: id } });
  if (error) {
    let j: { error?: string } | null = null;
    try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
    throw new Error(j?.error ?? (error as Error).message);
  }
  const r = data as { test?: { ok: boolean; message: string } };
  return r.test ?? { ok: false, message: 'No answer from the test.' };
};

export function OwnerBadge({ owner }: { owner: Owner }) {
  return <Badge tone={owner.kind === 'global' ? 'muted' : 'brand'}>{owner.kind === 'global' ? 'System account' : owner.kind === 'platform' ? `${owner.name} (platform)` : `${owner.name}'s own`}</Badge>;
}

export default function PaymentScopePanel({ kind, id }: { kind: Scope; id: string | null }) {
  const [ov, setOv] = useState<PaymentOverview | null>(null);
  const [ints, setInts] = useState<IntegrationsDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const o = await paymentOverview(kind, id);
      setOv(o);
      setInts(o.can_manage ? await listIntegrations(kind, id) : null);
      setErr(null);
    } catch (e) { setErr(brandError(e)); }
  }, [kind, id]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!ov) return <Skeleton className="h-40 w-full" />;
  const entry = ints?.catalog.megapay;
  const item = ints?.items.find((i) => i.provider === 'megapay') ?? null;
  const reqs = [
    { ok: !!ov.account?.complete, text: 'A complete Mega Pay account is saved and switched on' },
    { ok: ov.account?.test_ok === true, text: 'Its connection test passed (after the last change)' },
    { ok: !!ov.account && ov.account.env !== 'sandbox', text: 'It is a production account' },
  ];
  const canGoLive = reqs.every((r) => r.ok);

  return (
    <div className="space-y-4" data-testid={`payments-${kind}`}>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      {kind === 'site' && ov.owner && (
        <Card title="Where this brand's deposits go" testId="payment-owner">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <OwnerBadge owner={ov.owner} />
            {ov.ready ? <span className="text-up">Deposits are open.</span> : <span className="text-down">Deposits are off: the account is not usable.</span>}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Order: this brand's own account when it is live, else {ov.platform ? <>the platform <b>{ov.platform.name}</b>'s account when it is live ({ov.platform.active ? 'it is' : 'it is not'})</> : 'its platform\'s account when live'}, else the System's account.
            Deposits already made keep being checked with the account they were paid into.
          </p>
        </Card>
      )}

      {kind === 'global' && (
        <Notice tone="info">With no account saved here, the System uses the Mega Pay key in the server settings (today's setup). Saving one here replaces it for every brand that uses the System's account.</Notice>
      )}

      {entry && (
        <IntegrationCard key={`${item?.id ?? 'new'}-${item?.updated_at ?? ''}-${item?.tested_at ?? ''}`} provider="megapay" entry={entry} item={item} scope={kind} scopeId={id}
          onSaved={load} onTest={() => testAt(kind, id)} testIdPrefix={`int-megapay-${kind}`} />
      )}
      {!ov.can_manage && ov.account && (
        <Card title="Mega Pay account">
          <p className="text-[13px] text-muted">{ov.account.email_hint} · {ov.account.env} · {ov.account.test_ok ? 'tested' : 'not tested'}</p>
        </Card>
      )}

      {kind !== 'global' && (
        <Card title="Go live" testId="go-live"
          action={<Badge tone={ov.active ? 'up' : 'muted'}>{ov.active ? 'Live' : 'Draft'}</Badge>}>
          <p className="text-[13px] text-muted">
            {ov.active
              ? <>Deposits for {kind === 'site' ? 'this brand' : 'this platform\'s brands (except brands with their own live account)'} go to this account{ov.changed_at ? <> since {relTime(ov.changed_at)}{ov.changed_by ? ` (${ov.changed_by})` : ''}</> : null}.</>
              : <>Until it is live, this account is a draft: saved and testable, never used for real deposits.</>}
          </p>
          {!ov.active && (
            <ul className="mt-3 space-y-1 text-[13px]">
              {reqs.map((r) => <li key={r.text} className={`flex items-center gap-2 ${r.ok ? 'text-up' : 'text-faint'}`}>{r.ok ? <Check size={14} /> : <Minus size={14} />}{r.text}</li>)}
            </ul>
          )}
          {ov.can_manage && id && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ov.active
                ? <ConfirmButton testId="go-live-off" confirmLabel="Stop using it" onConfirm={async () => { try { setOv(await setLive(kind, id, false)); setMsg({ tone: 'ok', text: 'Stopped. New deposits go to the next account in line.' }); } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } }}>Stop using this account</ConfirmButton>
                : <ConfirmButton testId="go-live-on" variant="primary" disabled={!canGoLive} confirmLabel="Go live now" onConfirm={async () => { try { setOv(await setLive(kind, id, true)); setMsg({ tone: 'ok', text: 'Live. New deposits go to this account.' }); } catch (e) { setMsg({ tone: 'error', text: brandError(e) }); } }}>Go live</ConfirmButton>}
              {!ov.active && !canGoLive && <span className="text-[12px] text-faint">Finish the steps above first.</span>}
            </div>
          )}
        </Card>
      )}

      {kind === 'platform' && ov.brands && (
        <Card title="This platform's brands" testId="platform-brands">
          {ov.brands.length === 0 ? <p className="text-[13px] text-faint">No brands yet.</p> : (
            <ul className="divide-y divide-line/60">
              {ov.brands.map((b) => (
                <li key={b.site_id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="flex-1 text-ink">{b.name}</span><OwnerBadge owner={b.owner} />
                  {!b.ready && <Badge tone="down">Deposits off</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {kind === 'global' && ov.live_scopes && (
        <Card title="Brands and platforms with their own live account">
          {ov.live_scopes.length === 0 ? <p className="text-[13px] text-faint">None: every brand uses the System's account.</p> : (
            <ul className="divide-y divide-line/60">
              {ov.live_scopes.map((s) => <li key={s.scope} className="flex items-center gap-3 py-2 text-[13px]"><span className="flex-1 text-ink">{s.name}</span><Badge>{s.kind}</Badge><span className="text-faint">{relTime(s.changed_at)}</span></li>)}
            </ul>
          )}
        </Card>
      )}
      <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>
    </div>
  );
}
