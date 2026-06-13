-- ============================================================================
-- AVIATOR V2 - ADMIN FINANCE RPCs (reconciliation, listing, M-Pesa drill-down)
-- ============================================================================
-- Under the Phase-1 security lockdown the `transactions` table has NO admin
-- RLS policy (only "Users can read own transactions" => auth.uid() = user_id).
-- The admin Finance page therefore cannot read other players' transactions
-- directly; a direct select silently returns ONLY the admin's own rows. These
-- SECURITY DEFINER functions are the sanctioned admin read paths and mirror the
-- existing admin_* RPCs: each self-checks _is_admin() and is strictly read-only.
--
-- Sign / status conventions (authoritative, derived from the deployed rails;
-- see mpesa-* edge functions, place_bet/cash_out, admin_adjust_balance):
--   deposit             : amount > 0, status 'completed'           (cash in / bonus)
--                         payment_method = 'mpesa' for STK cash; NULL for bonuses
--   withdrawal payout   : amount > 0, status 'pending'->'completed'|'failed'
--   withdrawal reversal : amount < 0, status 'completed' (credit-back on a failure)
--   bet                 : amount < 0, status 'completed'
--   win                 : amount > 0, status 'completed'
--   adjustment          : amount signed, status 'completed'
--
-- M-Pesa linkage (deterministic, set by the edge functions on insert):
--   deposit.reference    = mpesa_stk_requests.mpesa_receipt_number
--   withdrawal.reference = mpesa_b2c_requests.conversation_id
--
-- Date semantics: all ranges are half-open [p_from, p_to) on created_at; a NULL
-- bound is unbounded on that side. The client passes start-of-day for p_from and
-- start-of-next-day for p_to so the upper bound is inclusive of the chosen day.
--
-- Additive & dormant: no drops, no data DML. Safe to apply on a live database.
-- ============================================================================

-- ---- admin_finance_summary --------------------------------------------------
-- Single-row reconciliation over [p_from, p_to). Deposits vs withdrawals is the
-- headline: net_cashflow = completed deposits - gross successful payouts.
-- Reversals (failed payouts credited back) are reported separately and are NOT
-- netted into withdrawal_paid_total, because the matching positive payout row is
-- already excluded (its status is 'failed', not 'completed').
CREATE OR REPLACE FUNCTION public.admin_finance_summary(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE(
  deposit_count             bigint,
  deposit_total             numeric,
  mpesa_deposit_count       bigint,
  mpesa_deposit_total       numeric,
  bonus_deposit_total       numeric,
  withdrawal_paid_count     bigint,
  withdrawal_paid_total     numeric,
  withdrawal_pending_count  bigint,
  withdrawal_pending_total  numeric,
  withdrawal_failed_count   bigint,
  withdrawal_failed_total   numeric,
  withdrawal_reversed_total numeric,
  net_cashflow              numeric,
  bet_count                 bigint,
  bet_volume                numeric,
  win_count                 bigint,
  win_total                 numeric,
  ggr                       numeric,
  adjustment_total          numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  WITH t AS (
    SELECT type, amount, status, payment_method
    FROM transactions
    WHERE (p_from IS NULL OR created_at >= p_from)
      AND (p_to   IS NULL OR created_at <  p_to)
  )
  SELECT
    count(*)                                                                                                          FILTER (WHERE type = 'deposit' AND status = 'completed'),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method = 'mpesa'),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method = 'mpesa'), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed' AND payment_method IS DISTINCT FROM 'mpesa'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status IN ('pending','processing')),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status IN ('pending','processing')), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'withdrawal' AND status = 'failed'),
    coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'failed'), 0),
    coalesce(-sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount < 0), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0)
      - coalesce(sum(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed' AND amount > 0), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'bet'),
    coalesce(sum(abs(amount)) FILTER (WHERE type = 'bet'), 0),
    count(*)                                                                                                          FILTER (WHERE type = 'win'),
    coalesce(sum(amount) FILTER (WHERE type = 'win'), 0),
    coalesce(sum(abs(amount)) FILTER (WHERE type = 'bet'), 0)
      - coalesce(sum(amount) FILTER (WHERE type = 'win'), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'adjustment'), 0)
  FROM t;
END $$;

-- ---- admin_list_transactions ------------------------------------------------
-- Admin-wide, filtered, paginated transaction feed joined to the player's
-- username. total_count is the full filtered count (window aggregate) so the
-- client can paginate without a second round trip. p_search matches username or
-- reference (case-insensitive). The limit ceiling (10000) is deliberately high
-- to back a single-call CSV export of the active filter.
CREATE OR REPLACE FUNCTION public.admin_list_transactions(
  p_type   text        DEFAULT NULL,
  p_status text        DEFAULT NULL,
  p_from   timestamptz DEFAULT NULL,
  p_to     timestamptz DEFAULT NULL,
  p_search text        DEFAULT NULL,
  p_limit  integer     DEFAULT 100,
  p_offset integer     DEFAULT 0
)
RETURNS TABLE(
  id             uuid,
  user_id        uuid,
  username       text,
  type           text,
  amount         numeric,
  payment_method text,
  reference      text,
  description    text,
  status         text,
  created_at     timestamptz,
  total_count    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT tr.id, tr.user_id, p.username, tr.type, tr.amount, tr.payment_method,
           tr.reference, tr.description, tr.status, tr.created_at
    FROM transactions tr
    JOIN profiles p ON p.id = tr.user_id
    WHERE (p_type   IS NULL OR tr.type   = p_type)
      AND (p_status IS NULL OR tr.status = p_status)
      AND (p_from   IS NULL OR tr.created_at >= p_from)
      AND (p_to     IS NULL OR tr.created_at <  p_to)
      AND (v_search IS NULL
           OR p.username  ILIKE '%' || v_search || '%'
           OR tr.reference ILIKE '%' || v_search || '%')
  )
  SELECT f.id, f.user_id, f.username, f.type, f.amount, f.payment_method,
         f.reference, f.description, f.status, f.created_at,
         count(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 100), 10000))
  OFFSET greatest(0, coalesce(p_offset, 0));
