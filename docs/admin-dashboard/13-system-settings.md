# 13 — System Settings

## Categories

### Game Settings
| Key | Default | Description |
|-----|---------|-------------|
| game.min_bet | 50 | Minimum bet amount (KES) |
| game.max_bet | 50000 | Maximum bet amount (KES) |
| game.waiting_duration_ms | 5000 | Countdown duration |
| game.post_crash_duration_ms | 3000 | Time showing crash before next round |
| game.bot_count_min | 8 | Minimum bot players per round |
| game.bot_count_max | 20 | Maximum bot players per round |
| game.bot_bet_min | 50 | Minimum bot bet |
| game.bot_bet_max | 5000 | Maximum bot bet |

### Finance Settings
| Key | Default | Description |
|-----|---------|-------------|
| finance.min_deposit | 50 | Min deposit amount |
| finance.max_deposit | 150000 | Max single deposit |
| finance.min_withdrawal | 100 | Min withdrawal amount |
| finance.max_daily_withdrawal | 100000 | Max per day per user |
| finance.auto_approve_threshold | 5000 | Auto-approve withdrawals below this |
| finance.withdrawal_fee_percent | 0 | Fee on withdrawals |

### Marketing Settings
| Key | Default | Description |
|-----|---------|-------------|
| marketing.welcome_bonus_enabled | false | |
| marketing.welcome_bonus_percent | 100 | |
| marketing.welcome_bonus_max | 1000 | |
| marketing.referral_bonus_referrer | 100 | |
| marketing.referral_bonus_referee | 50 | |

### System Settings
| Key | Default | Description |
|-----|---------|-------------|
| system.maintenance_mode | false | Block all player access |
| system.maintenance_message | "Upgrading..." | Shown during maintenance |
| system.require_phone | false | Require phone on registration |
| system.min_withdrawal_bets | 3 | Min bets before withdrawal allowed |

## Admin Management

- Create new admin accounts (super_admin only)
- Deactivate admin accounts
- Reset admin passwords
- View admin activity log
- Force 2FA enrollment

## Maintenance Mode

When enabled:
- Player app shows maintenance screen
- No new bets accepted
- Current round completes normally
- Admin dashboard remains accessible
- All ongoing withdrawals continue processing
