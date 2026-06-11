# 🗄️ Module 13: Complete Database Schema

## Overview
Full database schema including all new tables needed for the comprehensive admin dashboard.

---

## 13.1 Schema Map

### Existing Tables (To Modify)
| Table | Changes Needed |
|-------|---------------|
| `profiles` | Add: `kyc_tier`, `kyc_status`, `risk_score`, `segment`, `phone`, `admin_role`, `is_self_excluded`, `daily_deposit_limit`, `daily_loss_limit` |
| `wallets` | Add: `total_deposited`, `total_withdrawn`, `last_deposit_at` |
| `game_rounds` | Add: `source` (algorithm/queue), `queue_id`, `total_bets_amount`, `total_payouts`, `round_profit` |
| `bets` | No changes needed |
| `transactions` | Add: `mpesa_receipt`, `mpesa_phone` |
| `withdrawal_requests` | Major expansion (see Module 4) |
| `crash_queue` | Already exists, needs `used_in_round` column |
| `mpesa_config` | Expand with more settings |
| `mpesa_stk_requests` | Expand with callback data |

### New Tables
| Table | Module | Purpose |
|-------|--------|---------|
| `mpesa_b2c_requests` | M-Pesa | Track B2C withdrawals |
| `affiliates` | Affiliate | Affiliate profiles |
| `affiliate_referrals` | Affiliate | Tracking referrals |
| `affiliate_commissions` | Affiliate | Daily commission records |
| `affiliate_payouts` | Affiliate | Payout history |
| `device_fingerprints` | Risk | Device tracking |
| `fraud_alerts` | Risk | Fraud detection alerts |
| `player_notes` | Players | Admin notes on players |
| `player_segments` | Players | Custom segment definitions |
| `bonus_campaigns` | Bonus | Promotion definitions |
| `player_bonuses` | Bonus | Player-claimed bonuses |
| `kyc_submissions` | KYC | Document submissions |
| `player_limits` | Responsible | Player-set limits |
| `self_exclusions` | Responsible | Self-exclusion records |
| `admin_roles` | RBAC | Role definitions |
| `notifications` | Notifications | Player notifications |
| `admin_alerts` | Notifications | Admin alert queue |
| `daily_revenue_summary` | Analytics | Materialized view |
| `hourly_activity` | Analytics | Materialized view |
| `player_sessions` | Analytics | Session tracking |

---

## 13.2 Full Migration SQL

