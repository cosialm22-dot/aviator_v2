# 💸 Module 4: Withdrawal Management

## Overview
Replace instant auto-completion with a proper approval workflow including risk assessment, limits enforcement, and batch processing.

---

## 4.1 Withdrawal Request Flow

```
Player requests withdrawal
       │
       ▼
┌──────────────────────────┐
│ Automated Checks:        │
│ • KYC verified?           │
│ • Within daily limit?     │
│ • Wagering met? (1x dep)  │
│ • Account age > 24h?      │
│ • Risk score < threshold? │
└──────────────────────────┘
       │
   ┌───┴───┐
   │ Pass? │
   └───┬───┘
   YES│     NO→ Manual Review Queue
       │
   ┌───┴────────────┐
   │ Amount < 5000?  │
   └───┬────────────┘
   YES│     NO→ Manual Review Queue
       │
       ▼
  AUTO-APPROVE
       │
       ▼
  Process B2C Payment
```

---

## 4.2 Admin Withdrawal Queue

### Queue View
```
┌──────────────────────────────────────────────────────────┐
│ PENDING WITHDRAWALS (12)              [Approve All Low Risk] │
├──────────────────────────────────────────────────────────┤
│ Player   | Amount   | Phone      | Risk | Wait  | Actions  │
├──────────┼──────────┼────────────┼──────┼───────┼──────────┤
│ player1  | KSh 8,500| 0712***456 | 🟢 25| 3min  | ✅ ❌ 👁️  │
│ player2  | KSh 2,000| 0722***789 | 🟢 12| 8min  | ✅ ❌ 👁️  │
│ player3  | KSh 45,000|0733***012 | 🟡 65| 2hr   | ✅ ❌ 👁️  │
│ player4  | KSh 120,000|0701***345| 🔴 89| 4hr   | ✅ ❌ 👁️  │
└──────────┴──────────┴────────────┴──────┴───────┴──────────┘
```

### Per-Request Detail View
- Player profile (joined date, total deposited, total wagered)
- Wagering requirement status
- Deposit-to-withdrawal ratio
- Recent activity (last 10 bets)
- Risk score breakdown
- Previous withdrawal history
- One-click: Approve / Reject (with reason) / Hold for review

---

## 4.3 Withdrawal Rules Engine

### Configurable Rules
| Rule | Default | Description |
|------|---------|-------------|
| `min_withdrawal` | KSh 100 | Minimum withdrawal amount |
| `max_withdrawal` | KSh 150,000 | Maximum single withdrawal |
| `daily_limit` | KSh 300,000 | Max total withdrawals per day per player |
| `wagering_requirement` | 1x | Must wager 1x deposit before withdrawing |
| `min_account_age` | 24 hours | Account must be older than this |
| `auto_approve_max` | KSh 5,000 | Below this = auto-approve (if all checks pass) |
| `cooldown_period` | 1 hour | Time between withdrawal requests |
| `max_daily_requests` | 5 | Max withdrawal requests per day |

### Anti-Fraud Rules
| Rule | Description |
|------|-------------|
| Deposit-then-withdraw | If player deposits and tries to withdraw without wagering → Flag |
| Multiple phones | If player has used different phones for deposits vs withdrawal → Flag |
| Rapid deposits | If 3+ deposits in 5 minutes then immediate withdrawal → Hold |
| New account, large withdrawal | Account < 48h requesting > KSh 10,000 → Manual review |
| Velocity check | > KSh 100,000 withdrawn in 24h → Escalate |

---

## 4.4 Batch Processing

### Batch Approve
- Select multiple low-risk withdrawals
- One-click batch approve
- System processes B2C sequentially with 2s delay between
- Progress bar showing completion status

### Scheduled Processing
- Process withdrawals at set intervals (every 15min, 30min, 1hr)
- Or process immediately on approval
- Admin can switch between modes

---

## 4.5 Database Schema

```sql
-- Enhanced withdrawal_requests table
CREATE TABLE withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  amount decimal(12,2) NOT NULL,
  phone_number text NOT NULL,
  method text DEFAULT 'mpesa' CHECK (method IN ('mpesa', 'bank')),
  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  risk_score integer,
  risk_flags jsonb DEFAULT '[]',
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  mpesa_receipt text,
  processing_started_at timestamptz,
  completed_at timestamptz,
  auto_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```
