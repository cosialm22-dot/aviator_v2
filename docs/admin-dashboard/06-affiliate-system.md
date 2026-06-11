# 📣 Module 6: Affiliate & Marketer Management

## Overview
Complete affiliate tracking and management system for marketers who bring players to the platform.

---

## 6.1 Affiliate Registration & Onboarding

### Affiliate Profile
```sql
CREATE TABLE affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),  -- If they're also a player
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  company text,
  referral_code text NOT NULL UNIQUE,    -- e.g., "JOHN2024"
  commission_type text DEFAULT 'revenue_share' CHECK (
    commission_type IN ('revenue_share', 'cpa', 'hybrid')
  ),
  commission_rate decimal(5,2) DEFAULT 25.00,  -- 25% revenue share
  cpa_amount decimal(12,2) DEFAULT 0,          -- Fixed per acquisition
  min_payout decimal(12,2) DEFAULT 1000.00,    -- Min balance to withdraw
  status text DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'suspended', 'terminated')
  ),
  tier text DEFAULT 'bronze' CHECK (
    tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')
  ),
  total_earnings decimal(12,2) DEFAULT 0,
  pending_balance decimal(12,2) DEFAULT 0,
  total_referrals integer DEFAULT 0,
  total_ftd integer DEFAULT 0,           -- First-time deposits
  created_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES profiles(id)
);
```

---

## 6.2 Referral Tracking

### How It Works
1. Affiliate gets unique link: `https://aviator.ke/?ref=JOHN2024`
2. Player clicks link → referral code stored in localStorage/cookie (30 days)
3. On registration → `affiliate_referrals` record created
4. On first deposit → CPA credited (if applicable)
5. On every bet loss → Revenue share calculated

### Referral Table
```sql
CREATE TABLE affiliate_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  referred_user_id uuid NOT NULL REFERENCES profiles(id),
  referral_code text NOT NULL,
  status text DEFAULT 'registered' CHECK (
    status IN ('registered', 'deposited', 'active', 'churned')
  ),
  first_deposit_amount decimal(12,2),
  first_deposit_at timestamptz,
  total_wagered decimal(12,2) DEFAULT 0,
  total_revenue_generated decimal(12,2) DEFAULT 0,  -- Revenue for house
  total_commission_earned decimal(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

---

## 6.3 Commission Structure

### Commission Types
| Type | Description | Example |
|------|-------------|--------|
| Revenue Share | % of house profit from referred players | 25% of losses |
| CPA (Cost Per Acquisition) | Fixed payment per first deposit | KSh 200 per FTD |
| Hybrid | CPA + reduced revenue share | KSh 100 + 15% |

### Tiered Commission (Based on Performance)
| Tier | Monthly FTDs | Revenue Share | CPA Bonus |
|------|-------------|---------------|-----------|
| Bronze | 1-10 | 20% | KSh 100 |
| Silver | 11-50 | 25% | KSh 150 |
| Gold | 51-150 | 30% | KSh 200 |
| Platinum | 151-500 | 35% | KSh 300 |
| Diamond | 500+ | 40% | KSh 500 |

### Commission Calculation (Daily Cron)
```typescript
// Runs daily at midnight
async function calculateDailyCommissions() {
  const affiliates = await getActiveAffiliates();
  
  for (const affiliate of affiliates) {
    const referredPlayers = await getReferredPlayers(affiliate.id);
    let dailyCommission = 0;
    
    for (const player of referredPlayers) {
      // Revenue share: calculate from player's net loss today
      const { wagered, won } = await getPlayerDailyActivity(player.id);
      const houseProfit = wagered - won; // Can be negative!
      
      if (houseProfit > 0) {
        const commission = houseProfit * (affiliate.commission_rate / 100);
        dailyCommission += commission;
      }
      // Negative carry: if player won more than lost, no commission
      // (Optional: deduct from pending balance)
    }
    
    // Credit to affiliate pending balance
    await creditAffiliateBalance(affiliate.id, dailyCommission);
  }
}
```

---

## 6.4 Admin Dashboard Views

### Affiliate List
```
┌──────────────────────────────────────────────────────────┐
│ AFFILIATES (24)                    [+ Add New] [Export]   │
├────────┬────────┬─────┬─────┬──────────┬────────┬────────┤
│ Name   │ Code   │ FTDs│ Tier│ Earnings  │ Pending│ Status │
├────────┼────────┼─────┼─────┼──────────┼────────┼────────┤
│ John   │ JOHN24 │ 156 │ 🥇  │ KSh 89,400│ 12,300 │ Active │
│ Mary   │ MARY01 │ 43  │ 🥈  │ KSh 23,100│ 4,200  │ Active │
│ Kevin  │ KEV_VIP│ 8   │ 🥉  │ KSh 3,200 │ 890    │ Active │
└────────┴────────┴─────┴─────┴──────────┴────────┴────────┘
```

### Affiliate Detail Page
- Profile info + referral link
- Performance chart (referrals, FTDs, revenue over time)
- Referred players list with individual stats
- Commission history (daily breakdown)
- Payout history
- Creative/marketing materials provided

### Affiliate Payouts
| Field | Description |
|-------|-------------|
| Payout Frequency | Weekly / Bi-weekly / Monthly |
| Payment Method | M-Pesa B2C |
| Minimum Payout | KSh 1,000 |
| Auto-Payout | If balance > threshold, auto-send |
| Payout History | Date, amount, receipt, status |

---

## 6.5 Affiliate Dashboard (Separate Portal)

Affiliates get their own login portal showing:
- Their referral link + QR code
- Total referrals, FTDs, active players
- Earnings today / this week / this month / lifetime
- Player activity (anonymized)
- Payout requests
- Marketing materials download

---

## 6.6 Fraud Prevention

### Anti-Fraud Measures
| Check | Description |
|-------|-------------|
| Self-referral | Affiliate cannot refer themselves or same household |
| Device match | Same device registering multiple accounts → Flag |
| Deposit-withdraw | Referred player deposits and immediately withdraws → No commission |
| Minimum activity | Player must place at least 5 bets before CPA is credited |
| Negative carryover | If player has net wins, don't credit rev share (carry to next period) |
| IP clustering | Multiple referrals from same IP range → Investigate |
