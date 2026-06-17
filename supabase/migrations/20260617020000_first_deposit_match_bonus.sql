-- ============================================================================
-- AVIATOR V2 - FIRST-DEPOSIT MATCH BONUS  (module 8 cont.: bonus engine)
-- ----------------------------------------------------------------------------
-- Grants a 100% match of a player's FIRST real M-Pesa deposit, capped at a
-- configurable amount (default KSh 500). The matched credit is added to the
-- wallet immediately so the player can play with it, but it is LOCKED for
-- withdrawal until the player has wagered it `wagering_multiple`x (default 3x)
-- in real-money bets. Once the requirement is met the bonus is released and the
-- funds become withdrawable.
--
-- Why this design (vs an uncapped "double your deposit" or a flat bonus):
--   * Caps operator liability at one fixed amount per player (the cap).
--   * Keeps the high-converting "double your deposit" message.
--   * The wagering requirement recycles the bonus through the house edge before
--     it can leave, so the bonus funds margin instead of walking straight out.
--
-- Server-authoritative & decoupled: everything runs in DB triggers/RPC. The
-- M-Pesa edge function is unchanged - it still just credits the wallet and
-- inserts the 'deposit' transaction; a trigger on that insert grants the bonus.
--
-- Idempotent: safe to re-run. One first_deposit_match bonus per player
-- (enforced by a partial unique index).
--
-- Depends on: profiles, wallets, transactions, bets (with is_free/is_bot),
--             system_settings, _game_setting_num() (20260612119000).
-- ============================================================================

-- ---- 1. Tunable config (admin-editable via system_settings) -----------------
INSERT INTO public.system_settings (key, value, category, description) VALUES
  ('bonus.first_deposit_enabled',   '1',     'bonus', 'Master switch for the first-deposit match bonus (1 = on, 0 = off)'),
  ('bonus.first_deposit_match_pct', '100',   'bonus', 'Match percentage of the first deposit (100 = double)'),
  ('bonus.first_deposit_cap',       '500',   'bonus', 'Maximum bonus credit granted, in KSh'),
  ('bonus.wagering_multiple',       '3',     'bonus', 'Times the bonus must be wagered (real bets) before withdrawal'),
  ('bonus.expiry_days',             '7',     'bonus', 'Days until an unreleased bonus expires (0 = never)')
ON CONFLICT (key) DO NOTHING;

-- ---- 2. bonuses ledger ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonuses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type               text NOT NULL DEFAULT 'first_deposit_match',
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),          -- locked bonus credit granted
  deposit_amount     numeric(12,2) NOT NULL CHECK (deposit_amount > 0),  -- the deposit that triggered it
  wagering_required  numeric(12,2) NOT NULL CHECK (wagering_required >= 0),
  wagering_progress  numeric(12,2) NOT NULL DEFAULT 0 CHECK (wagering_progress >= 0),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','released','forfeited','expired')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  released_at        timestamptz,
  expires_at         timestamptz
);

-- At most one first-deposit bonus per player.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bonuses_first_deposit
  ON public.bonuses(user_id) WHERE type = 'first_deposit_match';
-- Fast lookups for the withdrawal lock + wagering accrual (only active rows).
CREATE INDEX IF NOT EXISTS idx_bonuses_user_active
  ON public.bonuses(user_id) WHERE status = 'active';

ALTER TABLE public.bonuses ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bonuses'
      AND policyname = 'Players read own bonuses'
  ) THEN
    CREATE POLICY "Players read own bonuses" ON public.bonuses
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- ---- 3. Locked-bonus helper (active, unreleased bonus principal) -------------
CREATE OR REPLACE FUNCTION public._locked_bonus_total(p_uid uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount), 0)
  FROM public.bonuses
  WHERE user_id = p_uid AND status = 'active';
$$;

-- ---- 4. Grant on first real (M-Pesa) deposit --------------------------------
CREATE OR REPLACE FUNCTION public.grant_first_deposit_bonus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_enabled   numeric := coalesce(_game_setting_num('bonus.first_deposit_enabled'), 0);
  v_pct       numeric := coalesce(_game_setting_num('bonus.first_deposit_match_pct'), 100);
  v_cap       numeric := coalesce(_game_setting_num('bonus.first_deposit_cap'), 500);
  v_mult      numeric := coalesce(_game_setting_num('bonus.wagering_multiple'), 3);
  v_expiry    numeric := coalesce(_game_setting_num('bonus.expiry_days'), 7);
  v_bonus     numeric;
  v_expires   timestamptz;
