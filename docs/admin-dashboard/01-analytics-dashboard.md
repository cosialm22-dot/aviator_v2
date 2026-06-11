# 📊 Module 1: Enhanced Analytics Dashboard

## Overview
Replace the basic 4-stat cards with a comprehensive real-time analytics center featuring interactive charts, customizable date ranges, and deep-dive metrics.

---

## Key Metrics (Top-Level Cards)

### Row 1: Revenue Metrics
| Metric | Description | Source |
|--------|-------------|--------|
| Gross Gaming Revenue (GGR) | Total wagered - Total winnings paid | `bets` table |
| Net Gaming Revenue (NGR) | GGR - Bonuses - Commissions | Calculated |
| Revenue Today | Real-time today's GGR | `bets` table, today filter |
| Revenue This Month | Month-to-date GGR | `bets` table, month filter |
| House Edge (Actual) | (Total wagered - Total won) / Total wagered × 100 | `bets` table |

### Row 2: Player Metrics
| Metric | Description | Source |
|--------|-------------|--------|
| Total Players | All registered users | `profiles` count |
| Active Today | Players who placed a bet today | `bets` table, distinct user_id |
| New Signups (24h) | Registrations in last 24h | `profiles` created_at |
| Online Now | Currently connected WebSocket sessions | Realtime presence |
| Retention Rate | % of last-week players who returned this week | Calculated |

### Row 3: Financial Metrics
| Metric | Description | Source |
|--------|-------------|--------|
| Total Deposits Today | Sum of all deposits | `transactions` type=deposit |
| Total Withdrawals Today | Sum of completed withdrawals | `transactions` type=withdrawal |
| Pending Withdrawals | Count + Total amount | `withdrawal_requests` status=pending |
| Platform Balance | Total money in all wallets | `wallets` sum(balance) |
| Float Required | Estimated cash needed for pending payouts | Calculated |

### Row 4: Game Metrics
| Metric | Description | Source |
|--------|-------------|--------|
| Rounds Played Today | Total game rounds | `game_rounds` today count |
| Average Crash Point | Mean crash multiplier | `game_rounds` avg |
| Biggest Win Today | Largest single payout | `bets` max winnings |
| Bets Per Round (Avg) | Average active bets per round | Calculated |

---

## Interactive Charts

### 1. Revenue Over Time (Line Chart)
```
X-axis: Time (hourly/daily/weekly/monthly)
Y-axis: Amount (KSh)
Series:
  - Gross Revenue (green)
  - Deposits (blue)
  - Withdrawals (red)
  - Net Profit (gold)
Filters: Date range picker, granularity selector
```

### 2. Player Activity Heatmap
```
X-axis: Hour of day (0-23)
Y-axis: Day of week (Mon-Sun)
Color intensity: Number of active players
Purpose: Identify peak hours for marketing/promotions
```

### 3. Crash Point Distribution (Histogram)
```
X-axis: Crash multiplier ranges (1.0x, 1.5x, 2x, 3x, 5x, 10x, 20x+)
Y-axis: Frequency
Purpose: Verify house edge is being maintained
Overlay: Expected vs Actual distribution
```

### 4. Deposit vs Withdrawal Flow (Area Chart)
```
X-axis: Time
Y-axis: Amount
Stacked areas showing money in vs money out
Alert zone when withdrawals approach deposits
```

### 5. Player Funnel
```
Stages:
  Visited → Registered → Deposited → Played → Won → Withdrew
  With conversion % between each stage
```

### 6. Top Players Leaderboard
```
Table with:
  - Username
  - Total wagered (lifetime)
  - Net P&L (platform perspective)
  - Risk score
  - Last active
  - Quick actions (view, flag, restrict)
```

---

## Real-Time Feed

A live ticker showing:
- New player registrations
- Large deposits (> KSh 5,000)
- Large withdrawals (> KSh 10,000)
- High multiplier wins (> 10x)
- Suspicious activity flags
- System alerts

```typescript
// Subscribe to Supabase Realtime
supabase.channel('admin-feed')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, handleTransaction)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bets' }, handleBet)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, handleNewUser)
  .subscribe();
```

---

## Date Range Controls

- Quick selectors: Today, Yesterday, Last 7 days, Last 30 days, This month, Last month
- Custom date range picker
- Compare with previous period toggle
- Auto-refresh toggle (every 30s / 1min / 5min / off)

---

## Export Options

- Export any chart data to CSV
- Export full daily/monthly report as PDF
- Scheduled email reports (daily summary at 8am)

---

## Technical Implementation

### Libraries
- `recharts` or `chart.js` for interactive charts
- `date-fns` for date manipulation
- Supabase Realtime for live data

### Database Queries (Materialized Views)
```sql
-- Daily revenue summary (materialized, refresh every 5min)
CREATE MATERIALIZED VIEW daily_revenue_summary AS
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT CASE WHEN status = 'active' OR status = 'won' OR status = 'lost' THEN user_id END) as active_players,
  SUM(amount) as total_wagered,
  SUM(CASE WHEN status = 'won' THEN winnings ELSE 0 END) as total_paid,
  SUM(amount) - SUM(CASE WHEN status = 'won' THEN winnings ELSE 0 END) as revenue,
  COUNT(*) as total_bets
FROM bets
WHERE is_bot = false
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Hourly activity for heatmap
CREATE MATERIALIZED VIEW hourly_activity AS
SELECT
  EXTRACT(DOW FROM created_at) as day_of_week,
  EXTRACT(HOUR FROM created_at) as hour_of_day,
  COUNT(DISTINCT user_id) as active_players,
  SUM(amount) as volume
FROM bets
WHERE is_bot = false AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2;
```

### Component Structure
```
src/admin/pages/DashboardPage.tsx
├── components/
│   ├── MetricCard.tsx
│   ├── RevenueChart.tsx
│   ├── PlayerHeatmap.tsx
│   ├── CrashDistribution.tsx
│   ├── DepositWithdrawalFlow.tsx
│   ├── PlayerFunnel.tsx
│   ├── TopPlayersTable.tsx
│   ├── LiveFeed.tsx
│   └── DateRangePicker.tsx
│
├── hooks/
│   ├── useAnalytics.ts
│   ├── useLiveFeed.ts
│   └── useChartData.ts
│
└── utils/
    └── chartHelpers.ts
```
