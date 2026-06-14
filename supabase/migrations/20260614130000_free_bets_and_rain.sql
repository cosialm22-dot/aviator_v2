-- ============================================================================
-- AVIATOR V2 - FREE BETS + RAIN PROMO  (module 8: bonus & promotions engine)
-- ============================================================================
-- Adds two player-facing promo mechanics on top of the server-authoritative
-- engine, money-correct and fully server-side:
--
--   FREE BET  - a risk-free stake. The stake is NOT debited from the wallet and
--               is NOT returned on a win: a winning free bet pays only the NET
--               profit (amount * (multiplier - 1)), capped by game.max_payout.
--               This is the standard sportsbook free-bet semantic and keeps the
--               house math identical to a normal bet minus the returned stake.
--               Free bets never count toward wagering requirements.
--
--   RAIN      - an operator-dropped bonus pot split equally across the first N
--               claimers within a time window. Each claim credits the wallet as
--               a 'bonus' transaction. One claim per user per event.
--
-- Settlement reuses the existing _settle_flight / cash_out paths via a single
-- payout helper so there is ONE source of truth for win math. A lightweight
-- trigger syncs each free bet's outcome from its linked bet row, so crash_round
-- is left untouched.
--
-- Additive/idempotent; safe to apply to live production. Money RPCs are
-- SECURITY DEFINER with least-privilege grants.
-- ============================================================================

BEGIN;

-- ---- 1. free_bets ledger -----------------------------------------------------
CREATE TABLE IF NOT EXISTS free_bets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','used','won','lost','expired')),
  source        text NOT NULL DEFAULT 'grant',   -- grant | rain | campaign
  granted_by    uuid REFERENCES profiles(id),
  used_round_id uuid REFERENCES game_rounds(id),
  used_bet_id   uuid REFERENCES bets(id),
  won_amount    numeric(12,2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz,
  settled_at    timestamptz,
  expires_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_free_bets_user_active
  ON free_bets(user_id) WHERE status = 'active';

ALTER TABLE free_bets ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='free_bets' AND policyname='Players read own free bets') THEN
    CREATE POLICY "Players read own free bets" ON free_bets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $p$;

-- ---- 2. bets: mark free bets + link back to the grant -----------------------
ALTER TABLE bets ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS free_bet_id uuid REFERENCES free_bets(id);

-- ---- 3. rain events + claims -------------------------------------------------
CREATE TABLE IF NOT EXISTS rain_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_amount  numeric(12,2) NOT NULL CHECK (total_amount > 0),
  per_user      numeric(12,2) NOT NULL CHECK (per_user > 0),
  max_claims    integer NOT NULL CHECK (max_claims > 0),
  claims_count  integer NOT NULL DEFAULT 0,
  message       text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rain_open ON rain_events(expires_at) WHERE claims_count < max_claims;

CREATE TABLE IF NOT EXISTS rain_claims (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rain_id    uuid NOT NULL REFERENCES rain_events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount     numeric(12,2) NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rain_id, user_id)
);

ALTER TABLE rain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rain_claims ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rain_events' AND policyname='Anyone authenticated reads rain') THEN
    CREATE POLICY "Anyone authenticated reads rain" ON rain_events FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rain_claims' AND policyname='Players read own rain claims') THEN
    CREATE POLICY "Players read own rain claims" ON rain_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $p$;