```sql
-- ============================================
-- AVIATOR V2 - ADMIN DASHBOARD SCHEMA MIGRATION
-- ============================================

-- 1. PROFILE EXTENSIONS
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_tier integer DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_status text DEFAULT 'unverified';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS risk_score integer DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS segment text DEFAULT 'new';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_role_id uuid;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_self_excluded boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_deposited decimal(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_withdrawn decimal(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_wagered decimal(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_won decimal(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_deposit_limit decimal(12,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_loss_limit decimal(12,2);

-- 2. GAME ROUNDS EXTENSIONS
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS source text DEFAULT 'algorithm';
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS queue_id uuid;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS total_bets_amount decimal(12,2) DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS total_payouts decimal(12,2) DEFAULT 0;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS round_profit decimal(12,2) DEFAULT 0;

-- 3. CRASH QUEUE (enhanced)
ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS used_in_round uuid REFERENCES game_rounds(id);
ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS notes text;

-- 4. M-PESA B2C REQUESTS
CREATE TABLE IF NOT EXISTS mpesa_b2c_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid REFERENCES withdrawal_requests(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL,
  conversation_id text,
  originator_conversation_id text,
  mpesa_receipt_number text,
  result_code integer,
  result_desc text,
  status text DEFAULT 'initiated',
  callback_payload jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 5. AFFILIATE SYSTEM
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  referred_user_id uuid NOT NULL REFERENCES profiles(id),
  type text NOT NULL CHECK (type IN ('revenue_share', 'cpa')),
  amount decimal(12,2) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  player_wagered decimal(12,2) DEFAULT 0,
  player_losses decimal(12,2) DEFAULT 0,
  commission_rate decimal(5,2),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  amount decimal(12,2) NOT NULL,
  method text DEFAULT 'mpesa',
  phone_number text,
  mpesa_receipt text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 6. DEVICE FINGERPRINTS
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  fingerprint text NOT NULL,
  ip_address inet,
  user_agent text,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  login_count integer DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_device_fp ON device_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_user ON device_fingerprints(user_id);

-- 7. FRAUD ALERTS
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text NOT NULL,
  evidence jsonb,
  status text DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT now()
);

-- 8. PLAYER NOTES
CREATE TABLE IF NOT EXISTS player_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  admin_id uuid NOT NULL REFERENCES profiles(id),
  note text NOT NULL,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- 9. BONUS SYSTEM
CREATE TABLE IF NOT EXISTS bonus_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN (
    'welcome', 'deposit_match', 'free_bet', 'cashback',
    'referral', 'loyalty', 'event', 'no_deposit'
  )),
  value decimal(10,2) NOT NULL,
  max_amount decimal(12,2),
  wagering_requirement decimal(5,2) DEFAULT 1.00,
  min_deposit decimal(12,2) DEFAULT 0,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  target_segment text,
  max_claims integer,
  budget_cap decimal(12,2),
  current_cost decimal(12,2) DEFAULT 0,
  claims_count integer DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'expired', 'exhausted')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  campaign_id uuid NOT NULL REFERENCES bonus_campaigns(id),
  amount decimal(12,2) NOT NULL,
  wagering_required decimal(12,2) NOT NULL,
  wagering_completed decimal(12,2) DEFAULT 0,
  status text DEFAULT 'active' CHECK (
    status IN ('active', 'completed', 'expired', 'forfeited')
  ),
  claimed_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz
);

-- 10. KYC
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  tier integer NOT NULL CHECK (tier IN (1, 2)),
  id_type text CHECK (id_type IN ('national_id', 'passport', 'alien_id')),
  id_number text,
  full_name text,
  date_of_birth date,
  id_front_url text,
  id_back_url text,
  selfie_url text,
  poa_url text,
  ocr_data jsonb,
  face_match_score decimal(5,2),
  auto_check_passed boolean,
  status text DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'more_info_needed')
  ),
  rejection_reason text,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 11. RESPONSIBLE GAMBLING
CREATE TABLE IF NOT EXISTS player_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  limit_type text NOT NULL,
  limit_value decimal(12,2) NOT NULL,
  current_usage decimal(12,2) DEFAULT 0,
  set_by text DEFAULT 'player',
  effective_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS self_exclusions (
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

-- 12. RBAC
CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Insert default roles
INSERT INTO admin_roles (name, display_name, permissions) VALUES
('super_admin', 'Super Admin', ARRAY['*']),
('admin', 'Admin', ARRAY['dashboard.view','players.view','players.ban','players.balance','withdrawals.approve','game.queue','game.monitor','affiliates.manage','bonuses.manage','audit.view','export.data']),
('finance', 'Finance Manager', ARRAY['dashboard.view','players.view','players.balance','withdrawals.approve','mpesa.config','audit.view','export.data']),
('game_operator', 'Game Operator', ARRAY['dashboard.view','game.queue','game.algorithm','game.monitor','game.emergency','game.bots']),
('support', 'Support Agent', ARRAY['dashboard.view','players.view','players.ban','players.balance_limited','players.notes']),
('marketing', 'Marketing Manager', ARRAY['dashboard.view','players.view','affiliates.manage','bonuses.manage','export.data']),
('compliance', 'Compliance Officer', ARRAY['dashboard.view','players.view','players.ban','kyc.review','responsible.manage','audit.view','export.data']),
('viewer', 'Viewer', ARRAY['dashboard.view'])
ON CONFLICT (name) DO NOTHING;

-- 13. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  channel text DEFAULT 'in_app',
  is_read boolean DEFAULT false,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  acknowledged boolean DEFAULT false,
  acknowledged_by uuid REFERENCES profiles(id),
  acknowledged_at timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- 14. PLAYER SESSIONS
CREATE TABLE IF NOT EXISTS player_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  bets_placed integer DEFAULT 0,
  amount_wagered decimal(12,2) DEFAULT 0,
  amount_won decimal(12,2) DEFAULT 0,
  ip_address inet,
  device_fingerprint text
);

-- 15. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_unacked ON admin_alerts(acknowledged) WHERE acknowledged = false;
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_open ON fraud_alerts(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_kyc_pending ON kyc_submissions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_player_sessions_user ON player_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate ON affiliate_referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_bonus_active ON bonus_campaigns(status) WHERE status = 'active';
```

---

## 13.3 Materialized Views

```sql
-- Revenue summary (refresh every 5 minutes via pg_cron)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_revenue AS
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT CASE WHEN is_bot = false THEN user_id END) as active_players,
  SUM(CASE WHEN is_bot = false THEN amount ELSE 0 END) as total_wagered,
  SUM(CASE WHEN is_bot = false AND status = 'won' THEN winnings ELSE 0 END) as total_paid,
  SUM(CASE WHEN is_bot = false THEN amount ELSE 0 END) -
    SUM(CASE WHEN is_bot = false AND status = 'won' THEN winnings ELSE 0 END) as revenue,
  COUNT(CASE WHEN is_bot = false THEN 1 END) as total_bets,
  COUNT(CASE WHEN is_bot = false AND status = 'won' THEN 1 END) as winning_bets
FROM bets
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Crash distribution analysis
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crash_distribution AS
SELECT
  CASE
    WHEN crash_multiplier = 1.00 THEN '1.00x (instant)'
    WHEN crash_multiplier < 1.50 THEN '1.01-1.49x'
    WHEN crash_multiplier < 2.50 THEN '1.50-2.49x'
    WHEN crash_multiplier < 6.00 THEN '2.50-5.99x'
    WHEN crash_multiplier < 20.00 THEN '6.00-19.99x'
    ELSE '20x+'
  END as range,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
FROM game_rounds
WHERE status = 'crashed'
GROUP BY 1
ORDER BY MIN(crash_multiplier);
```
