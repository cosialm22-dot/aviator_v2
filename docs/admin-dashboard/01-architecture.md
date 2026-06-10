# 01 — Architecture

## System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        AVIATOR PLATFORM                          │
├────────────────────────────────┬───────────────────────────────────┤
│     PLAYER APP (/)            │     ADMIN DASHBOARD (/admin)       │
│                              │                                    │
│  • Game Canvas                │  • Dashboard Overview               │
│  • Betting Panels             │  • Game Control                     │
│  • Chat                       │  • User Management                  │
│  • Wallet/Deposits            │  • Finance & M-Pesa                 │
│  • Player Auth                │  • Affiliates                       │
│                              │  • Analytics                        │
│                              │  • Risk Management                  │
│                              │  • System Settings                  │
├────────────────────────────────┴───────────────────────────────────┤
│                     SUPABASE BACKEND                             │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  PostgreSQL  │  │  Auth (Player)│  │  Edge Functions         │  │
│  │  Database    │  │  (Supabase)   │  │  • M-Pesa callbacks    │  │
│  │              │  │              │  │  • Crash point gen     │  │
│  └──────────────┘  └──────────────┘  │  • B2C disbursements  │  │
│                                      │  • Risk scoring        │  │
│                                      └───────────────────────┘  │
├────────────────────────────────────────────────────────────────────┤
│                    EXTERNAL SERVICES                             │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │ Safaricom     │  │ Africa\'s      │  │ Hosting (Vercel/    │  │
│  │ Daraja API    │  │ Talking (SMS) │  │ Netlify)            │  │
│  │ (M-Pesa)      │  │               │  │                     │  │
│  └────────────────┘  └────────────────┘  └─────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## Routing Structure

```
/                          → Player App (existing)
/admin                     → Admin Login
/admin/dashboard           → Overview & KPIs
/admin/game                → Game Control & Crash Management
/admin/game/live           → Live Game Monitor
/admin/game/crash-queue    → Future Crash Points
/admin/game/settings       → Algorithm & Limits
/admin/users               → Player List
/admin/users/:id           → Player Detail
/admin/finance             → Financial Overview
/admin/finance/transactions→ All Transactions
/admin/finance/withdrawals → Pending Withdrawals Queue
/admin/finance/mpesa       → M-Pesa Config & Status
/admin/affiliates          → Affiliate Management
/admin/affiliates/:id      → Affiliate Detail
/admin/marketing           → Promotions & Bonuses
/admin/risk                → Risk Alerts & Fraud
/admin/chat                → Chat Moderation
/admin/analytics           → Reports & Charts
/admin/settings            → System Configuration
/admin/settings/api-keys   → API Key Management
/admin/settings/audit-log  → Admin Activity Log
```

## Component Architecture

```
src/
├── admin/
│   ├── AdminApp.tsx                 # Admin root with sidebar layout
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AdminSidebar.tsx      # Navigation sidebar
│   │   │   ├── AdminHeader.tsx      # Top bar with admin info
│   │   │   └── AdminLayout.tsx      # Shell wrapper
│   │   ├── dashboard/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── KPICards.tsx
│   │   │   ├── RevenueChart.tsx
│   │   │   └── RecentActivity.tsx
│   │   ├── game/
│   │   │   ├── GameControlPage.tsx
│   │   │   ├── CrashQueuePanel.tsx
│   │   │   ├── LiveMonitor.tsx
│   │   │   └── AlgorithmSettings.tsx
│   │   ├── users/
│   │   │   ├── UsersListPage.tsx
│   │   │   ├── UserDetailPage.tsx
│   │   │   └── UserActions.tsx
│   │   ├── finance/
│   │   │   ├── FinanceOverview.tsx
│   │   │   ├── TransactionsList.tsx
│   │   │   ├── WithdrawalQueue.tsx
│   │   │   └── MpesaConfig.tsx
│   │   ├── affiliates/
│   │   │   ├── AffiliatesPage.tsx
│   │   │   └── AffiliateDetail.tsx
│   │   ├── marketing/
│   │   │   ├── PromotionsPage.tsx
│   │   │   └── BonusCreator.tsx
│   │   ├── risk/
│   │   │   ├── RiskDashboard.tsx
│   │   │   └── AlertsList.tsx
│   │   ├── chat/
│   │   │   └── ChatModeration.tsx
│   │   ├── analytics/
│   │   │   ├── AnalyticsPage.tsx
│   │   │   └── charts/
│   │   └── settings/
│   │       ├── SettingsPage.tsx
│   │       ├── ApiKeysManager.tsx
│   │       └── AuditLog.tsx
│   ├── hooks/
│   │   ├── useAdminAuth.ts
│   │   ├── useAdminData.ts
│   │   └── useMpesa.ts
│   ├── lib/
│   │   ├── adminSupabase.ts         # Admin-specific Supabase client
│   │   ├── mpesaClient.ts           # Daraja API wrapper
│   │   ├── crashAlgorithm.ts        # Server-side crash generation
│   │   └── riskEngine.ts            # Risk scoring logic
│   └── types/
│       └── admin.ts                 # Admin-specific types
```

## Security Layers

1. **Route Guard:** `/admin/*` routes check for valid admin session
2. **API Guard:** All admin API calls require admin JWT token
3. **RLS Policies:** Admin-specific Supabase RLS for admin_users role
4. **Audit Trail:** Every admin action logged with timestamp + actor
5. **IP Allowlist:** Optional — restrict admin access to specific IPs
6. **2FA:** TOTP-based two-factor authentication for admin login
7. **Session Timeout:** Auto-logout after 30 minutes of inactivity

## Data Flow: Admin Action

```
Admin UI → Admin Hook → Supabase (service_role key) → PostgreSQL
                                    │
                                    └─→ audit_log table (automatic trigger)
```

## Data Flow: M-Pesa Transaction

```
Player (STK Push) → Safaricom → Callback URL (Edge Function)
                                        │
                                        ├─→ Validate payment
                                        ├─→ Credit wallet
                                        ├─→ Record transaction
                                        └─→ Send confirmation
```
