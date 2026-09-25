-- ============================================================================
-- One public config call for the player app: payment limits (unchanged keys) plus game limits
-- and the live bonus offer, so the sign-up and wallet screens state what the server will
-- actually grant instead of hard-coded copy ("KSh 500 free" was wrong: the welcome bonus is
-- bonus_config.welcome_amount_cents).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_public_payment_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'deposit_provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', coalesce(public._game_setting_num('finance.min_deposit'), 100),
    'max_deposit', coalesce(public._game_setting_num('finance.max_deposit'), 150000),
    'min_withdrawal', coalesce(public._game_setting_num('finance.min_withdrawal'), 100),
    'min_bet', coalesce(public._game_setting_num('game.min_bet'), 50),
    'max_bet', coalesce(public._game_setting_num('game.max_bet'), 100000),
    'max_payout', coalesce(public._game_setting_num('game.max_payout'), 500000),
    'offer', (SELECT jsonb_build_object(
                'welcome', CASE WHEN b.welcome_enabled THEN b.welcome_amount_cents / 100 ELSE 0 END,
                'match_pct', CASE WHEN b.first_deposit_enabled THEN b.first_deposit_match_pct ELSE 0 END,
                'match_cap', CASE WHEN b.first_deposit_enabled THEN b.first_deposit_cap_cents / 100 ELSE 0 END,
                'wager_x', greatest(b.welcome_wagering_x, b.first_deposit_wagering_x))
                FROM public.bonus_config b WHERE b.id = 1 AND b.enabled)
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_public_payment_config() TO anon, authenticated, service_role;
