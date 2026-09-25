-- ============================================================================
-- Chat over broadcast: every chat insert was decoded from WAL and RLS-checked once per open page
-- (postgres_changes). Messages are public anyway, so they now go out on the public broadcast
-- topic "chat" (built by a trigger), and chat_messages leaves the postgres_changes publication.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public._rt_chat_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('id', NEW.id, 'user_id', NEW.user_id, 'username', NEW.username,
      'avatar_color', NEW.avatar_color, 'text', NEW.text, 'created_at', NEW.created_at), 'message', 'chat', false);
  EXCEPTION WHEN OTHERS THEN RAISE LOG '_rt_chat_event: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._rt_chat_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rt_chat_event ON public.chat_messages;
CREATE TRIGGER trg_rt_chat_event AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public._rt_chat_event();

COMMIT;
-- Run after clients listening on topic "chat" are deployed:
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_messages;
