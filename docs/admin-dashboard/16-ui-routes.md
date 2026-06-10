# 16 — UI Routes & Pages

## Route Map

```
/admin                          → AdminLoginPage (if not authenticated)
/admin                          → redirect to /admin/dashboard (if authenticated)
/admin/dashboard                → DashboardPage
/admin/game                     → GameControlPage (tabbed: Live | Queue | Settings)
/admin/users                    → UsersListPage
/admin/users/:id                → UserDetailPage
/admin/finance                  → FinanceOverviewPage
/admin/finance/transactions     → TransactionsListPage
/admin/finance/withdrawals      → WithdrawalQueuePage
/admin/finance/mpesa            → MpesaConfigPage
/admin/affiliates               → AffiliatesListPage
/admin/affiliates/:id           → AffiliateDetailPage
/admin/marketing                → MarketingPage (Promotions + Notifications)
/admin/risk                     → RiskDashboardPage
/admin/chat                     → ChatModerationPage
/admin/analytics                → AnalyticsPage
/admin/settings                 → SettingsPage
/admin/settings/api-keys        → ApiKeysPage
/admin/settings/admins          → AdminManagementPage
/admin/settings/audit-log       → AuditLogPage
```

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  [Logo]  AVIATOR ADMIN           [Admin Name] [🔔 3] [Logout]  │
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                     │
│ 📊 Dashboard│                                                     │
│ 🎮 Game     │              MAIN CONTENT AREA                      │
│ 👥 Users    │                                                     │
│ 💰 Finance  │              (Rendered by route)                     │
│ 🤝 Affiliates│                                                     │
│ 📣 Marketing│                                                     │
│ 🛡️ Risk     │                                                     │
│ 💬 Chat     │                                                     │
│ 📈 Analytics│                                                     │
│ ⚙️ Settings │                                                     │
│            │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

## Design System

- **Background**: `#0f0f23` (dark navy, matching game)
- **Cards**: `#1a1a2e` with `#2a2a45` borders
- **Primary accent**: `#c8001c` (Aviator red)
- **Success**: `#22c55e`
- **Warning**: `#f59e0b`
- **Danger**: `#ef4444`
- **Text**: White primary, `#94a3b8` secondary
- **Font**: Inter (same as game)

## Sidebar Behavior
- Desktop: Always visible (240px width)
- Tablet: Collapsible (icons only when collapsed)
- Mobile: Hidden, toggle via hamburger
- Active route highlighted with accent color
- Notification badges on relevant items (e.g., "3" on Risk)