BEGIN
  -- Only real cash deposits (M-Pesa). The welcome bonus and bonus credits use a
  -- NULL / non-mpesa payment_method and never qualify.
  IF NEW.type <> 'deposit' OR coalesce(NEW.payment_method, '') <> 'mpesa' THEN
    RETURN NEW;
  END IF;
  IF v_enabled < 1 THEN RETURN NEW; END IF;

  -- First-deposit only: the partial unique index also guards this, but we check
  -- first to avoid a needless exception path.
  IF EXISTS (
    SELECT 1 FROM public.bonuses
    WHERE user_id = NEW.user_id AND type = 'first_deposit_match'
  ) THEN
    RETURN NEW;
  END IF;

  v_bonus := floor(least(NEW.amount * (v_pct / 100.0), v_cap) * 100) / 100;
  IF v_bonus <= 0 THEN RETURN NEW; END IF;

  v_expires := CASE WHEN v_expiry >= 1 THEN now() + make_interval(days => v_expiry::int) ELSE NULL END;

  -- Credit the matched amount to the wallet (playable immediately, locked for
  -- withdrawal via _locked_bonus_total until the wagering requirement is met).
  UPDATE public.wallets
     SET balance = balance + v_bonus, updated_at = now()
   WHERE user_id = NEW.user_id;

  INSERT INTO public.bonuses
    (user_id, type, amount, deposit_amount, wagering_required, wagering_progress, status, expires_at)
  VALUES
    (NEW.user_id, 'first_deposit_match', v_bonus, NEW.amount, v_bonus * v_mult, 0, 'active', v_expires);

  INSERT INTO public.transactions (user_id, type, amount, description, status)
  VALUES (NEW.user_id, 'bonus', v_bonus,
          'First-deposit match bonus (' || v_pct::int || '%, wager ' || v_mult::int || 'x to unlock)',
          'completed');

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grant_first_deposit_bonus ON public.transactions;
CREATE TRIGGER trg_grant_first_deposit_bonus
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.grant_first_deposit_bonus();

-- ---- 5. Accrue wagering on real bets; auto-release when met ------------------
CREATE OR REPLACE FUNCTION public.accrue_bonus_wagering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id        uuid;
  v_progress  numeric;
  v_required  numeric;
  v_new       numeric;
BEGIN
  -- Only real-money player stakes count toward wagering: exclude bots and free
  -- bets (their stake was never the player's cash).
  IF NEW.user_id IS NULL OR NEW.is_bot IS TRUE OR coalesce(NEW.is_free, false) IS TRUE
     OR NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id, wagering_progress, wagering_required
    INTO v_id, v_progress, v_required
  FROM public.bonuses
  WHERE user_id = NEW.user_id AND status = 'active'
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

DROP TRIGGER IF EXISTS trg_accrue_bonus_wagering ON public.bets;
CREATE TRIGGER trg_accrue_bonus_wagering
  AFTER INSERT ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.accrue_bonus_wagering();

-- ---- 6. Withdrawal lock: can't withdraw funds still behind a bonus -----------
-- Recreated verbatim from 20260612124000_request_withdrawal_rpc.sql with ONE
-- added rule: the post-withdrawal balance must still cover any locked bonus
-- principal. Everything else (phone normalisation, min, single-pending, auto-
-- approve) is unchanged.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_min    numeric := coalesce(_game_setting_num('finance.min_withdrawal'), 100);
  v_thr    numeric := coalesce(_game_setting_num('finance.auto_approve_threshold'), 5000);
  v_bal    numeric;
  v_locked numeric;
  v_auto   boolean;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- normalise phone -> 254XXXXXXXXX
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;

  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;

  SELECT balance INTO v_bal FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_bal IS NULL        THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount     THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  -- Locked bonus principal must remain in the wallet after this withdrawal.
  v_locked := _locked_bonus_total(v_uid);
  IF (v_bal - p_amount) < v_locked THEN
    RAISE EXCEPTION 'BONUS_LOCKED: % is locked until the wagering requirement is met', v_locked;
  END IF;

  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;

  v_auto := p_amount <= v_thr;
  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, auto_approved)
  VALUES (v_uid, p_amount, v_phone, 'pending', v_auto)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'withdrawal_request_id', v_id,
    'status', 'pending',
    'auto_approved', v_auto,
    'phone', v_phone,
    'amount', p_amount
  );
END $$;

REVOKE ALL  ON FUNCTION public.request_withdrawal(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text) TO authenticated, service_role;
