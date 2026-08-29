-- =====================================================================
-- 20260829030000_admin_bonus_adjust.sql
-- Admin balance adjust that covers the BONUS wallet too (invest254 J8 parity).
-- aviator's admin_adjust_balance is real-only; this adds a kind-aware variant
-- (real|bonus) routed through _wallet_move (cents + ledger + cache resync),
-- role-guarded (_is_admin) and audited. Existing admin_adjust_balance is left
-- intact for back-compat. Additive + idempotent.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_balance_kind(
    p_user_id uuid, p_delta numeric, p_kind text, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_bal bigint; v_delta_c bigint; v_new numeric;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_kind NOT IN ('real','bonus') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'INVALID_DELTA'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  v_delta_c := round(p_delta*100)::bigint;
  SELECT (CASE WHEN p_kind='real' THEN real_balance ELSE bonus_balance END) INTO v_bal
    FROM wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal + v_delta_c < 0 THEN RAISE EXCEPTION 'NEGATIVE_BALANCE'; END IF;
  PERFORM public._wallet_move(p_user_id, v_delta_c, p_kind, 'adjustment', 'admin', auth.uid()::text);
  SELECT balance INTO v_new FROM wallets WHERE user_id = p_user_id;
  INSERT INTO transactions(user_id, type, amount, description, status)
    VALUES (p_user_id, 'adjustment', p_delta, 'Admin '||p_kind||' adjust: '||p_reason, 'completed');
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'balance_adjust_kind', 'user', p_user_id::text,
            jsonb_build_object('delta', p_delta, 'kind', p_kind, 'reason', p_reason, 'new_balance', v_new));
  RETURN jsonb_build_object('balance', v_new, 'delta', p_delta, 'kind', p_kind);
END $fn$;

DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public.admin_adjust_balance_kind(uuid,numeric,text,text) FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.admin_adjust_balance_kind(uuid,numeric,text,text) TO authenticated, service_role;
END
$g$;

COMMIT;
-- REVERT: drop function admin_adjust_balance_kind(uuid,numeric,text,text);
