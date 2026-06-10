# 15 — Implementation Plan

## Phasing Strategy: Efficiency-First

Instead of building feature-by-feature, we build in **vertical slices** that give maximum value as quickly as possible. Each phase produces a working, deployable increment.

## Phase 1: Foundation + Core Admin (Days 1-3)

**Goal:** Admin can log in, see what's happening, manage users.

### Deliverables:
1. **Admin auth system**
   - `admin_users` + `admin_sessions` tables
   - Login page at `/admin`
   - Session management + route guards
   - Seed script for first super_admin

2. **Admin layout shell**
   - Sidebar navigation
   - Header with admin info + logout
   - Responsive layout (desktop-first)

3. **Dashboard overview page**
   - Total users, active today, total revenue
   - Revenue chart (last 7 days from game_rounds data)
   - Recent activity feed
   - Quick stats cards

4. **User management (basic)**
   - Users list with search/filter
   - User detail page (profile, wallet, bet history)
   - Ban/unban actions
   - Balance adjustment (credit/debit)

5. **Database migration**
   - admin_users, admin_sessions, admin_audit_log tables
   - Modifications to profiles table (phone, ban fields, etc.)

### Files created:
```
src/admin/
  AdminApp.tsx
  components/layout/*
  components/dashboard/*
  components/users/*
  hooks/useAdminAuth.ts
  lib/adminSupabase.ts
  types/admin.ts
supabase/migrations/[timestamp]_admin_foundation.sql
```

---

## Phase 2: Financial Management + M-Pesa (Days 4-6)

**Goal:** Admin controls money flow. Deposits and withdrawals work via M-Pesa sandbox.

### Deliverables:
1. **Transaction management**
   - All transactions list (filterable by type, status, date, user)
   - Transaction detail view

2. **Withdrawal queue**
   - Pending withdrawals list
   - Approve/reject with reason
   - Auto-approve rules configuration
   - Bulk approve action

3. **M-Pesa integration (Sandbox)**
   - `mpesa_config` table with sandbox credentials
   - Edge Function: `mpesa-stk-push` (initiate deposits)
   - Edge Function: `mpesa-callback` (handle deposit confirmation)
   - Edge Function: `mpesa-b2c-payment` (initiate withdrawals)
   - Edge Function: `mpesa-b2c-result` (handle withdrawal result)
   - Config page in admin to manage API keys
   - Test connection button

4. **Player app deposit/withdraw UI update**
   - Deposit: Enter amount → STK Push to phone → auto-credit
   - Withdraw: Enter amount + phone → submit to queue

5. **API Keys management page**
   - Encrypted storage
   - Show/hide toggle
   - Test connection

### Files created:
```
src/admin/components/finance/*
src/admin/components/settings/ApiKeysManager.tsx
supabase/functions/mpesa-stk-push/
supabase/functions/mpesa-callback/
supabase/functions/mpesa-b2c-payment/
supabase/functions/mpesa-b2c-result/
supabase/migrations/[timestamp]_mpesa_tables.sql
```

---

## Phase 3: Game Control (Days 7-8)

**Goal:** Admin has full visibility and control over crash points and game state.

### Deliverables:
1. **Crash queue viewer**
   - View next 50 pre-generated crash points
   - Color-coded by risk level
   - Source indicator (algorithm vs manual)

2. **Crash point injection**
   - Form to inject specific multiplier
   - Position selection (next, after N rounds)
   - Reason required (audit)

3. **Algorithm settings**
   - House edge percentage
   - Max/min multiplier caps
   - Emergency threshold configuration
   - Live preview of expected distribution

4. **Live game monitor**
   - Current round status (real-time)
   - Active bets with amounts
   - Force crash button (emergency)
   - Pause/resume game

5. **Server-side crash generation**
   - Move crash point generation to Edge Function
   - Pre-generate queue of 100 points
   - Provably fair seed management

6. **Round history (enhanced)**
   - Full P&L per round
   - Filter by profitable/unprofitable
   - Export to CSV

### Files created:
```
src/admin/components/game/*
supabase/functions/generate-crash-points/
supabase/functions/game-control/
supabase/migrations/[timestamp]_game_control.sql
```

---

## Phase 4: Affiliates + Marketing (Days 9-11)

**Goal:** Affiliate system is live. Admins can promote users, track referrals, manage payouts.

