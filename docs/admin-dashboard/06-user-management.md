# 06 — User Management

## Player List Page (`/admin/users`)

### Features:
- **Search**: By username, phone number, user ID
- **Filters**: Status (active/banned), balance range, last active, VIP tier, risk level
- **Sort**: By join date, balance, total wagered, last active
- **Bulk actions**: Ban multiple, export list

### Columns:
| Column | Description |
|--------|-------------|
| Avatar + Username | Color avatar + display name |
| Phone | Registered phone (if set) |
| Balance | Current wallet balance (KES) |
| Total Wagered | Lifetime bet volume |
| Win/Loss | Net P&L for the player |
| Last Active | Relative time |
| Risk | Color badge (low/med/high) |
| Status | Active / Banned |
| Actions | View, Ban, Adjust |

### Pagination:
- 50 users per page
- Server-side pagination (offset/limit)
- Total count displayed

## Player Detail Page (`/admin/users/:id`)

### Sections:

#### 1. Profile Header
- Avatar, username, user ID
- Phone number, join date
- VIP tier badge
- Risk score indicator
- Status (active/banned)
- Quick actions: Ban, Credit, Debit, Make Affiliate

#### 2. Wallet & Financials
- Current balance
- Total deposited (lifetime)
- Total withdrawn (lifetime)
- Total wagered
- Net P&L (from house perspective)
- Bonus balance (if any active bonus)

#### 3. Bet History
- Table of all bets: round, amount, cashout, winnings, status
- Filterable by date range, status (won/lost)
- Win rate percentage
- Average bet size
- Favorite bet amount

#### 4. Transaction History
- All deposits, withdrawals, bets, wins
- M-Pesa receipt numbers
- Status of each transaction

#### 5. Activity Timeline
- Chronological feed of all actions
- Registration, deposits, bets, withdrawals, chat messages

#### 6. Admin Notes
- Free-text notes field
- Only visible to admins
- Timestamped with author

#### 7. Referral Info
- Who referred this player (if anyone)
- If affiliate: their referral stats

## Actions

### Ban User
```
Dialog:
- Ban type: Temporary (duration picker) / Permanent
- Reason: [text input] (required)
- Also ban from chat: [checkbox]
- Forfeit balance: [checkbox] (extreme cases)
- [Confirm Ban]
```

### Adjust Balance
```
Dialog:
- Type: Credit / Debit
- Amount: [number input]
- Reason: [text input] (required, stored in audit log)
- [Confirm]
```
Credits/debits create a transaction record with type 'admin_adjustment'.

### Force Password Reset
- Invalidates all player sessions
- Sends reset link via SMS (if phone available)

### Promote to Affiliate
- Opens affiliate setup dialog
- Configures code, rate, model
- See [07-affiliate-system.md]
