# 08 — Financial Management

## Overview Page (`/admin/finance`)

### KPI Cards:
- **Today's Revenue**: Total bets - total wins today
- **Pending Withdrawals**: Count + total amount
- **Total Deposits (7d)**: Sum of inbound
- **Total Withdrawals (7d)**: Sum of outbound
- **M-Pesa Balance**: (when production - API check)
- **Player Wallets Total**: Sum of all balances

### Revenue Chart
- Daily revenue trend (30 days)
- Toggle: Revenue / Deposits / Withdrawals
- Running total vs target

## Transaction List (`/admin/finance/transactions`)

### Filters:
- Type: All / Deposit / Withdrawal / Bet / Win / Admin Adjustment
- Status: All / Completed / Pending / Failed
- Date range picker
- User search
- Amount range
- Payment method: M-Pesa / System

### Export:
- CSV download with all filtered data
- Date range selection for export

## Withdrawal Queue (`/admin/finance/withdrawals`)

### Auto-Approve Rules:
```
Settings:
- Auto-approve threshold: KSh [5000] (withdrawals below this auto-approve)
- Require manual review if:
  - User registered < 24 hours ago
  - User risk score > 60
  - Amount > daily limit for user tier
  - User has never deposited (bonus-only withdrawal)
```

### Queue Interface:
```
┌────────────────────────────────────────────────────────────┐
│ PENDING WITHDRAWALS (12)                     [✅ Approve All]│
├────────────────────────────────────────────────────────────┤
│ User      | Phone         | Amount  | Requested  | Action   │
│ @player1  | 2547xxx890    | 2,500   | 3 min ago  | [✅][❌]  │
│ @player2  | 2547xxx456    | 15,000  | 12 min ago | [✅][❌]  │
│ @whale99  | 2547xxx123    | 95,000  | 1 hr ago   | [✅][❌]  │
└────────────────────────────────────────────────────────────┘
```

### Reject Reasons (predefined + custom):
- Suspicious activity
- Incomplete wagering requirement
- Verification required
- Exceeds daily limit
- Custom: [text input]

## Daily Limits

| User Tier | Per Withdrawal Max | Daily Max | Monthly Max |
|-----------|-------------------|-----------|-------------|
| Standard | KSh 50,000 | KSh 100,000 | KSh 500,000 |
| Silver | KSh 100,000 | KSh 200,000 | KSh 1,000,000 |
| Gold | KSh 200,000 | KSh 500,000 | KSh 2,000,000 |
| VIP | KSh 500,000 | KSh 1,000,000 | Unlimited |

## Reconciliation

Daily reconciliation view:
- Total M-Pesa inbound vs total wallet credits
- Total M-Pesa outbound vs total wallet debits
- Mismatch flags (red indicators)
- Manual reconciliation tool for discrepancies
