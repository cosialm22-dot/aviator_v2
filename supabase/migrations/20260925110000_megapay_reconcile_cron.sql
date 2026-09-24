-- Mega Pay reconcile schedule.
--
-- Mega Pay's webhook URL is configured per merchant account and currently points to another
-- product, so this platform settles deposits by polling: the player's browser polls
-- megapay-status while the prompt is open, and this job sweeps everything else once a minute
-- (closed tabs, lost connections, late payments, "timeout" rows that were paid afterwards).
--
-- Secrets are NOT in this file. The job reads two vault secrets, created once per project:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<MEGAPAY_CRON_SECRET value>', 'megapay_cron_secret');
-- If either is missing the job logs a notice and does nothing.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.megapay_reconcile_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_req    bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url'         LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'megapay_cron_secret' LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE NOTICE 'megapay_reconcile_tick: vault secrets project_url / megapay_cron_secret are not set';
    RETURN NULL;
  END IF;
  -- Nothing to do? Don't wake the edge function.
  IF NOT EXISTS (
    SELECT 1 FROM mpesa_stk_requests
     WHERE provider = 'megapay'
       AND status IN ('initiated', 'pending', 'timeout')
       AND created_at > now() - interval '3 days'
  ) THEN
    RETURN 0;
  END IF;
  SELECT net.http_post(
           url     := rtrim(v_url, '/') || '/functions/v1/megapay-reconcile',
           body    := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
           timeout_milliseconds := 55000
         ) INTO v_req;
  RETURN v_req;
END $$;

REVOKE ALL ON FUNCTION public.megapay_reconcile_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.megapay_reconcile_tick() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'megapay_reconcile') THEN
    PERFORM cron.unschedule('megapay_reconcile');
  END IF;
  PERFORM cron.schedule('megapay_reconcile', '* * * * *', 'SELECT public.megapay_reconcile_tick();');
END $$;
