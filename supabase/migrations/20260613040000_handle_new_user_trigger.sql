-- ============================================================================
-- AVIATOR V2 - MILESTONE 2 (ADDENDUM): CAPTURE on_auth_user_created TRIGGER
-- ============================================================================
-- The signup trigger on auth.users that runs handle_new_user() existed only in
-- the live database (untracked drift): no migration created it. Without this, a
-- fresh `supabase db reset` would build handle_new_user() (migration
-- 20260613030000) but never bind it, so new signups would NOT get a profile,
-- wallet, or welcome bonus.
--
-- Canonical live definition (verified via pg_get_triggerdef):
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION handle_new_user()
--
-- Reproduced below with two deliberate refinements:
--   * The function is schema-qualified (public.handle_new_user) so the binding
--     is independent of the session search_path.
--   * CREATE OR REPLACE TRIGGER (PostgreSQL 14+; server is 17.6) is used instead
--     of DROP + CREATE: it is atomic and idempotent, so there is never a window
--     in which auth.users has no trigger (no signup could slip through), whether
--     this runs on a fresh reset (creates it) or against a DB that already has
--     it (replaces an identical definition, zero behavioral change).
--
-- Depends on: 20260613030000_admin_user_management.sql (defines handle_new_user).
-- Requires the migration role to own / hold TRIGGER on auth.users, which is the
-- case under `supabase db reset` / `db push`.
-- ============================================================================

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
