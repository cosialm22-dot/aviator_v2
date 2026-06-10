# 02 — Database Schema

## Existing Tables (Player App)

| Table | Status |
|-------|--------|
| `profiles` | ✅ Exists |
| `wallets` | ✅ Exists |
| `game_rounds` | ✅ Exists |
| `bets` | ✅ Exists |
| `transactions` | ✅ Exists |
| `chat_messages` | ✅ Exists |

## New Tables for Admin Dashboard

### `admin_users`
Separate admin authentication — not linked to player profiles.

```sql
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',  -- 'super_admin', 'admin', 'finance', 'support', 'marketing'
  is_active BOOLEAN DEFAULT true,
  two_factor_secret TEXT,               -- TOTP secret for 2FA
  two_factor_enabled BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Roles:
-- super_admin: Full access to everything
-- admin: All except system settings and other admin management
-- finance: Transactions, withdrawals, M-Pesa, revenue reports
-- support: User management, chat moderation
-- marketing: Affiliates, promotions, analytics
```

### `admin_sessions`
JWT-less session management for admin panel.

```sql
CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,           -- Random session token
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,      -- 30 min from last activity
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_admin_sessions_token ON admin_sessions(token);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);
```

### `admin_audit_log`
Every admin action is recorded.

```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admin_users(id),
  action TEXT NOT NULL,                  -- 'user.ban', 'withdrawal.approve', 'crash.override', etc.
  target_type TEXT,                      -- 'user', 'transaction', 'game_round', 'setting'
  target_id TEXT,                        -- ID of the affected record
  details JSONB,                         -- Additional context
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_audit_log_created ON admin_audit_log(created_at DESC);
```

### `crash_queue`
Pre-generated crash points for upcoming rounds.

```sql
CREATE TABLE crash_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position INTEGER NOT NULL,             -- Order in queue (1 = next round)
  crash_multiplier NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'algorithm',  -- 'algorithm', 'manual_override'
  server_seed TEXT NOT NULL,             -- For provably fair verification
  hashed_seed TEXT NOT NULL,             -- SHA-256 of server_seed (public)
  is_used BOOLEAN DEFAULT false,
  used_in_round_id UUID REFERENCES game_rounds(id),
  created_by UUID REFERENCES admin_users(id),  -- NULL if algorithm-generated
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_crash_queue_position ON crash_queue(position) WHERE NOT is_used;
```

### `game_seeds`
Master seeds for crash point generation algorithm.

```sql
CREATE TABLE game_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_seed TEXT NOT NULL,
  hashed_server_seed TEXT NOT NULL,      -- Shown to players for verification
  client_seed TEXT,                       -- Optional player-contributed entropy
  nonce INTEGER DEFAULT 0,               -- Increments per round
  is_active BOOLEAN DEFAULT true,
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### `algorithm_config`
Game algorithm parameters (editable by admin).

```sql
CREATE TABLE algorithm_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Default values:
-- house_edge_percent: '4'
-- max_multiplier: '100'
-- min_crash: '1.01'
-- max_consecutive_high: '3'       (max rounds above 10x in a row)
-- emergency_low_threshold: '50000' (if house loses > 50K KES in 1hr, bias low)
```

### `affiliates`
Existing players promoted to affiliate status.

```sql
CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id),
  referral_code TEXT UNIQUE NOT NULL,    -- e.g., 'JOHN2024'
  commission_rate NUMERIC NOT NULL DEFAULT 0.20,  -- 20% of house revenue
  commission_model TEXT NOT NULL DEFAULT 'revenue_share',  -- 'revenue_share', 'cpa', 'hybrid'
  cpa_amount NUMERIC DEFAULT 0,          -- Fixed amount per new depositing player
  tier TEXT DEFAULT 'bronze',            -- 'bronze', 'silver', 'gold', 'platinum'
  status TEXT DEFAULT 'active',          -- 'active', 'paused', 'terminated'
  total_earned NUMERIC DEFAULT 0,
  total_paid NUMERIC DEFAULT 0,
  total_referrals INTEGER DEFAULT 0,
  promoted_by UUID REFERENCES admin_users(id),
  promoted_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_affiliates_code ON affiliates(referral_code);
CREATE INDEX idx_affiliates_user ON affiliates(user_id);
```

### `affiliate_referrals`
Tracking which players came through which affiliate.

```sql
CREATE TABLE affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  referred_user_id UUID NOT NULL REFERENCES profiles(id),
  has_deposited BOOLEAN DEFAULT false,
  first_deposit_at TIMESTAMPTZ,
  first_deposit_amount NUMERIC,
  total_wagered NUMERIC DEFAULT 0,       -- Lifetime wagered by this referred user
  total_revenue_generated NUMERIC DEFAULT 0,  -- House profit from this user
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_referral_unique ON affiliate_referrals(referred_user_id);
CREATE INDEX idx_referrals_affiliate ON affiliate_referrals(affiliate_id);
```

### `affiliate_commissions`
Periodic commission calculations.

```sql
CREATE TABLE affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_revenue NUMERIC NOT NULL DEFAULT 0,  -- Total house revenue from their referrals
  commission_rate NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',         -- 'pending', 'approved', 'paid', 'disputed'
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,                -- M-Pesa transaction ID
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### `mpesa_config`
Encrypted M-Pesa API credentials.

