-- =====================================================================
-- 20260828010000_security_rls_lockdown.sql
-- CRITICAL security fix: remove exploitable client-write RLS policies.
--
-- Proven vulnerabilities (reproduced live in an authenticated-user RLS
-- context exactly as PostgREST evaluates it):
--   * wallets      : a player could UPDATE their own balance to any amount
--   * bets         : a player could INSERT/UPDATE bets (status='won', winnings)
--   * transactions : a player could INSERT forged deposit/win ledger rows
--   * profiles     : a player could UPDATE role -> 'admin' (privilege escalation),
--                    self un-ban, and inflate financial stats
--   * game_rounds  : a player could INSERT/UPDATE rounds & crash multipliers
--
-- Model: these tables are written ONLY by SECURITY DEFINER RPCs
-- (place_bet, cash_out, place_free_bet, request_withdrawal, crash/open/start
-- round, handle_new_user, admin_* ...), all owned by `postgres` and therefore
-- bypassing RLS. The frontend performs every mutation via .rpc(); it only
-- ever SELECTs these tables directly. Removing the client-write policies (and
-- the redundant write grants) closes the holes with zero impact on the app.
--
-- SELECT policies are intentionally preserved:
--   wallets(own), transactions(own), profiles(all), bets(all/public feed).
-- chat_messages INSERT (user_id = auth.uid()) is legitimate and kept.
-- =====================================================================

BEGIN;

-- WALLETS: balance changes only via SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;

-- TRANSACTIONS: ledger entries only via RPCs
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;

-- BETS: created/updated only by place_bet / cash_out / engine settlement
DROP POLICY IF EXISTS "All authenticated users can insert bets" ON public.bets;
DROP POLICY IF EXISTS "All authenticated users can update bets" ON public.bets;

-- GAME_ROUNDS: written only by the engine (open/start/crash round)
DROP POLICY IF EXISTS "All authenticated users can insert game rounds" ON public.game_rounds;
DROP POLICY IF EXISTS "All authenticated users can update game rounds" ON public.game_rounds;

-- PROFILES: provisioning via signup trigger; role/ban/financials via admin RPCs
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Defense-in-depth: revoke redundant direct write privileges from client roles.
-- (RLS already denies these now, but grants are removed too. TRUNCATE is NOT
--  RLS-gated, so it is revoked broadly across the schema.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.wallets, public.transactions, public.bets, public.game_rounds, public.profiles
  FROM anon, authenticated;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

COMMIT;
