# 🎨 Module 14: UI Design System & Navigation

## Overview
Design system, component library, and navigation structure for the admin dashboard.

---

## 14.1 Navigation Structure

### Sidebar Menu
```
🎮 AVIATOR ADMIN
───────────────
📊 Dashboard
    ├─ Overview
    ├─ Revenue Analytics
    └─ Real-Time Monitor

🎮 Game Control
    ├─ Live Round
    ├─ Crash Queue
    ├─ Algorithm Settings
    ├─ Bot Configuration
    └─ Round History

👥 Players
    ├─ All Players
    ├─ Segments
    ├─ Risk Alerts
    └─ Banned/Excluded

💳 Finance
    ├─ Transactions
    ├─ Withdrawals Queue
    ├─ M-Pesa Monitor
    ├─ Reconciliation
    └─ Revenue Reports

📣 Marketing
    ├─ Affiliates
    ├─ Bonuses & Promos
    ├─ Player Segments
    └─ Notifications

🛡️ Compliance
    ├─ KYC Queue
    ├─ Responsible Gambling
    ├─ Fraud Alerts
    └─ Regulatory Reports

⚙️ Settings
    ├─ System Config
    ├─ Admin Users & Roles
    ├─ M-Pesa Config
    └─ Audit Log

🚨 Emergency [Always Visible]
```

---

## 14.2 Design Tokens

### Colors
```css
/* Background Layers */
--bg-primary: #0a0a14;      /* Page background */
--bg-secondary: #111122;    /* Card background */
--bg-tertiary: #1a1a2e;     /* Elevated elements */
--bg-hover: #1e1e35;        /* Hover states */

/* Borders */
--border-primary: #1e1e35;
--border-secondary: #2a2a45;

/* Brand */
--brand-primary: #c8001c;   /* Red - primary actions */
--brand-hover: #ff3344;     /* Red hover */

/* Status Colors */
--status-success: #22c55e;
--status-warning: #eab308;
--status-error: #ef4444;
--status-info: #3b82f6;

/* Text */
--text-primary: #ffffff;
--text-secondary: #94a3b8;
--text-muted: #475569;
```

### Typography
```css
--font-family: 'Inter', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* Sizes */
--text-xs: 0.625rem;   /* 10px - labels, badges */
--text-sm: 0.75rem;    /* 12px - secondary text */
--text-base: 0.875rem; /* 14px - body text */
--text-lg: 1.125rem;   /* 18px - section headers */
--text-xl: 1.5rem;     /* 24px - page titles */
--text-2xl: 2rem;      /* 32px - hero metrics */
```

---

## 14.3 Component Library

### Metric Card
```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; direction: 'up' | 'down' };
  color: 'green' | 'blue' | 'purple' | 'amber' | 'red';
}
```

### Data Table
- Sortable columns
- Pagination (10/25/50/100 per page)
- Row selection (for bulk actions)
- Expandable rows (for detail preview)
- Column visibility toggle
- Export to CSV button

### Status Badge
```typescript
type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
// Maps to: green, amber, red, blue, gray
```

### Alert Banner
- Dismissible
- Severity-colored border
- Action button
- Auto-dismiss timer (optional)

### Confirmation Dialog
Required for all destructive actions:
- Ban player
- Reject withdrawal
- Clear crash queue
- Emergency controls
- Delete/modify settings

---

## 14.4 Responsive Design

| Breakpoint | Layout |
|-----------|--------|
| Desktop (1280px+) | Full sidebar + content |
| Tablet (768-1279px) | Collapsible sidebar + content |
| Mobile (< 768px) | Bottom nav + stacked content |

---

## 14.5 File Structure (New)