END $$;

-- ---- admin_get_mpesa_detail -------------------------------------------------
-- Drill-down for a single transaction. Resolves the linked M-Pesa request via
-- the deterministic reference key and returns the full record (including the raw
-- Daraja callback_payload) for forensic inspection. `linked` is false when the
-- transaction is not an M-Pesa-backed deposit/withdrawal or no record matches
-- (e.g. a reversal, which carries no reference).
CREATE OR REPLACE FUNCTION public.admin_get_mpesa_detail(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_txn jsonb; v_type text; v_ref text; v_detail jsonb; v_kind text;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT to_jsonb(x), x.type, x.reference INTO v_txn, v_type, v_ref
  FROM (
    SELECT tr.id, tr.user_id, p.username, tr.type, tr.amount, tr.payment_method,
           tr.reference, tr.description, tr.status, tr.created_at
    FROM transactions tr
    JOIN profiles p ON p.id = tr.user_id
    WHERE tr.id = p_transaction_id
  ) x;

  IF v_txn IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_ref IS NOT NULL AND v_type = 'deposit' THEN
    SELECT to_jsonb(s) INTO v_detail FROM (
      SELECT id, user_id, phone_number, amount, checkout_request_id, merchant_request_id,
             mpesa_receipt_number, result_code, result_desc, status, callback_payload,
             created_at, completed_at
      FROM mpesa_stk_requests
      WHERE mpesa_receipt_number = v_ref
      LIMIT 1
    ) s;
    v_kind := 'stk';
  ELSIF v_ref IS NOT NULL AND v_type = 'withdrawal' THEN
    SELECT to_jsonb(b) INTO v_detail FROM (
      SELECT id, user_id, withdrawal_request_id, phone_number, amount, conversation_id,
             originator_conversation_id, mpesa_receipt_number, result_code, result_desc,
             status, callback_payload, created_at, completed_at
      FROM mpesa_b2c_requests
      WHERE conversation_id = v_ref
      LIMIT 1
    ) b;
    v_kind := 'b2c';
  END IF;

  RETURN jsonb_build_object(
    'transaction', v_txn,
    'kind',        v_kind,
    'detail',      v_detail,
    'linked',      (v_detail IS NOT NULL)
  );
END $$;

-- ---- grants: admins are 'authenticated'; each fn self-checks _is_admin() ----
REVOKE ALL ON FUNCTION public.admin_finance_summary(timestamptz,timestamptz)                                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_transactions(text,text,timestamptz,timestamptz,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_mpesa_detail(uuid)                                                    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_finance_summary(timestamptz,timestamptz)                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_transactions(text,text,timestamptz,timestamptz,text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_mpesa_detail(uuid)                                                    TO authenticated, service_role;