-- ---- 4. Single source of truth for win math --------------------------------
-- Normal bet pays amount*mult (stake was debited at placement). Free bet pays
-- only the net profit amount*(mult-1) (stake was never debited / not returned).
-- Both capped by game.max_payout.
CREATE OR REPLACE FUNCTION public._bet_credit(p_amount numeric, p_mult numeric, p_is_free boolean, p_maxpay numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT least(
    floor((CASE WHEN p_is_free THEN p_amount * (p_mult - 1) ELSE p_amount * p_mult END) * 100) / 100,
    p_maxpay
  );
$$;

-- ---- 5. Sync a free bet's outcome from its linked bet's terminal status -----
CREATE OR REPLACE FUNCTION public._sync_free_bet_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_free AND NEW.free_bet_id IS NOT NULL
     AND NEW.status IN ('won','lost') AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE free_bets
       SET status     = NEW.status,
           won_amount = CASE WHEN NEW.status='won' THEN NEW.winnings ELSE 0 END,
           settled_at = now()
     WHERE id = NEW.free_bet_id AND status = 'used';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_free_bet_outcome ON bets;
CREATE TRIGGER trg_sync_free_bet_outcome
  AFTER UPDATE OF status ON bets
  FOR EACH ROW EXECUTE FUNCTION public._sync_free_bet_outcome();

-- ---- 6. _settle_flight - now free-bet aware (net payout via _bet_credit) -----
CREATE OR REPLACE FUNCTION public._settle_flight(p_round_id uuid, p_now_mult numeric, p_crash_point numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  rec record; w numeric;
BEGIN
  -- bots (no wallet impact, never free)
  UPDATE bets SET status='won', cashout_multiplier=auto_cashout,
         winnings = least(floor(amount*auto_cashout*100)/100, v_maxpay)
   WHERE round_id=p_round_id AND is_bot=true AND status='active'
     AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point;
  -- real players (credit wallet + ledger atomically; free bets pay net only)
  FOR rec IN
    SELECT * FROM bets
     WHERE round_id=p_round_id AND is_bot=false AND status='active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= p_now_mult AND auto_cashout < p_crash_point
     FOR UPDATE
  LOOP
    w := _bet_credit(rec.amount, rec.auto_cashout, rec.is_free, v_maxpay);
    UPDATE bets SET status='won', cashout_multiplier=rec.auto_cashout, winnings=w WHERE id=rec.id;
    UPDATE wallets SET balance=balance+w, updated_at=now() WHERE user_id=rec.user_id;
    INSERT INTO transactions(user_id,type,amount,description,status)
    VALUES (rec.user_id,'win',w,
      CASE WHEN rec.is_free THEN 'Free-bet auto cashout at ' ELSE 'Auto cashout at ' END
        || to_char(rec.auto_cashout,'FM999990.00')||'x','completed');
  END LOOP;
END $$;

-- ---- 7. cash_out - now free-bet aware ---------------------------------------
CREATE OR REPLACE FUNCTION public.cash_out(p_round_id uuid, p_slot smallint DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_secret round_secrets%rowtype; v_bet bets%rowtype;
  v_mult numeric; v_winnings numeric; v_bal numeric;
  v_maxpay numeric := coalesce(_game_setting_num('game.max_payout'), 500000);
  v_elapsed_ms double precision;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  SELECT * INTO v_bet FROM bets
   WHERE round_id=p_round_id AND user_id=v_uid AND is_bot=false AND slot=p_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_BET'; END IF;
  IF v_bet.status='won' THEN
    RETURN jsonb_build_object('multiplier',v_bet.cashout_multiplier,'winnings',v_bet.winnings,'slot',p_slot,'idempotent',true);
  END IF;
  IF v_bet.status <> 'active' THEN RAISE EXCEPTION 'BET_NOT_ACTIVE'; END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF v_round.status <> 'flying' OR v_round.started_at IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FLYING'; END IF;
  SELECT * INTO v_secret FROM round_secrets WHERE round_id=p_round_id;
  IF v_secret.crashes_at IS NOT NULL AND clock_timestamp() >= v_secret.crashes_at THEN
    RAISE EXCEPTION 'ROUND_CRASHED';
  END IF;

  v_elapsed_ms := extract(epoch from (clock_timestamp()-v_round.started_at))*1000.0;
  v_mult := _multiplier_at(v_elapsed_ms);
  IF v_mult >= v_secret.crash_point THEN RAISE EXCEPTION 'ROUND_CRASHED'; END IF;

  v_winnings := _bet_credit(v_bet.amount, v_mult, v_bet.is_free, v_maxpay);
  UPDATE bets SET status='won', cashout_multiplier=v_mult, winnings=v_winnings WHERE id=v_bet.id;
  UPDATE wallets SET balance=balance+v_winnings, updated_at=now() WHERE user_id=v_uid RETURNING balance INTO v_bal;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'win',v_winnings,
    CASE WHEN v_bet.is_free THEN 'Free-bet cashed out at ' ELSE 'Cashed out at ' END
      || to_char(v_mult,'FM999990.00')||'x (slot '||p_slot||')','completed');

  RETURN jsonb_build_object('multiplier',v_mult,'winnings',v_winnings,'slot',p_slot,'balance',v_bal,'free',v_bet.is_free);
END $$;

-- ---- 8. place_free_bet - stake a granted free bet (no wallet debit) ----------
CREATE OR REPLACE FUNCTION public.place_free_bet(p_round_id uuid, p_free_bet_id uuid, p_auto_cashout numeric DEFAULT NULL, p_slot smallint DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_round game_rounds%rowtype; v_fb free_bets%rowtype;
  v_username text; v_color text; v_role text; v_bet_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_slot NOT IN (1,2) THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  IF p_auto_cashout IS NOT NULL AND p_auto_cashout <= 1.00 THEN RAISE EXCEPTION 'INVALID_AUTO_CASHOUT'; END IF;

  SELECT * INTO v_fb FROM free_bets WHERE id=p_free_bet_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FREE_BET_NOT_FOUND'; END IF;
  IF v_fb.status <> 'active' THEN RAISE EXCEPTION 'FREE_BET_NOT_ACTIVE'; END IF;
  IF v_fb.expires_at IS NOT NULL AND now() >= v_fb.expires_at THEN
    UPDATE free_bets SET status='expired' WHERE id=v_fb.id;
    RAISE EXCEPTION 'FREE_BET_EXPIRED';
  END IF;

  SELECT * INTO v_round FROM game_rounds WHERE id=p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'waiting' OR now() >= v_round.betting_ends_at THEN RAISE EXCEPTION 'BETTING_CLOSED'; END IF;
  IF EXISTS (SELECT 1 FROM bets WHERE round_id=p_round_id AND user_id=v_uid AND slot=p_slot) THEN
    RAISE EXCEPTION 'ALREADY_BET';
  END IF;

  SELECT username, avatar_color, role INTO v_username, v_color, v_role FROM profiles WHERE id=v_uid;
  IF v_username IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;

  INSERT INTO bets(round_id,user_id,username,avatar_color,amount,auto_cashout,status,is_bot,slot,is_free,free_bet_id)
  VALUES (p_round_id,v_uid,v_username,v_color,v_fb.amount,p_auto_cashout,'active',false,p_slot,true,v_fb.id)
  RETURNING id INTO v_bet_id;

  UPDATE free_bets SET status='used', used_at=now(), used_round_id=p_round_id, used_bet_id=v_bet_id WHERE id=v_fb.id;

  RETURN jsonb_build_object('bet_id',v_bet_id,'round_id',p_round_id,'amount',v_fb.amount,'slot',p_slot,'free',true);
END $$;

-- ---- 9. Admin: grant a free bet ---------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_free_bet(p_user_id uuid, p_amount numeric, p_expires_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO free_bets(user_id, amount, source, granted_by, expires_at)
  VALUES (p_user_id, round(p_amount,2), 'grant', auth.uid(),
          CASE WHEN coalesce(p_expires_days,0) > 0 THEN now() + (p_expires_days||' days')::interval ELSE NULL END)
  RETURNING id INTO v_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'free_bet_granted', 'user', p_user_id::text,
          jsonb_build_object('amount', round(p_amount,2), 'free_bet_id', v_id));
  RETURN jsonb_build_object('free_bet_id', v_id, 'user_id', p_user_id, 'amount', round(p_amount,2));
END $$;

-- ---- 10. Admin: start a rain event ------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_start_rain(p_total numeric, p_max_claims integer, p_window_seconds integer DEFAULT 300, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_per numeric; v_id uuid;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_total IS NULL OR p_total <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_max_claims IS NULL OR p_max_claims <= 0 THEN RAISE EXCEPTION 'INVALID_MAX_CLAIMS'; END IF;
  v_per := floor((p_total / p_max_claims) * 100) / 100;
  IF v_per <= 0 THEN RAISE EXCEPTION 'PER_USER_TOO_SMALL'; END IF;
  INSERT INTO rain_events(total_amount, per_user, max_claims, message, created_by, expires_at)
  VALUES (round(p_total,2), v_per, p_max_claims, nullif(trim(coalesce(p_message,'')),''), auth.uid(),
          now() + (greatest(30, coalesce(p_window_seconds,300))||' seconds')::interval)
  RETURNING id INTO v_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'rain_started', 'rain', v_id::text,
          jsonb_build_object('total', round(p_total,2), 'per_user', v_per, 'max_claims', p_max_claims));
  RETURN jsonb_build_object('rain_id', v_id, 'per_user', v_per, 'max_claims', p_max_claims);
END $$;

-- ---- 11. Player: claim a rain drop ------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_rain(p_rain_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_ev rain_events%rowtype; v_bal numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id=v_uid;
  IF v_role IN ('admin','super_admin') THEN RAISE EXCEPTION 'OPERATORS_CANNOT_PLAY'; END IF;

  SELECT * INTO v_ev FROM rain_events WHERE id=p_rain_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAIN_NOT_FOUND'; END IF;
  IF now() >= v_ev.expires_at THEN RAISE EXCEPTION 'RAIN_EXPIRED'; END IF;
  IF v_ev.claims_count >= v_ev.max_claims THEN RAISE EXCEPTION 'RAIN_DEPLETED'; END IF;
  IF EXISTS (SELECT 1 FROM rain_claims WHERE rain_id=p_rain_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED';
  END IF;

  INSERT INTO rain_claims(rain_id, user_id, amount) VALUES (p_rain_id, v_uid, v_ev.per_user);
  UPDATE rain_events SET claims_count = claims_count + 1 WHERE id=p_rain_id;
  UPDATE wallets SET balance = balance + v_ev.per_user, updated_at=now() WHERE user_id=v_uid RETURNING balance INTO v_bal;
  INSERT INTO transactions(user_id,type,amount,description,status)
  VALUES (v_uid,'bonus',v_ev.per_user,'Rain bonus claim','completed');

  RETURN jsonb_build_object('rain_id', p_rain_id, 'amount', v_ev.per_user, 'balance', v_bal);
END $$;

-- ---- 12. Least-privilege grants ---------------------------------------------
REVOKE ALL ON FUNCTION public.place_free_bet(uuid,uuid,numeric,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rain(uuid)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_free_bet(uuid,numeric,integer)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_start_rain(numeric,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_free_bet(uuid,uuid,numeric,smallint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_rain(uuid)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_free_bet(uuid,numeric,integer)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_start_rain(numeric,integer,integer,text) TO authenticated, service_role;

COMMIT;
