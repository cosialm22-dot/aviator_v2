import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, Skeleton } from '../ui/kit';
import { brandError } from '../brand/api';
import IntegrationCard from '../brand/IntegrationCard';
import { listIntegrations, testCloudflare, type IntegrationsDoc } from '../brand/domainsApi';

// ============================================================================
// Integrations (System owner) — the provider accounts the platform runs on. Secrets are written
// to Supabase Vault and never read back to a browser; only the server functions use them.
// ============================================================================
const TESTS: Record<string, () => Promise<{ ok: boolean; message: string }>> = { cloudflare: testCloudflare };
// Payment gateways are managed on Payment accounts (with scopes and go-live), not here.
const PAYMENT_PROVIDERS = new Set(['megapay', 'mpesa_b2c']);

export default function IntegrationsPage() {
  const [doc, setDoc] = useState<IntegrationsDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setDoc(await listIntegrations('global', null)); setErr(null); } catch (e) { setErr(brandError(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-5">
      <PageHeader title="Integrations" subtitle={<>Infrastructure accounts the System runs on. Secrets are stored encrypted and are never shown again after saving. Payment gateways are under <Link to="/admin/payment-accounts" className="underline">Payment accounts</Link>.</>} />
      {err ? <ErrorState message={err} onRetry={load} /> : !doc ? <Skeleton className="h-48 w-full" /> : Object.entries(doc.catalog).filter(([p]) => !PAYMENT_PROVIDERS.has(p)).map(([p, entry]) => {
        const item = doc.items.find((i) => i.provider === p) ?? null;
        return <IntegrationCard key={`${p}-${item?.updated_at ?? 'new'}-${item?.tested_at ?? ''}`} provider={p} entry={entry} item={item} scope="global" scopeId={null} onSaved={load} onTest={TESTS[p]} />;
      })}
    </div>
  );
}
