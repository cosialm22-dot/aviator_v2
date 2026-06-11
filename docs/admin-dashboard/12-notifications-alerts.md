# 🔔 Module 12: Notifications & Alerts

## Overview
System for alerting admins about important events and sending notifications to players.

---

## 12.1 Admin Alerts

### Alert Types & Channels
| Alert | Severity | Channel |
|-------|----------|--------|
| Large withdrawal request (> KSh 50,000) | High | Dashboard + SMS |
| B2C float running low (< KSh 100,000) | Critical | Dashboard + SMS + Email |
| Fraud flag triggered | High | Dashboard + SMS |
| System error (M-Pesa callback failed) | Critical | Dashboard + SMS |
| New KYC submission | Low | Dashboard |
| Player self-excluded | Medium | Dashboard |
| Revenue drop > 30% vs yesterday | High | Dashboard + Email |
| Server/API health check failed | Critical | SMS + Email |
| Unusual traffic spike | Medium | Dashboard |
| Pending withdrawals > 10 | Medium | Dashboard |

### Alert Configuration
- Per-admin notification preferences
- Quiet hours setting (no SMS between 11pm-7am unless Critical)
- Escalation rules (if not acknowledged in 15min, escalate to next admin)

---

## 12.2 Player Notifications

### Notification Channels
| Channel | Use Case |
|---------|----------|
| In-App | Balance updates, game events, promotions |
| SMS (via Africa's Talking API) | Withdrawal completed, deposit confirmed |
| Push (if PWA/mobile) | New promotions, game events |

### Triggered Notifications
| Event | Message | Channel |
|-------|---------|--------|
| Deposit confirmed | "KSh {amount} deposited successfully" | In-App + SMS |
| Withdrawal completed | "KSh {amount} sent to {phone}" | In-App + SMS |
| Withdrawal rejected | "Withdrawal request rejected: {reason}" | In-App |
| Big win | "🎉 You won KSh {amount}!" | In-App |
| Bonus available | "New bonus available! {description}" | In-App |
| Account banned | "Account suspended. Contact support." | SMS |

### Admin Broadcast
- Send message to all players
- Send to specific segment
- Schedule for future delivery
- Template management

---

## 12.3 Database

```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),  -- NULL = admin notification
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  channel text DEFAULT 'in_app',
  is_read boolean DEFAULT false,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  message text NOT NULL,
  acknowledged boolean DEFAULT false,
  acknowledged_by uuid REFERENCES profiles(id),
  acknowledged_at timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
```
