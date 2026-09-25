-- Chat now reaches clients by Realtime Broadcast (trigger _rt_chat_event, 20260928130000), so the
-- table no longer needs to be WAL-decoded and RLS-checked per subscriber. Run after the client
-- that listens on topic "chat" is deployed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_messages') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_messages;
  END IF;
END $$;
