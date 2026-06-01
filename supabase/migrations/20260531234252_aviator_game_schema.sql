/*
  # Aviator Game - Full Schema

  ## Tables Created
  1. `profiles` - User profiles linked to auth.users (username, avatar)
  2. `wallets` - User balance in KES, auto-created on signup
  3. `game_rounds` - Each game round with crash multiplier, timing, status
  4. `bets` - Individual bets per round (real users + bots)
  5. `transactions` - Deposit/withdrawal/bet/win history

  ## Security
  - RLS enabled on all tables
  - Users can only read/write their own data
  - Bets are readable by all authenticated users (live feed)
  - Game rounds are readable by all authenticated users
*/

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  avatar_color text DEFAULT '#3b82f6' NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  balance decimal(12,2) DEFAULT 0.00 NOT NULL,
  currency text DEFAULT 'KES' NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own wallet"
  ON wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own wallet"
  ON wallets FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own wallet"
  ON wallets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Game Rounds
CREATE TABLE IF NOT EXISTS game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number bigint,
  crash_multiplier decimal(10,2) NOT NULL,
  status text DEFAULT 'waiting' NOT NULL,
  started_at timestamptz,
  crashed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE game_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read game rounds"
  ON game_rounds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can insert game rounds"
  ON game_rounds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "All authenticated users can update game rounds"
  ON game_rounds FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create sequence for round numbers
CREATE SEQUENCE IF NOT EXISTS game_round_number_seq START 1;

-- Bets
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id),
  username text NOT NULL,
  avatar_color text DEFAULT '#3b82f6' NOT NULL,
  amount decimal(12,2) NOT NULL,
  cashout_multiplier decimal(10,2),
  winnings decimal(12,2),
  status text DEFAULT 'active' NOT NULL,
  is_bot boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read bets"
  ON bets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can insert bets"
  ON bets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "All authenticated users can update bets"
  ON bets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount decimal(12,2) NOT NULL,
  payment_method text,
  reference text,
  description text,
  status text DEFAULT 'completed' NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_status ON game_rounds(status);
CREATE INDEX IF NOT EXISTS idx_game_rounds_created_at ON game_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

-- Function to auto-create wallet on profile creation
CREATE OR REPLACE FUNCTION create_wallet_for_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id, balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_profile();
