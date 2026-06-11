# 👥 Module 5: Enhanced Player Management

## Overview
Expand current basic player list into a full CRM-style management system.

---

## 5.1 Player List (Enhanced)

### Columns
| Column | Description |
|--------|-------------|
| Username | Click to view detail |
| Phone | Registered phone |
| Balance | Current wallet balance |
| Total Deposited | Lifetime deposits |
| Total Wagered | Lifetime bets placed |
| Total Won | Lifetime winnings |
| Net P&L (House) | What we've earned from this player |
| Risk Score | 0-100 with color indicator |
| Status | Active / Banned / Suspended / Self-excluded |
| Segment | VIP / Regular / New / At-risk |
| Last Active | Time since last bet |
| Joined | Registration date |

### Filters & Sorting
- Filter by: Status, Segment, Risk level, Date range, Balance range
- Sort by: Any column
- Search: Username, phone, email
- Bulk actions: Ban, Send notification, Assign segment, Export

---

## 5.2 Player Detail Page (Enhanced)

### Tabs
1. **Overview** — Profile, balance, key stats, quick actions
2. **Transactions** — Full deposit/withdrawal history
3. **Betting History** — All bets with round details
4. **Risk Profile** — Risk score breakdown, flags, behavior analysis
5. **Communications** — Sent notifications, support tickets
6. **Activity Log** — Login times, IP addresses, devices used
7. **Referrals** — If they came from an affiliate, show chain

### Quick Actions
- Adjust balance (credit/debit with reason)
- Ban / Suspend / Unban
- Force password reset
- Force logout (invalidate sessions)
- Set daily/weekly limits
- Add player note
- Assign/remove VIP status
- Trigger KYC verification
- Block deposits / Block withdrawals

---

## 5.3 Player Segmentation

### Auto-Segments
| Segment | Criteria |
|---------|----------|
| New Player | Joined < 7 days ago |
| Active | Placed bet in last 48h |
| Dormant | No bets in 14+ days |
| VIP | Total wagered > KSh 500,000 |
| Whale | Total wagered > KSh 2,000,000 |
| At-Risk | Risk score > 70 |
| Churned | No activity in 30+ days |

### Custom Segments
Admins can create custom segments using conditions:
- Balance between X and Y
- Joined between dates
- Total wagered > X
- Loss rate > Y%
- From specific affiliate

---

## 5.4 Player Notes & Tags

```sql
CREATE TABLE player_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  admin_id uuid NOT NULL REFERENCES profiles(id),
  note text NOT NULL,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

Tags: `vip`, `suspicious`, `bonus-abuser`, `whale`, `support-priority`, `restricted`
