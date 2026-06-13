-- ============================================================================
-- AVIATOR V2 - MARKETING / AFFILIATE SYSTEM
-- ============================================================================
-- Adds a real, scope-limited affiliate program for the `marketer` role:
--   * Each marketer gets a unique referral_code; new signups that arrive with
--     ?ref=<code> are attributed to that marketer at signup (one marketer per
--     player, immutable).
--   * A referral becomes `qualified` the moment the referred player completes
--     their first real M-Pesa deposit >= the configured minimum (default 50).
--   * Commission = revenue-share: a global, super_admin-editable rate (default
--     10%) applied to the floored aggregate GGR (bets staked - winnings paid)
--     of the marketer's qualified referrals.
--   * Commission lives in its OWN ledger (commission_payouts), entirely separate
--     from the marketer's player wallet. Payouts require admin verification and
--     are settled out-of-band via the existing M-Pesa B2C rail, then recorded.
--   * Marketers' player-wallet withdrawals are ALSO forced through admin review
--     (auto_approved is never set true for a marketer).
--
-- AUTHORIZATION MODEL (consistent with the Phase-1 lockdown):
--   Every read/write path is a SECURITY DEFINER RPC that self-checks the
--   caller's role via _is_marketer()/_is_admin()/_is_super_admin(). The three
--   new tables are RLS-locked with NO client policies and no client grants;
--   clients never touch them directly.
--
-- ORDERING: must run AFTER 20260613060000_rbac_four_roles.sql (defines the
--   `marketer` role + the four-role CHECK) and the admin RPC migrations that
--   define _is_admin()/_is_super_admin(). Fully idempotent and additive; safe to
--   re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PROFILES: referral attribution columns
--    referral_code  - the marketer's own shareable code (NULL for non-marketers
--                     until generated; see _ensure_referral_code).
--    referred_by    - immutable pointer to the marketer who referred this player,
--                     set once at signup. Self-reference is impossible (a new
--                     signup id never equals an existing marketer id).
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by   uuid REFERENCES public.profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles (referred_by);

