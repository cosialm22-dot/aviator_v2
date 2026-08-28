-- =====================================================================
-- Systemic write-path site_id auto-stamp (user-owned money/account tables)
-- =====================================================================
-- FINDING (P2b-2 audit): 47 func/table INSERTs omit site_id and fall to the
-- column DEFAULT (default site), so runtime money/account rows were attributed
-- to the default brand regardless of the owning user's site. Editing every
-- write path (place_bet, cash_out, _settle_flight, admin_*, ...) is large and
-- perf-sensitive on hot paths, so instead we inherit site_id declaratively via
-- a BEFORE-INSERT trigger keyed on each table's owner column -> profiles.site_id.
--
-- Scope = USER-OWNED money/account tables only:
--   user_id     : transactions, ledger_entries, wallets, withdrawal_requests,
--                 free_bets, player_risk_scores, rain_claims,
--                 device_fingerprints, chat_messages
--   marketer_id : commission_payouts
--   player_id   : referrals
--
-- DELIBERATELY EXCLUDED (deferred to the engine-multiplex phase, where per-site
-- rounds are introduced): bets, game_rounds, round_secrets, crash_queue,
-- rain_events. Rounds are still single-engine/global, so bet<->round<->player
-- site coherence is not yet defined; and bets is the hottest (bot-heavy) path.
--
-- Behaviour: on INSERT, site_id is set to the owning user's profiles.site_id
-- (authoritative). If the owner has no profile / no site, the row keeps whatever
-- site_id it already had (column default). Non-breaking for the current single
-- brand (owner site == default site -> no change). Idempotent.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._inherit_site_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _owner_col text := TG_ARGV[0];
  _owner uuid;
  _site  uuid;
BEGIN
  -- Pull the owner id out of NEW by the configured column name.
  _owner := nullif(to_jsonb(NEW) ->> _owner_col, '')::uuid;
  IF _owner IS NOT NULL THEN
    SELECT site_id INTO _site FROM public.profiles WHERE id = _owner;
    IF _site IS NOT NULL THEN
      NEW.site_id := _site;   -- owner's brand is authoritative for user-owned rows
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- user_id-owned tables
DROP TRIGGER IF EXISTS trg_inherit_site ON public.transactions;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.ledger_entries;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.wallets;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.withdrawal_requests;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.free_bets;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.free_bets
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.player_risk_scores;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.player_risk_scores
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.rain_claims;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.rain_claims
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.device_fingerprints;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.device_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

DROP TRIGGER IF EXISTS trg_inherit_site ON public.chat_messages;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('user_id');

-- marketer_id-owned
DROP TRIGGER IF EXISTS trg_inherit_site ON public.commission_payouts;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.commission_payouts
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('marketer_id');

-- player_id-owned
DROP TRIGGER IF EXISTS trg_inherit_site ON public.referrals;
CREATE TRIGGER trg_inherit_site BEFORE INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public._inherit_site_id('player_id');

COMMIT;
