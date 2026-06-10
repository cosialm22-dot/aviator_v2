-- ============================================================
-- AVIATOR ADMIN DASHBOARD - Database Migration
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Add role column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_wagered NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_deposited NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_withdrawn NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- 2. Admin audit log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. System settings
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Crash queue
CREATE TABLE IF NOT EXISTS crash_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crash_multiplier NUMERIC NOT NULL,
  position INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'algorithm',
  is_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  used_at TIMESTAMPTZ,
  round_id UUID REFERENCES game_rounds(id),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  review_note TEXT,
  auto_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 6. M-Pesa config
CREATE TABLE IF NOT EXISTS mpesa_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL DEFAULT 'sandbox',
  consumer_key TEXT NOT NULL DEFAULT '',
  consumer_secret TEXT NOT NULL DEFAULT '',
  passkey TEXT NOT NULL DEFAULT '',
  shortcode TEXT NOT NULL DEFAULT '174379',
  b2c_shortcode TEXT DEFAULT '174379',
  initiator_name TEXT DEFAULT 'testapi',
  security_credential TEXT DEFAULT '',
  callback_base_url TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. M-Pesa STK requests
CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  phone_number TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  response_code TEXT,
  response_description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result_code TEXT,
  result_description TEXT,
  mpesa_receipt_number TEXT,
  transaction_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 8. Affiliates
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  affiliate_code TEXT UNIQUE NOT NULL,
  commission_type TEXT NOT NULL DEFAULT 'revenue_share',
  commission_rate NUMERIC NOT NULL DEFAULT 20.0,
  cpa_amount NUMERIC NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'bronze',
  status TEXT NOT NULL DEFAULT 'active',
  total_referrals INTEGER NOT NULL DEFAULT 0,
  total_earnings NUMERIC NOT NULL DEFAULT 0,
  phone_number TEXT,
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Affiliate referrals
CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  referred_user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'registered',
  first_deposit_at TIMESTAMPTZ,
  total_wagered NUMERIC NOT NULL DEFAULT 0,
  total_losses NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Player risk scores
CREATE TABLE IF NOT EXISTS player_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  risk_level TEXT NOT NULL DEFAULT 'low',
  score INTEGER NOT NULL DEFAULT 0,
  flags JSONB NOT NULL DEFAULT '[]',
  last_assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- 11. Indexes
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_queue_pending ON crash_queue(position) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_checkout ON mpesa_stk_requests(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(affiliate_code);
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON affiliate_referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role) WHERE role != 'player';

-- 12. RLS
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crash_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_stk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_risk_scores ENABLE ROW LEVEL SECURITY;

-- 13. RLS Policies
CREATE POLICY admin_full_access ON admin_audit_log FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON system_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON crash_queue FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON withdrawal_requests FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));
CREATE POLICY user_read_own ON withdrawal_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY admin_full_access ON mpesa_config FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON mpesa_stk_requests FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));
CREATE POLICY user_read_own ON mpesa_stk_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY admin_full_access ON affiliates FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON affiliate_referrals FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY admin_full_access ON player_risk_scores FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

-- 14. Default system settings
INSERT INTO system_settings (key, value, category, description) VALUES
  ('game.house_edge_percent', '4', 'game', 'House edge percentage'),
  ('game.min_bet', '50', 'game', 'Minimum bet in KES'),
  ('game.max_bet', '50000', 'game', 'Maximum bet in KES'),
  ('game.max_multiplier', '100', 'game', 'Maximum crash multiplier'),
  ('finance.auto_approve_threshold', '5000', 'finance', 'Auto-approve withdrawals below this'),
  ('finance.min_withdrawal', '100', 'finance', 'Minimum withdrawal in KES'),
  ('finance.max_daily_withdrawal', '100000', 'finance', 'Max daily withdrawal per user'),
  ('system.maintenance_mode', 'false', 'system', 'Maintenance mode flag')
ON CONFLICT (key) DO NOTHING;

-- 15. Initial M-Pesa sandbox config
INSERT INTO mpesa_config (environment, shortcode, callback_base_url)
VALUES ('sandbox', '174379', 'https://yhfxgzfmcwinpgmzcgma.supabase.co/functions/v1')
ON CONFLICT DO NOTHING;

-- ============================================================
-- IMPORTANT: After running this migration, promote your account to super_admin:
-- UPDATE profiles SET role = 'super_admin' WHERE username = 'YOUR_USERNAME';
-- ============================================================
