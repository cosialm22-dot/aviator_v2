-- ============================================
-- AVIATOR V2 - PHASE 1 DATABASE MIGRATIONS
-- ============================================
-- This migration adds all tables and columns needed for Phase 1
-- Deployment: Apply to production after testing locally
-- Rollback: See rollback section at end

-- ============================================
-- 1. CREATE MPESA_STK_REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL,
  checkout_request_id text UNIQUE NOT NULL,
  merchant_request_id text,
  mpesa_receipt_number text UNIQUE,
  result_code integer,
  result_desc text,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'completed', 'failed', 'cancelled', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  CONSTRAINT valid_amount CHECK (amount >= 100 AND amount <= 150000),
  CONSTRAINT valid_phone CHECK (phone_number ~ '^254[0-9]{9}$')
);

-- Indexes for performance
CREATE INDEX idx_stk_user_id ON mpesa_stk_requests(user_id);
CREATE INDEX idx_stk_status ON mpesa_stk_requests(status) WHERE status IN ('initiated', 'pending');
CREATE INDEX idx_stk_checkout_id ON mpesa_stk_requests(checkout_request_id);
CREATE INDEX idx_stk_receipt ON mpesa_stk_requests(mpesa_receipt_number);
CREATE INDEX idx_stk_created_at ON mpesa_stk_requests(created_at DESC);

-- RLS Policies
ALTER TABLE mpesa_stk_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own STK requests"
  ON mpesa_stk_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert STK requests"
  ON mpesa_stk_requests FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update STK requests"
  ON mpesa_stk_requests FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 2. CREATE MPESA_B2C_REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS mpesa_b2c_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid NOT NULL REFERENCES withdrawal_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount decimal(12,2) NOT NULL,
  conversation_id text UNIQUE NOT NULL,
  originator_conversation_id text,
  mpesa_receipt_number text UNIQUE,
  result_code integer,
  result_desc text,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'processing', 'completed', 'failed', 'timeout'
  )),
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  CONSTRAINT valid_amount CHECK (amount >= 100 AND amount <= 150000),
  CONSTRAINT valid_phone CHECK (phone_number ~ '^254[0-9]{9}$')
);

-- Indexes
CREATE INDEX idx_b2c_user_id ON mpesa_b2c_requests(user_id);
CREATE INDEX idx_b2c_status ON mpesa_b2c_requests(status) WHERE status IN ('initiated', 'pending', 'processing');
CREATE INDEX idx_b2c_conversation_id ON mpesa_b2c_requests(conversation_id);
CREATE INDEX idx_b2c_receipt ON mpesa_b2c_requests(mpesa_receipt_number);
CREATE INDEX idx_b2c_withdrawal_id ON mpesa_b2c_requests(withdrawal_request_id);
CREATE INDEX idx_b2c_created_at ON mpesa_b2c_requests(created_at DESC);

-- RLS Policies
ALTER TABLE mpesa_b2c_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own B2C requests"
  ON mpesa_b2c_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage B2C requests"
  ON mpesa_b2c_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 3. ENHANCE WITHDRAWAL_REQUESTS TABLE