### Deliverables:
1. **Affiliate management**
   - Promote user to affiliate (from user detail page)
   - Affiliates list with performance metrics
   - Affiliate detail page
   - Edit commission rate/model
   - Pause/terminate affiliate

2. **Referral tracking**
   - Frontend: capture `?ref=CODE` on registration
   - Backend: link referred user to affiliate
   - Track first deposit, total wagered, revenue generated

3. **Commission calculation**
   - Automated weekly calculation job
   - Manual trigger for recalculation
   - Commission approval workflow

4. **Affiliate payouts**
   - Pending commissions queue
   - Approve + pay via M-Pesa B2C
   - Payout history

5. **Promotions & bonuses**
   - Create promo codes
   - Welcome bonus configuration
   - Free bet awards
   - Active promotions list

6. **Player app updates**
   - Referral code input on registration
   - "Share your code" UI for affiliates
   - Promo code redemption

### Files created:
```
src/admin/components/affiliates/*
src/admin/components/marketing/*
supabase/functions/calculate-commissions/
supabase/migrations/[timestamp]_affiliates.sql
supabase/migrations/[timestamp]_promotions.sql
```

---

## Phase 5: Risk Management + Analytics (Days 12-14)

**Goal:** Platform is secure and data-driven.

### Deliverables:
1. **Risk scoring engine**
   - Auto-calculate risk scores per player
   - Flag suspicious patterns
   - Multi-account detection (IP-based)

2. **Alert system**
   - Whale bet alerts (> configurable threshold)
   - Win streak alerts
   - Large withdrawal alerts
   - Real-time notification in admin dashboard

3. **Analytics dashboard**
   - GGR/NGR charts
   - Player retention curves
   - Deposit/withdrawal trends
   - Peak hours heatmap
   - Top players leaderboard
   - Cohort analysis

4. **Reports**
   - Daily P&L report
   - Weekly summary email
   - Export to CSV/PDF

5. **Chat moderation**
   - Live chat monitor
   - Mute/ban from chat
   - Delete messages
   - Word filter configuration

6. **Audit log viewer**
   - All admin actions searchable
   - Filter by admin, action type, date
   - Export capability

### Files created:
```
src/admin/components/risk/*
src/admin/components/analytics/*
src/admin/components/chat/*
src/admin/components/settings/AuditLog.tsx
supabase/functions/risk-scoring/
supabase/migrations/[timestamp]_risk_analytics.sql
```

---

## Phase 6: Polish + Production Prep (Days 15-16)

**Goal:** Production-ready. All edges smoothed.

### Deliverables:
1. **2FA for admins** (TOTP)
2. **Role-based access enforcement** (all pages check permissions)
3. **System settings page** (all configurable values in one place)
4. **Maintenance mode** toggle
5. **Database backup** button
6. **Performance optimization** (pagination, lazy loading, caching)
7. **Error boundaries** for admin pages
8. **M-Pesa production migration guide**
9. **Deployment documentation**

---

## Summary Timeline

| Phase | Days | Cumulative | Core Feature |
|-------|------|-----------|---|
| 1. Foundation | 1-3 | 3 days | Admin login + users + dashboard |
| 2. Finance | 4-6 | 6 days | M-Pesa + transactions + withdrawals |
| 3. Game Control | 7-8 | 8 days | Crash management + live monitor |
| 4. Affiliates | 9-11 | 11 days | Referrals + commissions + promos |
| 5. Risk + Analytics | 12-14 | 14 days | Fraud detection + reports |
| 6. Polish | 15-16 | 16 days | 2FA + production prep |

**Total estimated: 16 development days**

## Dependencies

```
Phase 1 (Foundation)
  └─→ Phase 2 (Finance) - needs admin auth
      └─→ Phase 4 (Affiliates) - needs M-Pesa for payouts
  └─→ Phase 3 (Game Control) - needs admin auth
  └─→ Phase 5 (Risk) - needs all data flowing
      └─→ Phase 6 (Polish) - needs everything built
```

Phases 2 and 3 can be **parallelized** if working with another developer.

## New Dependencies (npm packages)

```json
{
  "bcryptjs": "^2.4.3",           // Admin password hashing
  "recharts": "^2.12.0",          // Charts for analytics
  "date-fns": "^3.6.0",           // Date formatting
  "@tanstack/react-table": "^8",  // Data tables
  "otpauth": "^9.2.0",            // TOTP 2FA
  "react-hot-toast": "^2.4.1"     // Toast notifications
}
```
