-- ============================================================================
-- AVIATOR V2 - MILESTONE 1: ADMIN WITHDRAWAL RPCs
-- ============================================================================
-- Completes the cashier's admin side. Under the Phase-1 security lockdown,
-- admins (role 'authenticated') have an `admin_full_access` RLS policy on
-- `withdrawal_requests` but NOT on `wallets` (users may read only their own
-- wallet). These SECURITY DEFINER RPCs are the sanctioned admin paths and
-- centralise authorisation + audit in one place.
--
-- LIFECYCLE (authoritative - derived from the deployed rails, do not diverge):
--   request_withdrawal      : INSERT row status='pending'  (NO wallet debit)
--   mpesa-b2c (edge fn)      : requires status='pending' -> debits wallet,
--                              inserts 'withdrawal' txn, sets status='processing'
--   mpesa-b2c-callback       : ResultCode 0 -> 'completed'; else 'failed' + reversal
--   admin_reject_withdrawal  : 'pending' -> 'rejected' (NO refund - never debited)
--
-- DESIGN DECISIONS (explicit, defensible):
--   • admin_approve_withdrawal does NOT debit and does NOT change status. It
--     gates on _is_admin(), stamps reviewer/note, writes the audit row, and
--     returns the row's canonical amount + phone. The CLIENT then invokes the
--     deployed `mpesa-b2c` function (which strictly requires status='pending',
--     owns the debit, and transitions to 'processing'). Keeping the status as
--     'pending' is REQUIRED for that contract; debiting here would double-debit.
--   • admin_reject_withdrawal performs the full transition in-DB. No wallet
--     movement is needed because request_withdrawal never debited.
--   • admin_list_withdrawals returns wallet balance + player lifetime stats that
--     the admin client cannot read directly (no admin RLS policy on wallets).
--   • All three are idempotency-safe: approve/reject act only on 'pending', and
--     the FOR UPDATE row lock serialises concurrent admin actions.
-- Additive & dormant: safe to apply on a live database (no drops, no data DML).
-- ============================================================================

-- ---- admin_list_withdrawals -------------------------------------------------
-- Authorised, paginated queue view. p_status = NULL returns every status.
-- Ordering: pending first (oldest → newest, FIFO fairness), then the rest
-- (newest → oldest). All source columns are alias-qualified to avoid any
-- ambiguity with the OUT (TABLE) parameters.
CREATE OR REPLACE FUNCTION public.admin_list_withdrawals(
  p_status text    DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id               uuid,
  user_id          uuid,
  username         text,
  phone_number     text,
  amount           numeric,
  status           text,
  auto_approved    boolean,
  risk_score       integer,
  risk_flags       jsonb,
  rejection_reason text,
  review_note      text,
  reviewed_by      uuid,
  reviewer_username text,
  reviewed_at      timestamptz,
  created_at       timestamptz,
  completed_at     timestamptz,
  mpesa_receipt    text,
  wallet_balance   numeric,
  total_deposited  numeric,
  total_withdrawn  numeric,
  total_wagered    numeric,
  total_won        numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  SELECT
    w.id, w.user_id, p.username, w.phone_number, w.amount, w.status,
    w.auto_approved, w.risk_score, w.risk_flags, w.rejection_reason,
    w.review_note, w.reviewed_by, r.username, w.reviewed_at,
    w.created_at, w.completed_at, w.mpesa_receipt,
    wal.balance,
    p.total_deposited, p.total_withdrawn, p.total_wagered, p.total_won
  FROM withdrawal_requests w
  JOIN profiles  p   ON p.id = w.user_id
  LEFT JOIN wallets  wal ON wal.user_id = w.user_id
  LEFT JOIN profiles r   ON r.id = w.reviewed_by
  WHERE (p_status IS NULL OR w.status = p_status)
  ORDER BY
    (w.status = 'pending') DESC,
    CASE WHEN w.status = 'pending' THEN w.created_at END ASC,
    w.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $$;

-- ---- admin_approve_withdrawal ----------------------------------------------
-- Authorises a pending withdrawal: stamps reviewer + note, audits, and returns
-- the canonical amount/phone for the client's subsequent mpesa-b2c invocation.
-- Status intentionally remains 'pending' (mpesa-b2c requires it and performs
-- the debit + 'processing' transition). Re-runnable while still 'pending'.
CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(p_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_amount numeric; v_phone text; v_user uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT status, amount, phone_number, user_id
    INTO v_status, v_amount, v_phone, v_user
  FROM withdrawal_requests WHERE id = p_id FOR UPDATE;

  IF NOT FOUND            THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;

  UPDATE withdrawal_requests
     SET reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), '')
   WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'withdrawal_approved', 'withdrawal', p_id::text,
          jsonb_build_object('amount', v_amount, 'phone', v_phone,
                             'user_id', v_user, 'note', p_note));

  RETURN jsonb_build_object(
    'withdrawal_request_id', p_id,
    'amount',               v_amount,
    'phone_number',         v_phone,
    'user_id',              v_user,
    'status',               'pending'
  );
END $$;

-- ---- admin_reject_withdrawal -----------------------------------------------
-- Fully rejects a pending withdrawal in-DB. No wallet movement (request never
-- debited). A non-empty reason is mandatory for auditability.
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_amount numeric; v_user uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT status, amount, user_id INTO v_status, v_amount, v_user
  FROM withdrawal_requests WHERE id = p_id FOR UPDATE;

  IF NOT FOUND            THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', v_status; END IF;

  UPDATE withdrawal_requests
     SET status           = 'rejected',
         rejection_reason = trim(p_reason),
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'withdrawal_rejected', 'withdrawal', p_id::text,
          jsonb_build_object('amount', v_amount, 'user_id', v_user, 'reason', trim(p_reason)));

  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'rejected');
END $$;

-- ---- grants: admins are 'authenticated'; each fn self-checks _is_admin() ----
REVOKE ALL ON FUNCTION public.admin_list_withdrawals(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_withdrawal(uuid,text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(uuid,text)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_withdrawals(text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_withdrawal(uuid,text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid,text)           TO authenticated, service_role;
