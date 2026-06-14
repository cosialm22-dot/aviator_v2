-- ============================================================================
-- CLEANUP: drop dead legacy affiliate tables (repo<->DB drift fix)
-- ============================================================================
-- affiliates and affiliate_referrals are legacy tables from an earlier design.
-- They were applied to the live database out-of-band (created by no repo
-- migration), hold 0 rows, and are referenced by NO live function:
--   * the active referral system uses the `referrals` + `commission_payouts`
--     tables and the affiliate RPCs (admin_list_affiliates,
--     admin_affiliate_overview, admin_affiliate_referrals) all query
--     `referrals`, not these tables (verified against pg_get_functiondef).
--
-- Dropping them makes the schema honest and the repo rebuildable without dead
-- objects. Guarded with IF EXISTS so this is a no-op on a fresh rebuild (where
-- they never existed). affiliate_referrals is dropped first because it carries
-- a FK to affiliates.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.affiliate_referrals;
DROP TABLE IF EXISTS public.affiliates;

COMMIT;