-- ============================================
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  risk_score integer DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100);

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  risk_flags jsonb DEFAULT '[]'::jsonb;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  reviewed_by uuid REFERENCES profiles(id);

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  reviewed_at timestamptz;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  rejection_reason text;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  auto_approved boolean DEFAULT false;

ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS
  mpesa_receipt text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wr_status_pending ON withdrawal_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wr_risk_score ON withdrawal_requests(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_wr_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wr_auto_approved ON withdrawal_requests(auto_approved) WHERE auto_approved = true;

-- ============================================
-- 4. ENHANCE GAME_ROUNDS TABLE
-- ============================================
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  source text DEFAULT 'algorithm' CHECK (source IN ('algorithm', 'queue'));

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  queue_id uuid REFERENCES crash_queue(id);

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  total_bets_amount decimal(12,2) DEFAULT 0;

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS
  total_payouts decimal(12,2) DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_game_rounds_source ON game_rounds(source);
CREATE INDEX IF NOT EXISTS idx_game_rounds_queue_id ON game_rounds(queue_id);

-- ============================================
-- 5. ENHANCE CRASH_QUEUE TABLE
-- ============================================
ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS
  batch_id uuid;

ALTER TABLE crash_queue ADD COLUMN IF NOT EXISTS
  notes text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crash_queue_pending ON crash_queue(position) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_crash_queue_batch_id ON crash_queue(batch_id);

-- ============================================
-- 6. ENHANCE PROFILES TABLE
-- ============================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_deposited decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_withdrawn decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_wagered decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  total_won decimal(12,2) DEFAULT 0;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  last_active_at timestamptz;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  risk_score integer DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_risk_score ON profiles(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_total_deposited ON profiles(total_deposited DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active_at DESC);

-- ============================================
-- 7. VERIFY EXISTING TABLES
-- ============================================
-- These tables should already exist from previous migrations
-- This is just to document their structure for reference

-- mpesa_config: Already exists, used for storing M-Pesa settings
-- mpesa_stk_requests: Already exists (created above)
-- transactions: Already exists, used for all financial transactions
-- wallets: Already exists, stores player balances
-- profiles: Already exists, enhanced above
-- game_rounds: Already exists, enhanced above
-- bets: Already exists, stores individual bets
-- crash_queue: Already exists, enhanced above

-- ============================================
-- 8. GRANT PERMISSIONS
-- ============================================
-- Ensure service_role can access all new tables
GRANT ALL ON mpesa_stk_requests TO service_role;
GRANT ALL ON mpesa_b2c_requests TO service_role;

-- ============================================
-- 9. ROLLBACK SCRIPT (if needed)
-- ============================================
/*
-- To rollback this migration, run:

-- Drop new tables
DROP TABLE IF EXISTS mpesa_b2c_requests CASCADE;
DROP TABLE IF EXISTS mpesa_stk_requests CASCADE;

-- Remove new columns from existing tables
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS risk_score;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS risk_flags;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS reviewed_by;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS reviewed_at;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS auto_approved;
ALTER TABLE withdrawal_requests DROP COLUMN IF EXISTS mpesa_receipt;

ALTER TABLE game_rounds DROP COLUMN IF EXISTS source;
ALTER TABLE game_rounds DROP COLUMN IF EXISTS queue_id;
ALTER TABLE game_rounds DROP COLUMN IF EXISTS total_bets_amount;
ALTER TABLE game_rounds DROP COLUMN IF EXISTS total_payouts;

ALTER TABLE crash_queue DROP COLUMN IF EXISTS batch_id;
ALTER TABLE crash_queue DROP COLUMN IF EXISTS notes;

ALTER TABLE profiles DROP COLUMN IF EXISTS total_deposited;
ALTER TABLE profiles DROP COLUMN IF EXISTS total_withdrawn;
ALTER TABLE profiles DROP COLUMN IF EXISTS total_wagered;
ALTER TABLE profiles DROP COLUMN IF EXISTS total_won;
ALTER TABLE profiles DROP COLUMN IF EXISTS last_active_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS risk_score;

-- Drop indexes
DROP INDEX IF EXISTS idx_stk_user_id;
DROP INDEX IF EXISTS idx_stk_status;
DROP INDEX IF EXISTS idx_stk_checkout_id;
DROP INDEX IF EXISTS idx_stk_receipt;
DROP INDEX IF EXISTS idx_stk_created_at;
DROP INDEX IF EXISTS idx_b2c_user_id;
DROP INDEX IF EXISTS idx_b2c_status;
DROP INDEX IF EXISTS idx_b2c_conversation_id;
DROP INDEX IF EXISTS idx_b2c_receipt;
DROP INDEX IF EXISTS idx_b2c_withdrawal_id;
DROP INDEX IF EXISTS idx_b2c_created_at;
DROP INDEX IF EXISTS idx_wr_status_pending;
DROP INDEX IF EXISTS idx_wr_risk_score;
DROP INDEX IF EXISTS idx_wr_user_id;
DROP INDEX IF EXISTS idx_wr_auto_approved;
DROP INDEX IF EXISTS idx_game_rounds_source;
DROP INDEX IF EXISTS idx_game_rounds_queue_id;
DROP INDEX IF EXISTS idx_crash_queue_pending;
DROP INDEX IF EXISTS idx_crash_queue_batch_id;
DROP INDEX IF EXISTS idx_profiles_risk_score;
DROP INDEX IF EXISTS idx_profiles_total_deposited;
DROP INDEX IF EXISTS idx_profiles_last_active;
*/

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify the migration was successful:

-- SELECT * FROM mpesa_stk_requests LIMIT 1;
-- SELECT * FROM mpesa_b2c_requests LIMIT 1;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'withdrawal_requests' AND column_name IN ('risk_score', 'risk_flags', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'auto_approved', 'mpesa_receipt');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'game_rounds' AND column_name IN ('source', 'queue_id', 'total_bets_amount', 'total_payouts');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'crash_queue' AND column_name IN ('batch_id', 'notes');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name IN ('total_deposited', 'total_withdrawn', 'total_wagered', 'total_won', 'last_active_at', 'risk_score');
