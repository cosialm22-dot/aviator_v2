-- ============================================================================
-- AVIATOR V2 — PHASE 4: GAME-LOOP DRIVER SCHEDULING (pg_cron + pg_net)
-- ============================================================================
-- ⚠️  DO NOT APPLY DURING STAGING. Apply ONLY at cutover, AFTER the rewritten
--     frontend (Phase 5) is deployed. Enabling this starts the server creating
--     the single shared round; if the legacy per-browser client is still live
--     it would create competing rounds.
--
-- Prereq: deploy the Edge Function first ->  supabase functions deploy game-loop
--
-- Secrets are read from Supabase Vault so the service-role key is never stored
-- in cron.job. Insert them once (replace the two placeholders):
--
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');
--
-- ============================================================================

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- Remove any prior schedule with the same name (idempotent re-apply).
select cron.unschedule('aviator-game-loop')
where exists (select 1 from cron.job where jobname = 'aviator-game-loop');

-- Keepalive: every minute, (re)invoke the game-loop Edge Function. The function
-- self-runs a 250ms tick loop for ~58s, so the game advances continuously.
select cron.schedule(
  'aviator-game-loop',
  '* * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/game-loop',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

-- To start immediately without waiting for the next minute, invoke once:
--   select net.http_post( ... same as above ... );
--
-- To STOP the driver (e.g. maintenance):
--   select cron.unschedule('aviator-game-loop');