```sql
CREATE TABLE mpesa_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL DEFAULT 'sandbox',  -- 'sandbox', 'production'
  consumer_key TEXT NOT NULL,            -- Encrypted
  consumer_secret TEXT NOT NULL,         -- Encrypted
  passkey TEXT NOT NULL,                 -- Encrypted (for STK Push)
  business_short_code TEXT NOT NULL,     -- Paybill number
  initiator_name TEXT,                   -- For B2C
  security_credential TEXT,              -- For B2C (encrypted)
  callback_base_url TEXT NOT NULL,       -- Base URL for callbacks
  c2b_confirmation_url TEXT,
  c2b_validation_url TEXT,
  b2c_result_url TEXT,
  b2c_timeout_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_token_at TIMESTAMPTZ,             -- When OAuth token was last fetched
  updated_by UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### `mpesa_transactions`
Raw M-Pesa transaction records from callbacks.

```sql
CREATE TABLE mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL,               -- 'inbound' (C2B deposit) or 'outbound' (B2C withdrawal)
  transaction_type TEXT NOT NULL,        -- 'CustomerPayBillOnline', 'B2CPayment'
  mpesa_receipt TEXT UNIQUE,             -- Safaricom receipt number
  phone_number TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  account_reference TEXT,                -- For C2B: what user typed as account
  result_code INTEGER,
  result_desc TEXT,
  raw_callback JSONB,                    -- Full callback payload
  internal_transaction_id UUID REFERENCES transactions(id),
  user_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending',         -- 'pending', 'completed', 'failed', 'reversed'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_mpesa_tx_receipt ON mpesa_transactions(mpesa_receipt);
CREATE INDEX idx_mpesa_tx_phone ON mpesa_transactions(phone_number);
CREATE INDEX idx_mpesa_tx_user ON mpesa_transactions(user_id);
```

### `withdrawal_requests`
Separate queue for withdrawal approvals.

```sql
CREATE TABLE withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  phone_number TEXT NOT NULL,            -- Where to send M-Pesa
  status TEXT DEFAULT 'pending',         -- 'pending', 'approved', 'processing', 'completed', 'rejected', 'failed'
  auto_approved BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  mpesa_transaction_id UUID REFERENCES mpesa_transactions(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_withdrawals_status ON withdrawal_requests(status);
CREATE INDEX idx_withdrawals_user ON withdrawal_requests(user_id);
```

### `promotions`
Bonus campaigns and promo codes.

```sql
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,                    -- 'welcome_bonus', 'deposit_match', 'free_bet', 'cashback', 'promo_code'
  code TEXT UNIQUE,                      -- Promo code (if applicable)
  value NUMERIC NOT NULL,                -- Amount or percentage
  value_type TEXT NOT NULL DEFAULT 'fixed',  -- 'fixed', 'percentage'
  max_bonus NUMERIC,                     -- Cap for percentage bonuses
  min_deposit NUMERIC,                   -- Minimum deposit to qualify
  wagering_requirement NUMERIC DEFAULT 1,  -- X times wagering before withdrawal
  max_uses INTEGER,                      -- Total redemptions allowed
  uses_count INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### `user_bonuses`
Bonuses awarded to specific players.

```sql
CREATE TABLE user_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  promotion_id UUID REFERENCES promotions(id),
  amount NUMERIC NOT NULL,               -- Bonus amount credited
  wagering_required NUMERIC NOT NULL,    -- Total amount to wager before unlock
  wagering_completed NUMERIC DEFAULT 0,  -- Amount wagered so far
  status TEXT DEFAULT 'active',          -- 'active', 'completed', 'expired', 'cancelled'
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### `player_risk_scores`
Automated risk assessment per player.

```sql
CREATE TABLE player_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id),
  risk_level TEXT DEFAULT 'low',         -- 'low', 'medium', 'high', 'critical'
  risk_score INTEGER DEFAULT 0,          -- 0-100
  flags JSONB DEFAULT '[]',              -- Array of flag reasons
  last_assessed_at TIMESTAMPTZ DEFAULT now(),
  assessed_by TEXT DEFAULT 'system',     -- 'system' or admin_id
  notes TEXT
);

