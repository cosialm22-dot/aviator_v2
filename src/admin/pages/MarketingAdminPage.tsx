import { useSearchParams } from 'react-router-dom';
import { BarChart3, Users, Megaphone, Coins } from 'lucide-react';
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
  { k: 'overview', label: 'Overview', icon: BarChart3 },
  { k: 'affiliates', label: 'Affiliates', icon: Users },
  { k: 'promotions', label: 'Promotions', icon: Megaphone },
  { k: 'commissions', label: 'Commissions', icon: Coins },
] as const;

type TabKey = (typeof TABS)[number]['k'];
const TAB_KEYS = TABS.map(t => t.k) as readonly string[];

export default function MarketingAdminPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'overview';
  const tab: TabKey = (TAB_KEYS.includes(raw) ? raw : 'overview') as TabKey;

  const setTab = (k: TabKey) => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.set('tab', k);
    return next;
  }, { replace: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold text-ink tracking-tight">Marketing</h1>
        <p className="text-[13px] text-muted mt-1">Affiliate program, marketers, promotions, and commission payouts</p>
      </div>

      <div className="border-b border-line">
        <nav className="flex gap-1 -mb-px overflow-x-auto" role="tablist" aria-label="Marketing sections">
          {TABS.map(({ k, label, icon: Icon }) => {
            const active = tab === k;
            return (
              <button key={k} role="tab" aria-selected={active} onClick={() => setTab(k)}
                className={'inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 whitespace-nowrap transition-colors ' +
                  (active ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}>
                <Icon size={15} strokeWidth={1.75} />{label}
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'affiliates' && <AffiliatesTab />}
        {tab === 'promotions' && <PromotionsTab />}
        {tab === 'commissions' && <CommissionsPage />}
      </div>
    </div>
  );
}
