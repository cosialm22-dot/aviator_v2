-- =====================================================================
-- 20260829070000_marketer_accrual_economy.sql
-- Borrow #5 (accrual economy): expense-recovery + unified balance + statement.
-- invest254 0105 semantics, adapted to aviator's GGR-on-demand commission model.
--
-- DESIGN (grounded): aviator already computes commission accrual-style —
--   available = _marketer_commission_earned (GGR x site_rate, on-demand) minus
--   committed payouts. We DO NOT duplicate "earned" into a stored marketer_wallet
--   (that would create two sources of truth for the same number -> reconciliation
--   bugs). Instead we add the two missing accrual-economy pieces:
--     1) EXPENSE RECOVERY: logged marketer_expenses net out of withdrawable
--        (advances/costs recovered from commission), operator-toggleable.
--     2) ONE balance function + a running STATEMENT (ledger) unifying
--        earned / payouts / expenses, used by both the payout RPC and dashboard
--        so there is a single source of truth and NO double-pay path.
-- Additive + idempotent. Does not touch the bet-settlement path.
-- =====================================================================
BEGIN;

-- Operator toggle: do logged expenses reduce withdrawable commission?
ALTER TABLE public.marketing_config
  ADD COLUMN IF NOT EXISTS expenses_reduce_commission boolean NOT NULL DEFAULT true;

