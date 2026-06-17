-- ============================================================================
-- AVIATOR V2 - LOCK THE WELCOME (NO-DEPOSIT) BONUS
-- ----------------------------------------------------------------------------
-- Root problem: handle_new_user() credited KSh 500 straight to wallet.balance
-- with no lock, so the welcome bonus was immediately withdrawable. That is the
-- classic no-deposit-bonus farming attack: sign up -> withdraw 500 -> repeat
-- with throwaway accounts = direct cash drain.
--
-- Fix (sticky bonus): the welcome credit is playable but its PRINCIPAL is
-- permanently locked from withdrawal. The player can win with it and withdraw
-- the winnings (anything above the locked principal); they can never cash out
-- the free grant itself. This reuses _locked_bonus_total() (the same withdrawal
-- gate as the deposit match) so no new mechanism is introduced.
--
-- Two coordinated changes:
--   1. bonuses.deposit_amount becomes nullable (a no-deposit bonus has none).
--   2. handle_new_user() opens a locked 'welcome' bonus alongside the credit.
--   3. accrue_bonus_wagering() only accrues/releases the RELEASABLE deposit
--      match; the sticky welcome bonus never releases (stays locked forever).
--
-- Scope: applies to NEW signups. Existing accounts' already-credited welcome
-- 500 is left untouched (retroactive claw-back of live balances is unsafe).
--
-- Depends on: 20260617020000 (bonuses table, _locked_bonus_total,
--             accrue_bonus_wagering), 20260613030000 (handle_new_user).
-- ============================================================================

-- ---- 1. Allow no-deposit bonuses (deposit_amount NULL) ----------------------
ALTER TABLE public.bonuses ALTER COLUMN deposit_amount DROP NOT NULL;
ALTER TABLE public.bonuses DROP CONSTRAINT IF EXISTS bonuses_deposit_amount_check;
ALTER TABLE public.bonuses
  ADD CONSTRAINT bonuses_deposit_amount_check CHECK (deposit_amount IS NULL OR deposit_amount > 0);

-- ---- 2. Welcome amount is admin-tunable -------------------------------------
INSERT INTO public.system_settings (key, value, category, description) VALUES
  ('bonus.welcome_amount', '500', 'bonus', 'No-deposit welcome credit granted on signup, in KSh (locked from withdrawal)')
ON CONFLICT (key) DO NOTHING;

-- ---- 3. handle_new_user(): credit + LOCK the welcome bonus ------------------
-- Reproduces the canonical definition (20260613030000) and adds the locked
-- 'welcome' bonus row. The credit still lands in the wallet so the player can
-- play immediately; _locked_bonus_total() keeps that principal unwithdrawable.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username text; _phone text; _avatar text;
  _welcome  numeric := coalesce(_game_setting_num('bonus.welcome_amount'), 500);
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF char_length(trim(_username)) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  INSERT INTO public.profiles (id, username, avatar_color, phone_number)
    VALUES (NEW.id, trim(_username), _avatar, _phone);
  INSERT INTO public.wallets (user_id, balance, currency)
    VALUES (NEW.id, _welcome, 'KES');

  IF _welcome > 0 THEN
    -- Record as a 'bonus' transaction (not 'deposit'): it is not real cash and
    -- must never be mistaken for a deposit (e.g. by the first-deposit grant).
    INSERT INTO public.transactions (user_id, type, amount, description, status)
      VALUES (NEW.id, 'bonus', _welcome,
              'Welcome bonus - KSh ' || _welcome::int || ' free to play', 'completed');
    -- Sticky lock: principal is locked from withdrawal (no wagering release).
    INSERT INTO public.bonuses
      (user_id, type, amount, deposit_amount, wagering_required, wagering_progress, status)
      VALUES (NEW.id, 'welcome', _welcome, NULL, 0, 0, 'active');
  END IF;

  RETURN NEW;
END;
$$;

-- ---- 4. Wagering accrues only to the RELEASABLE deposit match ---------------
-- The sticky welcome bonus must never auto-release, and real bets must build
-- progress on the first-deposit match (not be absorbed by the welcome row).
CREATE OR REPLACE FUNCTION public.accrue_bonus_wagering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id        uuid;
  v_progress  numeric;
  v_required  numeric;
  v_new       numeric;
BEGIN
  IF NEW.user_id IS NULL OR NEW.is_bot IS TRUE OR coalesce(NEW.is_free, false) IS TRUE
     OR NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Only releasable bonus types accrue wagering. 'welcome' is sticky (never
  -- released) and is intentionally excluded.
  SELECT id, wagering_progress, wagering_required
    INTO v_id, v_progress, v_required
  FROM public.bonuses
  WHERE user_id = NEW.user_id AND status = 'active' AND type = 'first_deposit_match'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN RETURN NEW; END IF;

  v_new := v_progress + NEW.amount;
  IF v_new >= v_required THEN
    UPDATE public.bonuses
       SET wagering_progress = v_required, status = 'released', released_at = now()
     WHERE id = v_id;
  ELSE
    UPDATE public.bonuses
       SET wagering_progress = v_new
     WHERE id = v_id;
  END IF;

  RETURN NEW;
END $$;
