# 🛡️ Module 10: Responsible Gambling

## Overview
Tools and safeguards to protect vulnerable players, as required by BCLB regulations.

---

## 10.1 Player Self-Service Controls

### Limits Players Can Set
| Limit | Options | Enforcement |
|-------|---------|-------------|
| Daily Deposit Limit | KSh amount | Block deposits after limit |
| Weekly Deposit Limit | KSh amount | Block deposits after limit |
| Daily Loss Limit | KSh amount | Block betting after limit |
| Session Time Limit | 1hr, 2hr, 4hr, 8hr | Force logout + cooldown |
| Self-Exclusion | 24hr, 7 days, 30 days, 6 months, permanent | Full account lock |
| Reality Check | Every 30min, 1hr, 2hr | Pop-up showing session stats |

### Cooling-Off Periods
- After self-exclusion ends, 24hr cooling-off before can play again
- Limits cannot be increased immediately (24hr delay for increases)
- Limits can be decreased immediately

---

## 10.2 Admin Monitoring Tools

### At-Risk Player Detection
Automated flags when player exhibits:
- Playing for 4+ hours continuously
- Increasing bet sizes after losses (chasing)
- Depositing 3+ times in one session
- Loss of > 50% of balance in < 1 hour
- Late-night gambling (2am-6am) consistently
- Rapid increase in deposit frequency

### Admin Actions
| Action | Description |
|--------|-------------|
| Send warning message | "You've been playing for 3 hours" |
| Force reality check | Show session stats pop-up |
| Set mandatory limit | Admin-imposed deposit/loss cap |
| Cool-down period | Force 24hr break |
| Refer to support | Flag for support team contact |
| Mandatory exclusion | Admin forces self-exclusion |

---

## 10.3 Responsible Gambling Reports (BCLB)

### Monthly Report Data
- Number of self-exclusions
- Number of limit-sets by players
- Average session duration
- % of players using responsible gambling tools
- Interventions performed by admin
- Complaints received

---

## 10.4 Database

```sql
CREATE TABLE player_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  limit_type text NOT NULL CHECK (limit_type IN (
    'daily_deposit', 'weekly_deposit', 'daily_loss',
    'session_time', 'self_exclusion', 'reality_check'
  )),
  limit_value decimal(12,2) NOT NULL,
  current_usage decimal(12,2) DEFAULT 0,
  set_by text DEFAULT 'player' CHECK (set_by IN ('player', 'admin')),
  effective_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE self_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  duration text NOT NULL,
  reason text,
  started_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  is_permanent boolean DEFAULT false,
  set_by text DEFAULT 'player',
  created_at timestamptz DEFAULT now()
);
```
