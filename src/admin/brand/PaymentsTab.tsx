import { Card } from '../ui/kit';
import { SettingsGrid } from './SettingField';
import type { BrandDraft } from './useBrandDraft';

// The M-Pesa account name payers see (per-brand gateway accounts: step 6).
export default function PaymentsTab({ draft }: { draft: BrandDraft }) {
  return <Card title="M-Pesa"><SettingsGrid draft={draft} sections={['payments']} /></Card>;
}
