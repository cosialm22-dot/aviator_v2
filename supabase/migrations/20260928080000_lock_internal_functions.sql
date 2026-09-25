-- ============================================================================
-- P0 SECURITY: internal SECURITY DEFINER functions were callable by anyone.
--
-- Supabase grants EXECUTE on every new function in `public` to anon + authenticated by default,
-- and PostgREST exposes every such function at /rest/v1/rpc/<name>. So the whole internet could
-- call, with no login:
--   _wallet_move(user, cents, …)        → credit ANY wallet with ANY amount
--   crash_round(round) / start_round / open_round / game_tick / _settle_flight(round, mult, cp)
--                                       → crash the live round early, force-settle real bets
--   _convert_cleared_bonuses, _seed_bots, run_data_retention, prune_cron_logs, fn_game_config_record…
-- (Verified: an anonymous POST to /rest/v1/rpc/crash_round returned 204.)
--
-- Fix: revoke EXECUTE from PUBLIC/anon/authenticated on every function the apps never call
-- directly (they are only invoked by other SECURITY DEFINER functions, triggers, pg_cron or the
-- service role — none of which need the grant), and stop Supabase's default grant for new
-- functions so this cannot silently come back. Client-facing RPCs keep (or get) explicit grants.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  f record;
  internal text[] := ARRAY[
    -- money / engine internals
    '_wallet_move', '_settle_flight', '_seed_bots', '_convert_cleared_bonuses', 'crash_round', 'start_round',
    'open_round', 'game_tick', 'run_data_retention', 'prune_cron_logs', '_driver_config',
    'fn_game_config_record', 'fn_game_config_snapshot', 'fn_game_config_version', 'megapay_reconcile_tick',
    -- helpers that leak data or mutate state when called directly
    '_ensure_referral_code', '_marketer_commission_earned', '_marketer_ggr', '_notification_audience',
    '_site_commission_rate', '_site_setting_num', 'fn_effective_marketer', 'fn_is_marketer_account',
    'fn_marketer_balance', 'assess_player_risk', 'fn_platform_switch', '_admin_scope',
    -- trigger functions (never called over the API)
    '_audit_infer_site', '_inherit_site_id', '_referral_qualify_on_deposit', '_sync_free_bet_outcome',
    'block_operator_bets', 'fn_site_game_config_after_write', 'handle_new_user', 'trg_clear_bonuses_on_marketer',
    'rls_auto_enable', '_patch_fn'
  ];
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (internal) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- New functions created by the migration role are no longer executable by API roles unless a
-- migration grants it explicitly (every client RPC in this repo already does, or is listed below).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;
