# 14 — API Endpoints

## Admin Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /admin/api/auth/login | Admin login |
| POST | /admin/api/auth/logout | End session |
| POST | /admin/api/auth/verify-2fa | Verify TOTP code |
| GET | /admin/api/auth/me | Get current admin profile |

## Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/dashboard/stats | KPI summary |
| GET | /admin/api/dashboard/revenue?days=7 | Revenue data for chart |
| GET | /admin/api/dashboard/activity | Recent activity feed |

## Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/users?page=1&search=&filter= | List users |
| GET | /admin/api/users/:id | User detail |
| GET | /admin/api/users/:id/bets | User bet history |
| GET | /admin/api/users/:id/transactions | User transactions |
| POST | /admin/api/users/:id/ban | Ban user |
| POST | /admin/api/users/:id/unban | Unban user |
| POST | /admin/api/users/:id/adjust-balance | Credit/debit |
| POST | /admin/api/users/:id/promote-affiliate | Make affiliate |

## Finance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/transactions?type=&status=&page= | List transactions |
| GET | /admin/api/withdrawals?status=pending | Withdrawal queue |
| POST | /admin/api/withdrawals/:id/approve | Approve withdrawal |
| POST | /admin/api/withdrawals/:id/reject | Reject withdrawal |
| POST | /admin/api/withdrawals/bulk-approve | Approve multiple |

## M-Pesa

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/mpesa/config | Get M-Pesa config |
| PUT | /admin/api/mpesa/config | Update config |
| POST | /admin/api/mpesa/test-connection | Test API connectivity |
| GET | /admin/api/mpesa/transactions | M-Pesa transaction log |

## Game Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/game/status | Current game state |
| GET | /admin/api/game/crash-queue | View upcoming crash points |
| POST | /admin/api/game/inject-crash | Insert manual crash point |
| POST | /admin/api/game/force-crash | Force crash current round |
| POST | /admin/api/game/pause | Pause game |
| POST | /admin/api/game/resume | Resume game |
| GET | /admin/api/game/algorithm-config | Get algorithm settings |
| PUT | /admin/api/game/algorithm-config | Update settings |
| GET | /admin/api/game/rounds?page= | Round history with P&L |

## Affiliates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/affiliates | List all affiliates |
| GET | /admin/api/affiliates/:id | Affiliate detail |
| PUT | /admin/api/affiliates/:id | Update affiliate settings |
| POST | /admin/api/affiliates/:id/pause | Pause affiliate |
| POST | /admin/api/affiliates/:id/terminate | Terminate |
| GET | /admin/api/affiliates/:id/referrals | Referred players |
| GET | /admin/api/affiliates/:id/commissions | Commission history |
| POST | /admin/api/affiliates/calculate | Trigger commission calc |
| POST | /admin/api/affiliates/:id/payout | Process payout |

## Risk

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/risk/alerts?resolved=false | Active alerts |
| POST | /admin/api/risk/alerts/:id/resolve | Resolve alert |
| GET | /admin/api/risk/scores | Players by risk score |

## Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/analytics/revenue?period= | Revenue data |
| GET | /admin/api/analytics/players?metric= | Player metrics |
| GET | /admin/api/analytics/retention?cohort= | Retention data |
| GET | /admin/api/analytics/export?report=&format= | Export report |

## Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/api/settings | All settings |
| PUT | /admin/api/settings/:key | Update setting |
| GET | /admin/api/audit-log?page=&admin=&action= | Audit log |
| POST | /admin/api/admins | Create admin (super only) |
| PUT | /admin/api/admins/:id | Update admin |
| DELETE | /admin/api/admins/:id | Deactivate admin |

## Notes

- All endpoints require valid admin session token in `Authorization: Bearer <token>` header
- All write operations create audit log entries automatically
- Pagination uses `?page=1&limit=50` format
- Dates in ISO 8601 format
- All amounts in KES (no conversion needed)
