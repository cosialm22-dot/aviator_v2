import { Card } from '../ui/kit';
import type { BrandDraft } from './useBrandDraft';

// Domains of this brand (automation: attach, DNS and SSL status — see DomainsTab in step 5).
export default function DomainsTab({ draft }: { draft: BrandDraft }) {
  const d = draft.doc!.domains;
  return <Card title="Domains">{d.length ? d.map((x) => <div key={x.hostname} className="text-[13px] text-ink">{x.hostname}</div>) : <p className="text-[13px] text-muted">No domain yet.</p>}</Card>;
}
