-- ============================================================================
-- AVIATOR V2 — PHASE 1: SECURITY LOCKDOWN  (APPLY LAST, AT CUTOVER)
-- ============================================================================
-- ⚠️  Apply ONLY after the Phase 5 frontend (RPC-based useGame + M-Pesa-based
--     useWallet) and the Phase 4 driver are deployed. This makes the money and
--     game tables READ-ONLY for clients; all writes then flow exclusively
--     through the SECURITY DEFINER RPCs (place_bet, cash_out, game_tick,
--     handle_new_user) and the service-role M-Pesa edge functions — all of
--     which bypass RLS and are unaffected.
--
-- After this migration a logged-in user CANNOT:
--   • set their own wallet balance        (was: wallets UPDATE USING/CHECK uid)
--   • forge bets / winnings               (was: bets INSERT/UPDATE = true)
--   • mint transactions                   (was: transactions INSERT uid-only)
--   • author or mutate rounds             (was: game_rounds INSERT/UPDATE = true)
--   • read hidden crash points            (round_secrets already FORCE RLS)
-- ============================================================================

BEGIN;

-- ---- 1. Drop client WRITE policies (keep READ policies intact) --------------
DROP POLICY IF EXISTS "All authenticated users can insert bets"        ON public.bets;
DROP POLICY IF EXISTS "All authenticated users can update bets"        ON public.bets;
DROP POLICY IF EXISTS "All authenticated users can insert game rounds" ON public.game_rounds;
DROP POLICY IF EXISTS "All authenticated users can update game rounds" ON public.game_rounds;
DROP POLICY IF EXISTS "Users can insert own wallet"                    ON public.wallets;
DROP POLICY IF EXISTS "Users can update own wallet"                    ON public.wallets;
DROP POLICY IF EXISTS "Users can insert own transactions"              ON public.transactions;

-- ---- 2. Revoke table-level write grants from client roles -------------------
--      (RLS gates rows, but the blanket Supabase grants must also be removed so
--       no future permissive policy can silently re-open a write path.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.wallets, public.bets, public.transactions, public.game_rounds, public.round_secrets
  FROM anon, authenticated;
-- round_secrets is never even readable by clients:
REVOKE SELECT ON public.round_secrets FROM anon, authenticated;

-- ---- 3. Enforce a single live round at the database level -------------------
--      At most one row may be in 'waiting' or 'flying' at any time.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_round
  ON public.game_rounds ((status IN ('waiting','flying')))
  WHERE status IN ('waiting','flying');

COMMIT;

-- ============================================================================
-- POST-LOCKDOWN CHEAT VERIFICATION (run as an authenticated user; all must FAIL)
-- ============================================================================
--   update wallets set balance = 1000000 where user_id = auth.uid();        -- expect: permission denied / 0 rows
--   insert into bets(round_id,username,avatar_color,amount,status,is_bot)
--     values (gen_random_uuid(),'x','#fff',1,'won',false);                  -- expect: denied
--   insert into transactions(user_id,type,amount,status)
--     values (auth.uid(),'deposit',1000000,'completed');                    -- expect: denied
--   update game_rounds set status='crashed' where status='flying';          -- expect: denied
--   select * from round_secrets limit 1;                                    -- expect: 0 rows / denied
-- Legitimate paths still work:
--   select * from public.place_bet(<round>, 100, 2.0);                      -- ok (during 'waiting')
--   select * from public.cash_out(<round>);                                 -- ok (during 'flying')