-- Single source of truth for a marketer's money position (KES).
CREATE OR REPLACE FUNCTION public.fn_marketer_balance(p_marketer uuid)
 RETURNS TABLE(earned numeric, paid numeric, pending numeric, approved numeric,
               committed numeric, expenses numeric, available numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH e AS (SELECT public._marketer_commission_earned(p_marketer) AS earned),
  po AS (
    SELECT coalesce(sum(amount) FILTER (WHERE status='paid'),0)     AS paid,
           coalesce(sum(amount) FILTER (WHERE status='pending'),0)  AS pending,
           coalesce(sum(amount) FILTER (WHERE status='approved'),0) AS approved
      FROM public.commission_payouts WHERE marketer_id = p_marketer
  ),
  ex AS (
    SELECT CASE WHEN (SELECT coalesce(expenses_reduce_commission,true) FROM public.marketing_config WHERE id = true)
                THEN coalesce((SELECT sum(amount_cents) FROM public.marketer_expenses WHERE marketer_id = p_marketer),0)/100.0
                ELSE 0 END AS expenses
  )
  SELECT e.earned, po.paid, po.pending, po.approved,
         (po.paid + po.pending + po.approved) AS committed,
         ex.expenses,
         greatest(e.earned - (po.paid + po.pending + po.approved) - ex.expenses, 0) AS available
    FROM e, po, ex
$fn$;

-- Running statement (ledger): summary + itemised debits (payouts + expenses).
-- Own marketer or admin only.
CREATE OR REPLACE FUNCTION public.fn_marketer_ledger(p_marketer uuid, p_limit int DEFAULT 100)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_bal record; v_entries jsonb;
BEGIN
  IF NOT (public._is_admin() OR auth.uid() = p_marketer) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_bal FROM public.fn_marketer_balance(p_marketer);
  SELECT coalesce(jsonb_agg(x ORDER BY x.ts DESC), '[]'::jsonb) INTO v_entries FROM (
    SELECT created_at AS ts, 'payout' AS kind,
           ('Payout '||status||coalesce(' · '||mpesa_receipt,'')) AS description,
           (-amount)::numeric AS amount
      FROM public.commission_payouts WHERE marketer_id = p_marketer
    UNION ALL
    SELECT created_at AS ts, 'expense' AS kind,
           ('Expense: '||category||coalesce(' · '||note,'')) AS description,
           (-amount_cents::numeric/100.0) AS amount
      FROM public.marketer_expenses WHERE marketer_id = p_marketer
  ) x
  LIMIT greatest(1, least(coalesce(p_limit,100), 500));
  RETURN jsonb_build_object(
    'earned', v_bal.earned, 'paid', v_bal.paid, 'pending', v_bal.pending,
    'approved', v_bal.approved, 'committed', v_bal.committed,
    'expenses', v_bal.expenses, 'available', v_bal.available,
    'entries', v_entries);
END $fn$;

-- Repoint the marketer payout request at the unified balance (nets expenses).
CREATE OR REPLACE FUNCTION public.request_commission_payout(p_amount numeric, p_phone text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_available numeric; v_id uuid;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW'; END IF;
  IF p_amount <> trunc(p_amount)       THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  IF EXISTS (SELECT 1 FROM commission_payouts WHERE marketer_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'PAYOUT_PENDING';
  END IF;
  -- Single source of truth: earned - committed - expenses (see fn_marketer_balance).
  SELECT available INTO v_available FROM public.fn_marketer_balance(v_uid);
  IF p_amount > v_available THEN RAISE EXCEPTION 'INSUFFICIENT_COMMISSION: available %', v_available; END IF;
  INSERT INTO commission_payouts(marketer_id, amount, phone_number, status)
  VALUES (v_uid, p_amount, v_phone, 'pending') RETURNING id INTO v_id;
  RETURN jsonb_build_object('commission_payout_id', v_id, 'amount', p_amount, 'phone', v_phone, 'status', 'pending');
END $function$;

-- Dashboard: surface expenses + net available (reuse the unified balance).
CREATE OR REPLACE FUNCTION public.marketer_dashboard()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_rate numeric; v_referred int; v_qualified int; v_ggr numeric;
  v_bal record; v_payouts jsonb; v_expenses jsonb;
BEGIN
  IF NOT _is_marketer() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT referral_code INTO v_code FROM profiles WHERE id = v_uid;
  SELECT commission_rate INTO v_rate FROM marketing_config WHERE id = true;
  SELECT count(*), count(*) FILTER (WHERE status = 'qualified') INTO v_referred, v_qualified
    FROM referrals WHERE marketer_id = v_uid;
  v_ggr := _marketer_ggr(v_uid);
  SELECT * INTO v_bal FROM public.fn_marketer_balance(v_uid);
  SELECT coalesce(jsonb_agg(p ORDER BY p.created_at DESC), '[]'::jsonb) INTO v_payouts FROM (
    SELECT id, amount, phone_number, status, mpesa_receipt, rejection_reason, reviewed_at, paid_at, created_at
    FROM commission_payouts WHERE marketer_id = v_uid ORDER BY created_at DESC LIMIT 50) p;
  SELECT coalesce(jsonb_agg(e ORDER BY e.created_at DESC), '[]'::jsonb) INTO v_expenses FROM (
    SELECT id, category, amount_cents, note, created_at
    FROM marketer_expenses WHERE marketer_id = v_uid ORDER BY created_at DESC LIMIT 50) e;
  RETURN jsonb_build_object(
    'referral_code', v_code, 'commission_rate', v_rate,
    'referred_count', v_referred, 'qualified_count', v_qualified,
    'lifetime_ggr', v_ggr, 'commission_earned', v_bal.earned,
    'commission_paid', v_bal.paid, 'commission_pending', v_bal.pending,
    'commission_approved', v_bal.approved,
    'commission_expenses', v_bal.expenses,
    'commission_available', v_bal.available,
    'payouts', v_payouts, 'expenses', v_expenses);
END $function$;

DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public.fn_marketer_balance(uuid) FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_marketer_balance(uuid) TO authenticated, service_role;
  REVOKE ALL ON FUNCTION public.fn_marketer_ledger(uuid,int) FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_marketer_ledger(uuid,int) TO authenticated, service_role;
END
$g$;

COMMIT;
-- REVERT: restore request_commission_payout + marketer_dashboard from
--   20260613080000/prior; drop fn_marketer_ledger, fn_marketer_balance;
--   alter table marketing_config drop column expenses_reduce_commission.