```
src/admin/
├── AdminApp.tsx                    # Router
├── AdminGuard.tsx                  # Auth + RBAC guard
├── layout/
│   ├── AdminLayout.tsx
│   ├── AdminSidebar.tsx
│   ├── AdminHeader.tsx
│   └── AdminBreadcrumb.tsx
├── components/
│   ├── ui/
│   │   ├── MetricCard.tsx
│   │   ├── DataTable.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── AlertBanner.tsx
│   │   ├── DateRangePicker.tsx
│   │   └── Charts/
│   │       ├── LineChart.tsx
│   │       ├── BarChart.tsx
│   │       ├── PieChart.tsx
│   │       └── Heatmap.tsx
│   ├── dashboard/
│   ├── game/
│   ├── players/
│   ├── finance/
│   ├── marketing/
│   ├── compliance/
│   └── settings/
├── hooks/
│   ├── usePermission.ts
│   ├── useAnalytics.ts
│   ├── useLiveFeed.ts
│   ├── useWithdrawals.ts
│   ├── useCrashQueue.ts
│   └── useMpesa.ts
├── pages/
│   ├── DashboardPage.tsx
│   ├── RevenueAnalyticsPage.tsx
│   ├── RealTimeMonitorPage.tsx
│   ├── GameControlPage.tsx
│   ├── CrashQueuePage.tsx
│   ├── AlgorithmPage.tsx
│   ├── BotConfigPage.tsx
│   ├── UsersPage.tsx
│   ├── UserDetailPage.tsx
│   ├── RiskAlertsPage.tsx
│   ├── FinancePage.tsx
│   ├── WithdrawalsPage.tsx
│   ├── MpesaMonitorPage.tsx
│   ├── ReconciliationPage.tsx
│   ├── AffiliatesPage.tsx
│   ├── AffiliateDetailPage.tsx
│   ├── BonusesPage.tsx
│   ├── KycQueuePage.tsx
│   ├── ResponsibleGamblingPage.tsx
│   ├── FraudAlertsPage.tsx
│   ├── SettingsPage.tsx
│   ├── RolesPage.tsx
│   └── AuditLogPage.tsx
└── utils/
    ├── permissions.ts
    ├── chartHelpers.ts
    └── formatters.ts
```

---

## 14.6 New Dependencies

```json
{
  "dependencies": {
    "recharts": "^2.12.0",
    "date-fns": "^3.3.0",
    "react-router-dom": "^6.21.0",
    "@tanstack/react-table": "^8.11.0",
    "react-hot-toast": "^2.4.0",
    "@fingerprintjs/fingerprintjs": "^4.2.0"
  }
}
```

---

## 14.7 Routes (Updated AdminApp.tsx)

```typescript
<Routes>
  {/* Dashboard */}
  <Route index element={<DashboardPage />} />
  <Route path="analytics" element={<RevenueAnalyticsPage />} />
  <Route path="realtime" element={<RealTimeMonitorPage />} />

  {/* Game Control */}
  <Route path="game" element={<GameControlPage />} />
  <Route path="game/queue" element={<CrashQueuePage />} />
  <Route path="game/algorithm" element={<AlgorithmPage />} />
  <Route path="game/bots" element={<BotConfigPage />} />
  <Route path="game/history" element={<RoundHistoryPage />} />

  {/* Players */}
  <Route path="players" element={<UsersPage />} />
  <Route path="players/:id" element={<UserDetailPage />} />
  <Route path="players/segments" element={<SegmentsPage />} />
  <Route path="players/risk" element={<RiskAlertsPage />} />

  {/* Finance */}
  <Route path="finance" element={<FinancePage />} />
  <Route path="finance/withdrawals" element={<WithdrawalsPage />} />
  <Route path="finance/mpesa" element={<MpesaMonitorPage />} />
  <Route path="finance/reconciliation" element={<ReconciliationPage />} />

  {/* Marketing */}
  <Route path="marketing/affiliates" element={<AffiliatesPage />} />
  <Route path="marketing/affiliates/:id" element={<AffiliateDetailPage />} />
  <Route path="marketing/bonuses" element={<BonusesPage />} />
  <Route path="marketing/notifications" element={<NotificationsPage />} />

  {/* Compliance */}
  <Route path="compliance/kyc" element={<KycQueuePage />} />
  <Route path="compliance/responsible" element={<ResponsibleGamblingPage />} />
  <Route path="compliance/fraud" element={<FraudAlertsPage />} />

  {/* Settings */}
  <Route path="settings" element={<SettingsPage />} />
  <Route path="settings/roles" element={<RolesPage />} />
  <Route path="settings/mpesa" element={<MpesaConfigPage />} />
  <Route path="settings/audit" element={<AuditLogPage />} />
</Routes>
```
