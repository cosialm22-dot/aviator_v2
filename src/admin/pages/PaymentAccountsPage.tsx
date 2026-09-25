import { useEffect, useState } from 'react';
import { PageHeader, Select, Skeleton } from '../ui/kit';
import { useAdmin } from '../roleContext';
import { listPlatforms, type Platform } from '../brand/api';
import PaymentScopePanel, { type Scope } from '../brand/PaymentScopePanel';

// ============================================================================
// Payment accounts — the Mega Pay accounts deposits are paid into, per scope (invest254
// /platform/payment-accounts). The System owner sees the System's account and every platform's;
// a platform admin sees its own platform's. A single brand's own account is on its Payments tab.
// ============================================================================
export default function PaymentAccountsPage() {
  const me = useAdmin();
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [pick, setPick] = useState<string>(me.isPlatform ? 'global' : me.platformId ?? '');
  useEffect(() => {
    if (me.isPlatform) listPlatforms().then(setPlatforms).catch(() => setPlatforms([]));
    else setPlatforms([]);
  }, [me.isPlatform]);
  if (!platforms) return <Skeleton className="h-40 w-full" />;
  const kind: Scope = pick === 'global' ? 'global' : 'platform';
  const id = pick === 'global' ? null : pick;
  return (
    <div className="space-y-5">
      <PageHeader title="Payment accounts" subtitle="Which Mega Pay account players' deposits are paid into. Brands use the System's account unless their platform, or the brand itself, has its own live account."
        actions={me.isPlatform ? <Select label="Account of" value={pick} onChange={setPick} options={[{ value: 'global', label: 'The System' }, ...platforms.map((p) => ({ value: p.id, label: `Platform: ${p.name}` }))]} /> : undefined} />
      {id || kind === 'global' ? <PaymentScopePanel key={pick} kind={kind} id={id} /> : <p className="text-[13px] text-faint">Your account is not linked to a platform.</p>}
    </div>
  );
}
