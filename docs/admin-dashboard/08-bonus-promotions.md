# 🎁 Module 8: Bonus & Promotions Engine

## Overview
Create, manage, and track promotional campaigns and player bonuses.

---

## 8.1 Bonus Types

| Type | Description | Example |
|------|-------------|--------|
| Welcome Bonus | First deposit match | 100% match up to KSh 1,000 |
| Deposit Bonus | Match on any deposit | 50% match up to KSh 500 |
| Free Bet | Risk-free bet credit | KSh 100 free bet |
| Cashback | % of losses returned | 10% of weekly losses |
| Referral Bonus | Reward for referring friend | KSh 200 when friend deposits |
| Loyalty Reward | For consistent players | Weekly KSh 50 for 7-day streak |
| Event Bonus | Time-limited promotion | Double rewards Friday 6-9pm |
| No-Deposit Bonus | Free credit on signup | KSh 50 free to try |

---

## 8.2 Bonus Configuration UI

### Create Bonus Campaign
```
┌────────────────────────────────────────────────────┐
│ CREATE BONUS CAMPAIGN                                │
├────────────────────────────────────────────────────┤
│ Name:         [Weekend Cashback Special          ]   │
│ Type:         [Cashback           ▼]                 │
│ Value:        [10] %                                 │
│ Max Amount:   [KSh 5,000]                            │
│ Wagering Req: [3x] deposit                           │
│ Min Deposit:  [KSh 200]                              │
│ Start Date:   [2024-01-20 18:00]                     │
│ End Date:     [2024-01-21 23:59]                     │
│ Target:       [◉ All] [○ Segment] [○ Specific]       │
│ Max Claims:   [500]                                  │
│ Budget Cap:   [KSh 200,000]                          │
│                                                      │
│ [Preview] [Save Draft] [Activate]                    │
└────────────────────────────────────────────────────┘
```

### Wagering Requirements
- Player must wager X times the bonus amount before withdrawing
- Progress bar shown to player
- Expires after Y days if not met
- Only real-money bets count (not bonus money)

---

## 8.3 Campaign Analytics

| Metric | Description |
|--------|-------------|
| Claims | Number of players who claimed the bonus |
| Redemption Rate | Claims / Eligible players |
| Wagering Completion | % who met wagering requirements |
| Total Cost | Actual bonus money paid out |
| Revenue Impact | Additional revenue generated vs cost |
| ROI | (Revenue gained - Bonus cost) / Bonus cost |
| Player Reactivation | Dormant players who returned |

---

## 8.4 Database Schema

```sql
CREATE TABLE bonus_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  value decimal(10,2) NOT NULL,
  max_amount decimal(12,2),
  wagering_requirement decimal(5,2) DEFAULT 1.00,
  min_deposit decimal(12,2) DEFAULT 0,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  target_segment text,
  max_claims integer,
  budget_cap decimal(12,2),
  status text DEFAULT 'draft',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE player_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  campaign_id uuid NOT NULL REFERENCES bonus_campaigns(id),
  amount decimal(12,2) NOT NULL,
  wagering_required decimal(12,2) NOT NULL,
  wagering_completed decimal(12,2) DEFAULT 0,
  status text DEFAULT 'active' CHECK (
    status IN ('active', 'completed', 'expired', 'forfeited')
  ),
  claimed_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz
);
```
