-- ============================================================================
-- AVIATOR V2 - MILESTONE 1 (ADDENDUM): REALTIME FOR WITHDRAWALS
-- ============================================================================
-- Publishes withdrawal_requests on supabase_realtime so the admin dashboard is
-- notified live of new payout requests (pending badge + queue auto-refresh).
-- RLS is unchanged: only admins (admin_full_access policy) receive every row;
-- players still receive only their own (user_read_own_withdrawals). Idempotent.
-- ============================================================================
DO $rt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public'
                   AND tablename = 'withdrawal_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_requests;
  END IF;
END $rt$;