-- ----------------------------------------------------------------------------
-- 2. REFERRALS: one row per referred player (lifecycle: pending -> qualified)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id            uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified')),
  first_deposit_amount numeric,
  qualified_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self CHECK (marketer_id <> player_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_marketer ON public.referrals (marketer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON public.referrals (status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals FORCE ROW LEVEL SECURITY;   -- only SECURITY DEFINER fns may touch it

-- ----------------------------------------------------------------------------
-- 3. COMMISSION_PAYOUTS: the marketer commission ledger (separate from wallets)
--    Lifecycle: pending -> approved -> paid   (or pending -> rejected)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount           numeric NOT NULL CHECK (amount > 0),
  phone_number     text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','paid','rejected')),
  reviewed_by      uuid REFERENCES public.profiles(id),
  review_note      text,
  rejection_reason text,
  mpesa_receipt    text,
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_marketer ON public.commission_payouts (marketer_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_status   ON public.commission_payouts (status);
-- At most one outstanding (pending) request per marketer keeps the admin queue clean.
CREATE UNIQUE INDEX IF NOT EXISTS commission_payouts_one_pending
  ON public.commission_payouts (marketer_id) WHERE status = 'pending';

ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. MARKETING_CONFIG: single-row, fully-tracked config (no system_settings
--    drift dependency). commission_rate is a fraction in [0,1].
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_config (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id = true),  -- enforces exactly one row
  commission_rate       numeric NOT NULL DEFAULT 0.10 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  qualifying_deposit_min numeric NOT NULL DEFAULT 50  CHECK (qualifying_deposit_min >= 0),
  updated_by            uuid REFERENCES public.profiles(id),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.marketing_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.marketing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_config FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. HELPERS
-- ----------------------------------------------------------------------------
-- Role gate: is the current user a marketer?
CREATE OR REPLACE FUNCTION public._is_marketer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'marketer');
$$;

-- Generate (once) and return a unique referral code for a marketer. Idempotent:
-- returns the existing code if already set. Codes are uppercase base32-ish,
-- collision-checked against the unique index.
CREATE OR REPLACE FUNCTION public._ensure_referral_code(p_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_code text; v_existing text; v_try int := 0;
BEGIN
  SELECT referral_code INTO v_existing FROM profiles WHERE id = p_user;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  LOOP
    v_try := v_try + 1;
    -- 8 hex chars, uppercased -> short, URL-safe, ~4.3e9 space; retry on collision.
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
    BEGIN
      UPDATE profiles SET referral_code = v_code WHERE id = p_user;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 10 THEN RAISE EXCEPTION 'REFERRAL_CODE_GENERATION_FAILED'; END IF;
    END;
  END LOOP;
END $$;

-- Aggregate, floored-at-zero GGR (KES) generated by a marketer's QUALIFIED
-- referrals. GGR = total staked - total paid out, over real (non-bot) bets.
-- Floored at the aggregate level (no per-player clawback; a single big winner
-- can only reduce the pool, never create a negative balance).
CREATE OR REPLACE FUNCTION public._marketer_ggr(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT greatest(
    coalesce(sum(b.amount), 0) - coalesce(sum(b.winnings), 0),
    0
  )
  FROM referrals r
  JOIN bets b ON b.user_id = r.player_id AND b.is_bot = false
  WHERE r.marketer_id = p_marketer AND r.status = 'qualified';
$$;

-- Lifetime commission EARNED by a marketer = rate * floored GGR, rounded to cents.
CREATE OR REPLACE FUNCTION public._marketer_commission_earned(p_marketer uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(
    (SELECT commission_rate FROM marketing_config WHERE id = true) * public._marketer_ggr(p_marketer),
    2
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. marketer_dashboard - the marketer's own stats (no leaderboard, own data).
--    Generates the referral code on first view if absent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketer_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_rate numeric;
  v_referred int; v_qualified int;
  v_ggr numeric; v_earned numeric;
  v_committed numeric;   -- pending + approved + paid
  v_paid numeric; v_pending numeric; v_approved numeric;
  v_payouts jsonb;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  -- ensure the code exists (cannot use the STABLE helper's write path here, so
  -- call the volatile generator directly)
  SELECT referral_code INTO v_code FROM profiles WHERE id = v_uid;
  IF v_code IS NULL THEN v_code := _ensure_referral_code(v_uid); END IF;

  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;

  SELECT count(*), count(*) FILTER (WHERE status = 'qualified')
    INTO v_referred, v_qualified
  FROM referrals WHERE marketer_id = v_uid;

  v_ggr    := _marketer_ggr(v_uid);
  v_earned := _marketer_commission_earned(v_uid);

  SELECT
    coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0),
    coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
    coalesce(sum(amount) FILTER (WHERE status = 'approved'), 0)
    INTO v_paid, v_pending, v_approved
  FROM commission_payouts WHERE marketer_id = v_uid;

  v_committed := v_paid + v_pending + v_approved;

  SELECT coalesce(jsonb_agg(p ORDER BY p.created_at DESC), '[]'::jsonb) INTO v_payouts
  FROM (
    SELECT id, amount, phone_number, status, mpesa_receipt, rejection_reason,
           reviewed_at, paid_at, created_at
    FROM commission_payouts WHERE marketer_id = v_uid
    ORDER BY created_at DESC LIMIT 50
  ) p;

  RETURN jsonb_build_object(
    'referral_code',        v_code,
    'commission_rate',      v_rate,
    'referred_count',       v_referred,
    'qualified_count',      v_qualified,
    'lifetime_ggr',         v_ggr,
    'commission_earned',    v_earned,
    'commission_paid',      v_paid,
    'commission_pending',   v_pending,
    'commission_approved',  v_approved,
    'commission_available', greatest(v_earned - v_committed, 0),
    'payouts',              v_payouts
  );
END $$;

-- ----------------------------------------------------------------------------
-- 7. request_commission_payout - marketer requests settlement of available
--    commission. No wallet movement; validated against available balance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_commission_payout(p_amount numeric, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_phone     text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_earned    numeric;
  v_committed numeric;
  v_available numeric;
  v_id        uuid;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  -- normalise phone -> 254XXXXXXXXX (mirrors request_withdrawal)
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;

  IF p_amount IS NULL OR p_amount <= 0      THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW'; END IF;
  IF p_amount <> trunc(p_amount)            THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;

  IF EXISTS (SELECT 1 FROM commission_payouts WHERE marketer_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'PAYOUT_PENDING';
  END IF;

  v_earned := _marketer_commission_earned(v_uid);
  SELECT coalesce(sum(amount), 0) INTO v_committed
    FROM commission_payouts
   WHERE marketer_id = v_uid AND status IN ('pending','approved','paid');
  v_available := greatest(v_earned - v_committed, 0);

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'INSUFFICIENT_COMMISSION: available %', v_available;
  END IF;

  INSERT INTO commission_payouts(marketer_id, amount, phone_number, status)
  VALUES (v_uid, p_amount, v_phone, 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'commission_payout_id', v_id,
    'amount',  p_amount,
    'phone',   v_phone,
    'status',  'pending'
  );
END $$;

-- ----------------------------------------------------------------------------
-- 8. admin_commission_overview - current rate + queue summary for the admin
--    Commissions page header.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_commission_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rate numeric; v_pending_count int; v_pending_amount numeric; v_paid_total numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  SELECT count(*) FILTER (WHERE status = 'pending'),
         coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
         coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)
    INTO v_pending_count, v_pending_amount, v_paid_total
  FROM commission_payouts;
  RETURN jsonb_build_object(
    'commission_rate',  v_rate,
    'pending_count',    v_pending_count,
    'pending_amount',   v_pending_amount,
    'paid_total',       v_paid_total,
    'can_edit_rate',    _is_super_admin()
  );
END $$;

-- ----------------------------------------------------------------------------
-- 9. admin_list_commission_payouts - paginated queue (pending first, FIFO).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_commission_payouts(
  p_status text    DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id               uuid,
  marketer_id      uuid,
  marketer_username text,
  amount           numeric,
  phone_number     text,
  status           text,
  review_note      text,
  rejection_reason text,
  mpesa_receipt    text,
  reviewed_by      uuid,
  reviewer_username text,
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT c.id, c.marketer_id, m.username, c.amount, c.phone_number, c.status,
         c.review_note, c.rejection_reason, c.mpesa_receipt,
         c.reviewed_by, r.username, c.reviewed_at, c.paid_at, c.created_at
  FROM commission_payouts c
  JOIN profiles m ON m.id = c.marketer_id
  LEFT JOIN profiles r ON r.id = c.reviewed_by
  WHERE (p_status IS NULL OR c.status = p_status)
  ORDER BY
    (c.status = 'pending') DESC,
    CASE WHEN c.status = 'pending' THEN c.created_at END ASC,
    c.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $$;

-- ----------------------------------------------------------------------------
-- 10. admin_review_commission_payout - approve or reject a pending request.
--     Approve stamps the reviewer and moves to 'approved' (settlement happens
--     out-of-band via M-Pesa B2C, then admin_record_commission_payout records
--     the receipt). Reject requires a reason. Any admin/super_admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_commission_payout(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT status, amount, marketer_id INTO v_status, v_amount, v_marketer
  FROM commission_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND            THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;

  IF p_approve THEN
    UPDATE commission_payouts
       SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = nullif(trim(coalesce(p_note, '')), '')
     WHERE id = p_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'commission_payout_approved', 'commission_payout', p_id::text,
            jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'note', p_note));
    RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'amount', v_amount);
  ELSE
    IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE commission_payouts
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           rejection_reason = trim(p_note)
     WHERE id = p_id;
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'commission_payout_rejected', 'commission_payout', p_id::text,
            jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'reason', trim(p_note)));
    RETURN jsonb_build_object('id', p_id, 'status', 'rejected');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 11. admin_record_commission_payout - record the M-Pesa receipt once an
--     approved payout has been disbursed out-of-band. approved -> paid.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_commission_payout(p_id uuid, p_receipt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_amount numeric; v_marketer uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_receipt IS NULL OR length(trim(p_receipt)) = 0 THEN RAISE EXCEPTION 'RECEIPT_REQUIRED'; END IF;

  SELECT status, amount, marketer_id INTO v_status, v_amount, v_marketer
  FROM commission_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND             THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'NOT_APPROVED: %', v_status; END IF;

  UPDATE commission_payouts
     SET status = 'paid', mpesa_receipt = trim(p_receipt), paid_at = now()
   WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'commission_payout_paid', 'commission_payout', p_id::text,
          jsonb_build_object('amount', v_amount, 'marketer_id', v_marketer, 'receipt', trim(p_receipt)));
  RETURN jsonb_build_object('id', p_id, 'status', 'paid', 'mpesa_receipt', trim(p_receipt));
END $$;

-- ----------------------------------------------------------------------------
-- 12. admin_set_commission_rate - super_admin only; rate is a fraction [0,1].
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_commission_rate(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old numeric;
BEGIN
  IF NOT _is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN RAISE EXCEPTION 'INVALID_RATE: must be in [0,1]'; END IF;

  SELECT commission_rate INTO v_old FROM marketing_config WHERE id = true;
  UPDATE marketing_config SET commission_rate = p_rate, updated_by = auth.uid(), updated_at = now()
   WHERE id = true;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'commission_rate_changed', 'marketing_config', 'commission_rate',
          jsonb_build_object('old', v_old, 'new', p_rate));
  RETURN jsonb_build_object('commission_rate', p_rate);
END $$;

-- ----------------------------------------------------------------------------
-- 13. Qualification trigger: flip a pending referral to 'qualified' on the
--     referred player's first real M-Pesa deposit >= qualifying_deposit_min.
--     Excludes the welcome bonus (payment_method IS NULL). Idempotent via the
--     status='pending' guard. Fires on INSERT and on a status flip to completed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._referral_qualify_on_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_min numeric;
BEGIN
  IF NEW.type = 'deposit' AND NEW.status = 'completed'
     AND NEW.payment_method = 'mpesa' THEN
    SELECT qualifying_deposit_min INTO v_min FROM marketing_config WHERE id = true;
    IF NEW.amount >= coalesce(v_min, 50) THEN
      UPDATE referrals
         SET status = 'qualified', qualified_at = now(), first_deposit_amount = NEW.amount
       WHERE player_id = NEW.user_id AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_referral_qualify ON public.transactions;
CREATE TRIGGER trg_referral_qualify
  AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public._referral_qualify_on_deposit();

-- ----------------------------------------------------------------------------
-- 14. handle_new_user - extend to capture referral attribution at signup.
--     Captured verbatim from 20260613030000 with the referral block added.
--     Reads raw_user_meta_data->>'referral_code'; resolves it to a marketer and,
--     when valid (and not self), sets profiles.referred_by + a pending referral.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username text; _phone text; _avatar text; _ref text; _marketer uuid;
  _colors text[] := ARRAY['#ef4444','#f97316','#22c55e','#06b6d4','#3b82f6','#ec4899','#f59e0b','#a855f7','#14b8a6'];
BEGIN
  _username := NEW.raw_user_meta_data->>'username';
  _phone := NEW.raw_user_meta_data->>'phone';
  _avatar := NEW.raw_user_meta_data->>'avatar_color';
  _ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')), '');
  IF _avatar IS NULL OR _avatar = '' THEN
    _avatar := _colors[1 + floor(random() * array_length(_colors, 1))::int];
  END IF;
  IF _username IS NULL OR trim(_username) = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF char_length(trim(_username)) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  -- Resolve referral code -> marketer (must be an actual marketer, not self).
  IF _ref IS NOT NULL THEN
    SELECT id INTO _marketer FROM public.profiles
     WHERE referral_code = upper(_ref) AND role = 'marketer' AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, username, avatar_color, phone_number, referred_by)
    VALUES (NEW.id, trim(_username), _avatar, _phone, _marketer);
  INSERT INTO public.wallets (user_id, balance, currency)
    VALUES (NEW.id, 500.00, 'KES');
  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (NEW.id, 'deposit', 500.00, 'Welcome bonus - KSh 500 free credits!', 'completed');

  IF _marketer IS NOT NULL THEN
    INSERT INTO public.referrals (marketer_id, player_id, status)
      VALUES (_marketer, NEW.id, 'pending')
      ON CONFLICT (player_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 15. request_withdrawal - force admin verification for marketers' player-wallet
--     withdrawals (auto_approved is never true for a marketer). Captured from
--     20260612124000 with the single marketer guard added.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_min   numeric := coalesce(_game_setting_num('finance.min_withdrawal'), 100);
  v_thr   numeric := coalesce(_game_setting_num('finance.auto_approve_threshold'), 5000);
  v_bal   numeric;
  v_auto  boolean;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

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

  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;

  -- Marketers are NEVER auto-approved: every marketer payout (player wallet or
  -- commission) must be verified by an admin.
  v_auto := (p_amount <= v_thr)
            AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role = 'marketer');

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

-- ----------------------------------------------------------------------------
-- 16. Backfill: give every existing marketer a referral code immediately.
-- ----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE role = 'marketer' AND referral_code IS NULL LOOP
    PERFORM _ensure_referral_code(r.id);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 17. GRANTS - least privilege. New tables are RLS-locked with NO client
--     policies; revoke any blanket client write/read grants. All access is via
--     the SECURITY DEFINER RPCs below.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.referrals          FROM anon, authenticated;
REVOKE ALL ON public.commission_payouts FROM anon, authenticated;
REVOKE ALL ON public.marketing_config   FROM anon, authenticated;

REVOKE ALL ON FUNCTION public._is_marketer()                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ensure_referral_code(uuid)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public._marketer_ggr(uuid)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public._marketer_commission_earned(uuid)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketer_dashboard()                             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_commission_payout(numeric,text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_commission_overview()                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_commission_payouts(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_commission_payout(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_commission_payout(uuid,text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_commission_rate(numeric)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._is_marketer()                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marketer_dashboard()                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_commission_payout(numeric,text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_commission_overview()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_commission_payouts(text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_commission_payout(uuid,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_commission_payout(uuid,text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_commission_rate(numeric)                TO authenticated, service_role;

COMMIT;
