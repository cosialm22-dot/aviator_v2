-- =====================================================================
-- 20260829010000_fix_mpesa_deposit_credit.sql
-- P1b companion fix: real M-Pesa deposits must credit real_balance (cents) +
-- ledger, not just the numeric `balance` cache.
--
-- ROOT CAUSE: the mpesa-stk-callback edge function credits wallets.balance
--   directly. Post-P1b, `balance` is a DERIVED cache that _wallet_move
--   recomputes as (real_balance + bonus_balance) on the next money move, so a
--   real deposit was ERASED on the player's next bet/cashout and never became
--   withdrawable (request_withdrawal checks real_balance).
--
-- FIX (DB-side, no edge redeploy required): an AFTER INSERT trigger on
--   transactions credits real_balance via _wallet_move for completed M-Pesa
--   deposits. The edge function's manual `balance` write is overwritten by
--   _wallet_move's resync, so real_balance is credited EXACTLY ONCE (only the
--   trigger touches real_balance). Idempotency is hardened by a unique index on
--   the M-Pesa receipt so a retried callback cannot double-insert/double-credit.
--
-- Fires BEFORE trg_fdm_bonus (name order) so the deposit is credited before the
--   first-deposit match is granted; both are independent of each other.
--
-- Additive + idempotent. No existing M-Pesa deposits exist (signup 'deposit'
--   rows have payment_method IS NULL), so no backfill is required.
-- =====================================================================

BEGIN;

-- Idempotency backstop: one credited transaction per M-Pesa receipt.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tx_mpesa_receipt
  ON public.transactions(reference)
  WHERE type = 'deposit' AND payment_method = 'mpesa' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_credit_mpesa_deposit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NEW.type = 'deposit' AND coalesce(NEW.payment_method,'') = 'mpesa' AND NEW.status = 'completed' THEN
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
    -- Credit real (withdrawable) cash + double-entry ledger + resync cache.
    PERFORM public._wallet_move(NEW.user_id, round(NEW.amount*100)::bigint,
                                'real', 'deposit', 'transactions', NEW.id::text);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_credit_mpesa_deposit ON public.transactions;
CREATE TRIGGER trg_credit_mpesa_deposit
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_credit_mpesa_deposit();

DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public.fn_credit_mpesa_deposit() FROM public, anon, authenticated;
END
$g$;

COMMIT;

-- REVERT: drop trigger trg_credit_mpesa_deposit; drop function fn_credit_mpesa_deposit();
--         drop index uniq_tx_mpesa_receipt;
