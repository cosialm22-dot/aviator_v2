import { Card } from '../ui/kit';
import { SettingsGrid } from './SettingField';
import PaymentScopePanel from './PaymentScopePanel';
import type { BrandDraft } from './useBrandDraft';

// Payments for one brand: whose Mega Pay account its deposits go to (its own / its platform's /
// the System's), the brand's own account and go-live switch, and what payers see on the prompt.
// Limits (deposit / withdrawal amounts) are on the Limits & bonuses tab.
export default function PaymentsTab({ draft }: { draft: BrandDraft }) {
  return (
    <div className="space-y-4">
      <Card title="On the M-Pesa prompt"><SettingsGrid draft={draft} sections={['payments']} /></Card>
      <PaymentScopePanel kind="site" id={draft.doc!.site_id} />
    </div>
  );
}
