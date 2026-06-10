# 07 — Affiliate System

## Overview

Affiliates are **existing players promoted by admin**. They don't register separately — an admin elevates a regular user to affiliate status, giving them a referral code and commission on players they bring in.

## How It Works

```
Admin promotes Player A to affiliate
↓
Player A gets unique referral code (e.g., "JOHN2024")
↓
Player A shares link: aviator.app/?ref=JOHN2024
↓
Player B signs up via that link
↓
Player B's profile.referred_by = affiliate_id
↓
Every time Player B loses a bet, the house profit is tracked
↓
Affiliate earns commission_rate% of house revenue from Player B
↓
Commissions calculated weekly, paid via M-Pesa
```

## Admin Workflow

### Promoting a User
1. Navigate to `/admin/users/:id`
2. Click "Promote to Affiliate"
3. Configure:
   - Referral code (auto-generated or custom)
   - Commission rate (default 20%)
   - Commission model (revenue share / CPA / hybrid)
   - Tier (bronze by default)
4. Confirm → User becomes affiliate

### Managing Affiliates

```
/admin/affiliates page:
┌────────────────────────────────────────────────────────────────┐
│ Affiliate    | Code     | Referrals | Revenue | Earned | Status │
├────────────────────────────────────────────────────────────────┤
│ @john_doe    | JOHN2024 | 45        | 120K    | 24K    | Active │
│ @jane_w      | JANE99   | 23        | 67K     | 13.4K  | Active │
│ @big_mike    | MIKE1    | 8         | 12K     | 2.4K   | Paused │
└────────────────────────────────────────────────────────────────┘
```

### Affiliate Detail Page
- Profile info + referral code
- Commission settings (editable)
- Referred players list with their activity
- Earnings history (chart + table)
- Payout history
- Actions: Pause, Terminate, Change rate, Manual payout

## Commission Calculation

### Revenue Share Model
```
Weekly calculation (every Monday):

For each affiliate:
  1. Get all referred players
  2. For each referred player:
     a. Sum all bets placed this week
     b. Sum all wins paid this week
     c. Net revenue = bets - wins (house profit from this player)
  3. Total commission = SUM(net_revenue) * commission_rate
  4. If net_revenue < 0 (house lost money): commission = 0 (no negative carry)
  5. Create affiliate_commissions record
```

### CPA Model
```
For each new referred player who makes their FIRST deposit:
  commission = cpa_amount (e.g., KSh 200 per depositing user)
```

### Hybrid Model
```
CPA (one-time) + Revenue Share (ongoing)
```

## Tier System

| Tier | Requirement | Commission Rate | Perks |
|------|-------------|-----------------|-------|
| Bronze | Default | 20% | Basic |
| Silver | 20+ referrals OR 200K revenue | 25% | Priority payouts |
| Gold | 50+ referrals OR 500K revenue | 30% | Dedicated support |
| Platinum | 100+ referrals OR 1M revenue | 35% | Custom terms |

Tier upgrades are **automatic** based on performance, but admin can override.

## Referral Link Tracking

### How referral is captured:
1. Player visits `aviator.app/?ref=JOHN2024`
2. Frontend stores `ref` param in localStorage
3. On registration, `ref` code is sent to backend
4. Backend validates code exists in affiliates table
5. Creates `affiliate_referrals` record
6. Sets `profiles.referred_by = affiliate_id`

### Attribution window:
- Cookie/localStorage lasts 30 days
- First-touch attribution (first referral code wins)
- Cannot refer yourself (same user_id check)

## Fraud Prevention

| Check | Action |
|-------|--------|
| Self-referral (affiliate refers own account) | Block + flag |
| Fake accounts (same IP/device creating multiple) | Flag, withhold commission |
| No-deposit referrals | Only count referrals who actually deposit |
| Churning (deposit → withdraw immediately) | Min wagering requirement before referral "counts" |
| Commission abuse (loss trading between accounts) | Pattern detection, manual review |

## Payouts

- **Frequency**: Weekly (configurable: daily, weekly, bi-weekly, monthly)
- **Minimum**: KSh 500 (must accumulate before payout)
- **Method**: M-Pesa B2C (same as player withdrawals)
- **Process**:
  1. System calculates weekly commissions
  2. Admin reviews in `/admin/affiliates`
  3. Bulk approve or individual approve
  4. System sends M-Pesa B2C payments
  5. Marked as paid with transaction reference
