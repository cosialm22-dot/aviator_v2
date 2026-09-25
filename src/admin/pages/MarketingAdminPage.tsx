import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { PageHeader, Tabs } from '../ui/kit';
import { TabActionsSlot } from './marketing/shared';
import OverviewTab from './marketing/OverviewTab';
import AffiliatesTab from './marketing/AffiliatesTab';
import PromotionsTab from './marketing/PromotionsTab';
import CommissionsPage from './CommissionsPage';

// ============================================================================
// MarketingAdminPage - the admin/super_admin Marketing hub. A single page with
// four tabs that consolidates the whole marketing surface:
//   * Overview     - affiliate-program KPIs + program settings (rate, qualifying deposit)
//   * Affiliates   - manage marketers and inspect their referrals
//   * Promotions   - CRUD over the promotions catalogue
//   * Commissions  - the existing payout review queue (reused as-is)
// The active tab is held in the URL (?tab=) so it is deep-linkable and survives
// refresh. Marketers never reach this page (the operator admin panel is
// operators-only); they use the /marketer hub in the player shell. All
// authorisation is enforced server-side.
// ============================================================================

const TABS = [
  { k: 'overview', label: 'Overview' },
  { k: 'affiliates', label: 'Affiliates' },
  { k: 'promotions', label: 'Promotions' },
  { k: 'commissions', label: 'Commissions' },
] as const;

type TabKey = (typeof TABS)[number]['k'];
const TAB_KEYS = TABS.map(t => t.k) as readonly string[];
const TAB_ITEMS = TABS.map(t => ({ value: t.k as TabKey, label: t.label }));

export default function MarketingAdminPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'overview';
  const tab: TabKey = (TAB_KEYS.includes(raw) ? raw : 'overview') as TabKey;

  const setTab = (k: TabKey) => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.set('tab', k);
    return next;
  }, { replace: true });

  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Marketing" subtitle="Affiliate program, marketers, promotions, and commission payouts" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<TabKey> tabs={TAB_ITEMS} value={tab} onChange={setTab} label="Marketing sections" />
        <div ref={setSlot} className="flex items-center gap-2" />
      </div>

      <TabActionsSlot.Provider value={slot}>
      <div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'affiliates' && <AffiliatesTab />}
        {tab === 'promotions' && <PromotionsTab />}
        {tab === 'commissions' && <CommissionsPage embedded />}
      </div>
      </TabActionsSlot.Provider>
    </div>
  );
}
