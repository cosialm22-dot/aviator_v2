# 09 — Risk & Fraud Management

## Risk Scoring

Every player gets an automated risk score (0-100):

| Score | Level | Color | Action |
|-------|-------|-------|--------|
| 0-25 | Low | Green | Normal |
| 26-50 | Medium | Yellow | Monitor |
| 51-75 | High | Orange | Review required |
| 76-100 | Critical | Red | Auto-restrict |

## Scoring Factors

| Factor | Points | Description |
|--------|--------|-------------|
| High win rate | +20 | Win rate > 60% over 50+ bets |
| Rapid deposit-withdraw | +25 | Deposit and withdraw within 10 min |
| Multi-account suspected | +30 | Same IP/device as another user |
| Bot-like pattern | +35 | Identical bet amounts, precise timing |
| Large single bet | +10 | Bet > 5x their average |
| New account large activity | +15 | > KSh 10K wagered within first hour |
| Consistent cashout pattern | +20 | Always cashes out at same multiplier |
| Collusion suspected | +40 | Correlated betting with another user |

## Alert Types

| Alert | Trigger | Severity |
|-------|---------|----------|
| Whale Bet | Single bet > KSh 10,000 | Medium |
| Win Streak | 5+ consecutive wins | Medium |
| Large Withdrawal | Request > KSh 50,000 | High |
| Multi-Account | Same IP/fingerprint on 2+ accounts | High |
| Bot Detection | Automated betting pattern | Critical |
| Loss Recovery | Player betting 10x normal after losses | Medium |
| Rapid Deposit | 3+ deposits in 5 minutes | Medium |

## Admin Actions

| Action | Description |
|--------|-------------|
| Restrict betting | Set max bet to KSh 100 |
| Require verification | Force KYC before next withdrawal |
| Shadow ban | Player can play but all bets auto-lose (extreme) |
| Freeze account | Lock all activity pending review |
| Clear flags | Mark as reviewed, reset score |

## Dashboard View

```
/admin/risk
┌───────────────────────────────────────────┐
│ UNRESOLVED ALERTS: 7                       │
├───────────────────────────────────────────┤
│ 🔴 Bot detected: @user_x42 (2 min ago)      │
│ 🟠 Whale bet: @bigplayer KSh 45K (5m ago)  │
│ 🟠 Win streak: @lucky7 (8 wins, 12m ago)   │
│ 🟡 Large withdrawal: @user99 KSh 80K       │
└───────────────────────────────────────────┘
```
