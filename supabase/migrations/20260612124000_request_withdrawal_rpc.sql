-- ============================================================================
-- AVIATOR V2 - PHASE 2 (ADDENDUM): request_withdrawal RPC
-- ============================================================================
-- The missing link for the cashier under lockdown. The deployed mpesa-b2c
-- function requires a pre-existing 'pending' withdrawal_requests row, but
-- clients have no INSERT path to that table. This SECURITY DEFINER RPC is the
-- only sanctioned way for a player to request a withdrawal.
--
-- Design (explicit, consistent with the deployed mpesa-b2c):
--   • Does NOT debit the wallet - mpesa-b2c debits at payout time, so debiting
--     here would double-debit. (A future hold-on-request model would require a
--     coordinated change to mpesa-b2c.)
--   • One pending request per user at a time (prevents stacked requests).
--   • Normalises + validates the phone to ^254XXXXXXXXX$.
--   • auto_approved flag set from finance.auto_approve_threshold; actual payout
--     is triggered by admin approval / an auto-approve job calling mpesa-b2c.
--   • Additive & dormant: safe to apply during staging.
-- ============================================================================

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
