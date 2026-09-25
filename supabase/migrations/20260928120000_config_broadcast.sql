-- ============================================================================
-- Push, don't poll: every open game page polled is_maintenance() every 20 s (3 calls a minute
-- per player — 500 requests a second at 10,000 players). The flag now goes out on the public
-- broadcast topic "config" the moment it changes; the page reads it once on load, after a
-- reconnect, and every 5 minutes as a safety net.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public._rt_config_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime, pg_temp AS $$
BEGIN
  IF NEW.key = 'system.maintenance_mode' AND NEW.value IS DISTINCT FROM OLD.value THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('maintenance', coalesce((NEW.value #>> '{}')::boolean, false)),
                            'maintenance', 'config', false);
    EXCEPTION WHEN OTHERS THEN RAISE LOG '_rt_config_event: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._rt_config_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rt_config_event ON public.system_settings;
CREATE TRIGGER trg_rt_config_event AFTER UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public._rt_config_event();

COMMIT;
