# 🛡️ Module 7: Risk & Fraud Detection

## Overview
Automated risk scoring and fraud detection to protect platform revenue and identify suspicious behavior.

---

## 7.1 Player Risk Score (0-100)

### Score Components
| Factor | Weight | Description |
|--------|--------|-------------|
| Win Rate | 20% | Abnormally high win rate vs expected |
| Bet Pattern | 15% | Consistent large bets at specific multipliers |
| Deposit/Withdraw Ratio | 15% | Withdrawing more than depositing |
| Account Age | 10% | New accounts are higher risk |
| Session Patterns | 10% | Playing only during specific crash patterns |
| Multi-Account Signals | 15% | Same device/IP as other accounts |
| Velocity | 15% | Rapid deposit-bet-withdraw cycles |

### Risk Levels
| Score | Level | Color | Action |
|-------|-------|-------|--------|
| 0-30 | Low | 🟢 Green | Auto-approve withdrawals |
| 31-50 | Medium | 🟡 Yellow | Standard review |
| 51-70 | High | 🟠 Orange | Manual withdrawal review |
| 71-100 | Critical | 🔴 Red | Flag + restrict + investigate |

### Score Calculation
```typescript
interface RiskFactors {
  win_rate_score: number;      // 0-100
  bet_pattern_score: number;   // 0-100
  financial_score: number;     // 0-100
  account_age_score: number;   // 0-100
  session_score: number;       // 0-100
  multi_account_score: number; // 0-100
  velocity_score: number;      // 0-100
}

function calculateRiskScore(factors: RiskFactors): number {
  return Math.round(
    factors.win_rate_score * 0.20 +
    factors.bet_pattern_score * 0.15 +
    factors.financial_score * 0.15 +
    factors.account_age_score * 0.10 +
    factors.session_score * 0.10 +
    factors.multi_account_score * 0.15 +
    factors.velocity_score * 0.15
  );
}
```

---

## 7.2 Fraud Detection Rules

### Automated Flags
| Rule | Trigger | Severity |
|------|---------|----------|
| Multi-account | Same device fingerprint on 2+ accounts | High |
| Bot behavior | Exact same cashout timing every round | Critical |
| Collusion | Multiple accounts always betting together | Critical |
| Money laundering | Large deposit → minimal play → withdraw | High |
| Bonus abuse | Creating accounts to exploit sign-up bonuses | Medium |
| Unusual wins | 5+ consecutive high-multiplier cashouts | Medium |
| Timing exploit | Betting after crash point is determined | Critical |
| IP anomaly | VPN/proxy usage with rapid account switching | Medium |

### Admin Alert Queue
```
┌────────────────────────────────────────────────────┐
│ 🚨 FRAUD ALERTS (5 unresolved)                        │
├────────────────────────────────────────────────────┤
│ 🔴 CRITICAL: player55 + player56 same device           │
│    Detected: 2 min ago | Action: [Investigate] [Ban] │
│                                                      │
│ 🟠 HIGH: player23 deposit-withdraw pattern            │
│    KSh 50,000 deposited, 0 bets, withdrawal request │
│    Action: [Block Withdrawal] [Contact] [Dismiss]    │
│                                                      │
│ 🟡 MEDIUM: player78 unusually high win rate (78%)     │
│    Last 50 bets: 39 wins | Expected: ~45%           │
│    Action: [Monitor] [Restrict] [Dismiss]            │
└────────────────────────────────────────────────────┘
```

---

## 7.3 Device Fingerprinting

### Data Collected
- Browser user agent
- Screen resolution
- Timezone
- Language
- Canvas fingerprint
- WebGL renderer
- Installed fonts (subset)
- Touch support
- CPU cores

### Implementation
```typescript
// Client-side fingerprint generation
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const fp = await FingerprintJS.load();
const result = await fp.get();
const visitorId = result.visitorId;  // Store with each login
```

### Database
```sql
CREATE TABLE device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  fingerprint text NOT NULL,
  ip_address inet,
  user_agent text,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  login_count integer DEFAULT 1
);

-- Find multi-account users
CREATE INDEX idx_fingerprints_fp ON device_fingerprints(fingerprint);
```

---

## 7.4 Real-Time Monitoring Dashboard

### Live Indicators
- Active suspicious sessions (highlighted in red)
- Real-time win rate anomaly detection
- Deposit velocity tracker
- Multi-account cluster map
- Geographic heat map of active players

---

## 7.5 Investigation Tools

### Player Comparison
Side-by-side view of two suspected linked accounts:
- Registration details
- Device fingerprints
- IP history
- Betting patterns (timing overlap)
- Deposit sources

### Timeline View
Chronological view of all actions by a flagged player:
- Logins, bets, deposits, withdrawals, chat messages
- With timestamps, IPs, and device info