-- Flag examples:
-- {"flag": "high_win_rate", "detail": "Win rate 68% over last 100 bets"}
-- {"flag": "rapid_withdrawal", "detail": "Deposited and withdrew within 5 min"}
-- {"flag": "multi_account", "detail": "Same IP as user xyz"}
-- {"flag": "bot_pattern", "detail": "Identical bet amounts, consistent timing"}
```

### `risk_alerts`
Real-time alerts for admin attention.

```sql
CREATE TABLE risk_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  alert_type TEXT NOT NULL,              -- 'whale_bet', 'win_streak', 'multi_account', 'large_withdrawal'
  severity TEXT NOT NULL DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB,
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES admin_users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alerts_unresolved ON risk_alerts(is_resolved, severity) WHERE NOT is_resolved;
```

### `system_settings`
General key-value configuration.

```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL,                -- 'game', 'finance', 'marketing', 'system'
  description TEXT,
  is_sensitive BOOLEAN DEFAULT false,    -- If true, mask in UI
  updated_by UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Default settings:
-- game.min_bet: '50'
-- game.max_bet: '50000'
-- game.waiting_duration_ms: '5000'
-- game.post_crash_duration_ms: '3000'
-- game.bot_count_min: '8'
-- game.bot_count_max: '20'
-- finance.min_deposit: '50'
-- finance.min_withdrawal: '100'
-- finance.max_daily_withdrawal: '100000'
-- finance.auto_approve_threshold: '5000'
-- finance.withdrawal_fee_percent: '0'
-- marketing.welcome_bonus_enabled: 'false'
-- marketing.referral_bonus_amount: '100'
-- system.maintenance_mode: 'false'
-- system.maintenance_message: 'We are upgrading...'
```

### `notifications`
Admin-to-player communications.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,             -- 'all', 'segment', 'individual'
  target_user_id UUID REFERENCES profiles(id),  -- For individual
  target_filter JSONB,                   -- For segment (e.g., {"min_balance": 0, "max_balance": 100})
  channel TEXT NOT NULL,                 -- 'in_app', 'sms', 'both'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Modifications to Existing Tables

### `profiles` — Add columns:
```sql
ALTER TABLE profiles ADD COLUMN phone_number TEXT;
ALTER TABLE profiles ADD COLUMN is_banned BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN ban_reason TEXT;
ALTER TABLE profiles ADD COLUMN banned_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN banned_by UUID REFERENCES admin_users(id);
ALTER TABLE profiles ADD COLUMN is_affiliate BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN referred_by UUID REFERENCES affiliates(id);
ALTER TABLE profiles ADD COLUMN last_active_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN total_wagered NUMERIC DEFAULT 0;
ALTER TABLE profiles ADD COLUMN total_deposited NUMERIC DEFAULT 0;
ALTER TABLE profiles ADD COLUMN total_withdrawn NUMERIC DEFAULT 0;
ALTER TABLE profiles ADD COLUMN vip_tier TEXT DEFAULT 'standard';  -- 'standard', 'silver', 'gold', 'vip'
ALTER TABLE profiles ADD COLUMN admin_notes TEXT;
```

### `game_rounds` — Add columns:
```sql
ALTER TABLE game_rounds ADD COLUMN total_wagered NUMERIC DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN total_paid_out NUMERIC DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN house_profit NUMERIC DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN player_count INTEGER DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN seed_id UUID REFERENCES game_seeds(id);
ALTER TABLE game_rounds ADD COLUMN was_overridden BOOLEAN DEFAULT false;
```

## Database Triggers

```sql
-- Auto-update profiles.last_active_at on bet placement
CREATE OR REPLACE FUNCTION update_last_active() RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles SET last_active_at = now() WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bet_activity
  AFTER INSERT ON bets
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND NOT NEW.is_bot)
  EXECUTE FUNCTION update_last_active();

-- Auto-update profiles.total_wagered
CREATE OR REPLACE FUNCTION update_total_wagered() RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles SET total_wagered = total_wagered + NEW.amount
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wager_tracking
  AFTER INSERT ON bets
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND NOT NEW.is_bot)
  EXECUTE FUNCTION update_total_wagered();

-- Auto-calculate round profit after crash
CREATE OR REPLACE FUNCTION calculate_round_profit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'crashed' AND OLD.status = 'flying' THEN
    NEW.house_profit = NEW.total_wagered - NEW.total_paid_out;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_round_profit
  BEFORE UPDATE ON game_rounds
  FOR EACH ROW
  EXECUTE FUNCTION calculate_round_profit();
```

## Row Level Security (Admin)

```sql
-- Admin tables: No RLS (accessed via service_role key only)
-- Player tables: Existing RLS stays; admin uses service_role to bypass

-- Ensure admin tables are only accessible server-side
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies = no access via anon/authenticated key
-- Admin dashboard uses service_role key exclusively
```
