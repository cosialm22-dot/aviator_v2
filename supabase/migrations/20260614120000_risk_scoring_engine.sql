-- ============================================================================
-- AVIATOR V2 - REAL RISK-SCORING ENGINE  (docs/admin-dashboard/07-risk-fraud)
-- ============================================================================
-- Turns the dormant player_risk_scores table into a live, server-authoritative
-- scoring engine and wires it into withdrawal auto-approval.
--
-- Score (0-100) is the exact weighted blend from the spec:
--   win_rate 20% · bet_pattern 15% · financial 15% · account_age 10%
--   session 10% · multi_account 15% · velocity 15%
-- Levels: 0-30 low · 31-50 medium · 51-70 high · 71-100 critical.
--
-- Every factor is computed ONLY from data the platform already owns (profiles
-- totals, transactions, bets, withdrawal history, device fingerprints). The
-- session factor has no data source yet, so it is a documented neutral 0 (it is
-- still blended at its 10% weight to keep the contract stable for when session
-- telemetry lands). Nothing here can move money; assess_player_risk is read-only
-- except for upserting the score cache.
--
-- All objects are additive/idempotent and safe to apply to live production.
-- ============================================================================

BEGIN;

-- ---- 1. Device fingerprints (multi-account / collusion signal) --------------
-- Locked down: no direct client access. Writes go through record_device_
-- fingerprint() (SECURITY DEFINER); admin reads go through the risk RPCs.
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fingerprint  text NOT NULL,
  user_agent   text,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  login_count  integer NOT NULL DEFAULT 1,
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_fingerprints_fp   ON device_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_fingerprints_user ON device_fingerprints(user_id);

ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;
-- No permissive policies for authenticated/anon => deny by default. The
-- SECURITY DEFINER functions below are the only access path.

-- ---- 2. record_device_fingerprint - called by the client at login ----------
CREATE OR REPLACE FUNCTION public.record_device_fingerprint(p_fingerprint text, p_user_agent text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_fingerprint IS NULL OR length(trim(p_fingerprint)) = 0 THEN RETURN; END IF;
  INSERT INTO device_fingerprints(user_id, fingerprint, user_agent)
  VALUES (v_uid, left(trim(p_fingerprint), 128), left(p_user_agent, 512))
  ON CONFLICT (user_id, fingerprint) DO UPDATE
    SET last_seen   = now(),
        login_count = device_fingerprints.login_count + 1,
        user_agent  = coalesce(left(EXCLUDED.user_agent, 512), device_fingerprints.user_agent);
END $$;

-- ---- 3. assess_player_risk - the engine. Returns {score,level,flags} and -----
--         upserts the player_risk_scores cache. Read-only over game data.
CREATE OR REPLACE FUNCTION public.assess_player_risk(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_created      timestamptz;
  v_role         text;
  v_dep          numeric;  -- total_deposited
  v_wd           numeric;  -- total_withdrawn
  v_wag          numeric;  -- total_wagered
  -- factors (each 0..100)
  f_win    numeric := 0;
  f_pat    numeric := 0;
  f_fin    numeric := 0;
  f_age    numeric := 0;
  f_sess   numeric := 0;   -- no session telemetry yet (documented neutral)
  f_multi  numeric := 0;
  f_vel    numeric := 0;
  -- working vars
  v_n          int;        -- settled real bets
  v_wins       int;
  v_wr         numeric;
  v_top_freq   int;        -- most repeated (amount,auto_cashout) pair count
  v_streak     int;        -- consecutive high-multiplier cashouts
  v_age_days   numeric;
  v_ratio      numeric;
  v_others     int;        -- other accounts sharing a device
  v_rapid      int;        -- deposit->withdraw cycles within 1h (7d window)
  v_score      int;
  v_level      text;
  v_flags      jsonb := '[]'::jsonb;
BEGIN
  SELECT created_at, role, coalesce(total_deposited,0), coalesce(total_withdrawn,0), coalesce(total_wagered,0)
    INTO v_created, v_role, v_dep, v_wd, v_wag
  FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;

  -- (a) WIN RATE: settled real bets vs an expected ~50% baseline. Needs >=20
  -- settled bets to be meaningful, else neutral.
  SELECT count(*) FILTER (WHERE status IN ('won','lost')),
         count(*) FILTER (WHERE status = 'won')
    INTO v_n, v_wins
  FROM bets WHERE user_id = p_user_id AND is_bot = false;
  IF v_n >= 20 THEN
    v_wr := v_wins::numeric / v_n;
    f_win := greatest(0, least(100, (v_wr - 0.50) / 0.30 * 100));
    IF v_wr >= 0.70 THEN v_flags := v_flags || to_jsonb('unusual_win_rate'::text); END IF;
  END IF;

  -- (b) BET PATTERN: repetition of the exact (amount, auto_cashout) pair across
  -- the last 50 bets is bot/scripted-like behaviour.
  IF v_n >= 20 THEN
    SELECT max(c) INTO v_top_freq FROM (
      SELECT count(*) AS c
      FROM (SELECT amount, auto_cashout FROM bets
            WHERE user_id = p_user_id AND is_bot = false
            ORDER BY created_at DESC LIMIT 50) s
      GROUP BY amount, auto_cashout
    ) g;
    f_pat := greatest(0, least(100, (coalesce(v_top_freq,0)::numeric / least(v_n,50) - 0.30) / 0.50 * 100));
    IF coalesce(v_top_freq,0)::numeric / least(v_n,50) >= 0.80 THEN
      v_flags := v_flags || to_jsonb('scripted_betting'::text);
    END IF;
  END IF;

  -- consecutive high-multiplier cashouts (>=10x) -> 'unusual_wins' fraud flag
  SELECT count(*) INTO v_streak FROM (
    SELECT cashout_multiplier,
           row_number() OVER (ORDER BY created_at DESC) AS rn
    FROM bets
    WHERE user_id = p_user_id AND is_bot = false AND status = 'won'
    ORDER BY created_at DESC LIMIT 5
  ) t WHERE cashout_multiplier >= 10 AND rn <= 5;
  IF v_streak >= 5 THEN v_flags := v_flags || to_jsonb('consecutive_high_wins'::text); END IF;

  -- (c) FINANCIAL: withdrawn/deposited ratio. Withdrawing close to or more than
  -- deposits is elevated; withdrawing with little play is laundering-shaped.
  IF v_dep > 0 THEN
    v_ratio := v_wd / v_dep;
    f_fin := greatest(0, least(100, (v_ratio - 0.80) / 0.70 * 100));
  ELSIF v_wd > 0 THEN
    f_fin := 100;  -- withdrew without depositing (bonus/adjustment extraction)
  END IF;
  IF v_dep >= 10000 AND v_wag < v_dep * 0.20 AND v_wd > 0 THEN
    f_fin := greatest(f_fin, 80);
    v_flags := v_flags || to_jsonb('deposit_withdraw_no_play'::text);
  END IF;

  -- (d) ACCOUNT AGE: newer accounts are higher risk (linear, 0d->100, 30d->0).
  v_age_days := extract(epoch FROM (now() - v_created)) / 86400.0;
  f_age := greatest(0, least(100, (30 - v_age_days) / 30 * 100));

  -- (e) SESSION: no telemetry source yet -> neutral 0 (kept at 10% weight).
  f_sess := 0;

  -- (f) MULTI-ACCOUNT: other accounts sharing any of this user's device prints.
  SELECT count(DISTINCT d2.user_id) INTO v_others
  FROM device_fingerprints d1
  JOIN device_fingerprints d2 ON d2.fingerprint = d1.fingerprint AND d2.user_id <> d1.user_id
  WHERE d1.user_id = p_user_id;
  IF v_others >= 2      THEN f_multi := 100;
  ELSIF v_others = 1    THEN f_multi := 60;
  END IF;
  IF v_others >= 1 THEN v_flags := v_flags || to_jsonb('shared_device'::text); END IF;

  -- (g) VELOCITY: withdrawals created within 1h of a deposit over the last 7d.
  SELECT count(*) INTO v_rapid
  FROM withdrawal_requests w
  WHERE w.user_id = p_user_id
    AND w.created_at >= now() - interval '7 days'
    AND EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.user_id = p_user_id AND t.type = 'deposit'
        AND t.created_at <= w.created_at
        AND t.created_at >= w.created_at - interval '1 hour'
    );
  f_vel := greatest(0, least(100, v_rapid * 40));
  IF v_rapid >= 1 THEN v_flags := v_flags || to_jsonb('rapid_deposit_withdraw'::text); END IF;

  -- BLEND with the spec weights and bucket the level.
  v_score := round(
    f_win  * 0.20 + f_pat   * 0.15 + f_fin * 0.15 + f_age * 0.10 +
    f_sess * 0.10 + f_multi * 0.15 + f_vel * 0.15
  )::int;
  v_score := greatest(0, least(100, v_score));
  v_level := CASE
    WHEN v_score <= 30 THEN 'low'
    WHEN v_score <= 50 THEN 'medium'
    WHEN v_score <= 70 THEN 'high'
    ELSE 'critical'
  END;

  INSERT INTO player_risk_scores(user_id, risk_level, score, flags, last_assessed_at)
  VALUES (p_user_id, v_level, v_score, v_flags, now())
  ON CONFLICT (user_id) DO UPDATE
    SET risk_level = EXCLUDED.risk_level,
        score      = EXCLUDED.score,
        flags      = EXCLUDED.flags,
        last_assessed_at = now();

  -- Keep the denormalised profiles.risk_score in sync (used by admin sorting).
  UPDATE profiles SET risk_score = v_score WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'score', v_score, 'level', v_level, 'flags', v_flags,
    'factors', jsonb_build_object(
      'win_rate', round(f_win)::int, 'bet_pattern', round(f_pat)::int,
      'financial', round(f_fin)::int, 'account_age', round(f_age)::int,
      'session', round(f_sess)::int, 'multi_account', round(f_multi)::int,
      'velocity', round(f_vel)::int
    )
  );
END $$;

-- ---- 4. Admin helpers --------------------------------------------------------
-- Recompute one player's risk on demand (investigation tool).
CREATE OR REPLACE FUNCTION public.admin_assess_player_risk(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN assess_player_risk(p_user_id);
END $$;

-- Fraud alert queue: highest-risk players first, with cached score + flags.
CREATE OR REPLACE FUNCTION public.admin_list_fraud_alerts(p_min_level text DEFAULT 'high', p_limit integer DEFAULT 50)
RETURNS TABLE(user_id uuid, username text, risk_level text, score integer, flags jsonb,
              last_assessed_at timestamptz, total_deposited numeric, total_withdrawn numeric,
              total_wagered numeric, total_won numeric, wallet_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_min int;
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_min := CASE lower(coalesce(p_min_level,'high'))
             WHEN 'low' THEN 0 WHEN 'medium' THEN 31 WHEN 'high' THEN 51 WHEN 'critical' THEN 71
             ELSE 51 END;
  RETURN QUERY
  SELECT r.user_id, p.username, r.risk_level, r.score, r.flags, r.last_assessed_at,
         p.total_deposited, p.total_withdrawn, p.total_wagered, p.total_won, w.balance
  FROM player_risk_scores r
  JOIN profiles p ON p.id = r.user_id
  LEFT JOIN wallets w ON w.user_id = r.user_id
  WHERE r.score >= v_min
  ORDER BY r.score DESC, r.last_assessed_at DESC
  LIMIT greatest(1, least(coalesce(p_limit,50), 200));
END $$;

-- ---- 5. Wire risk into withdrawal auto-approval -----------------------------
-- Preserves every existing validation; ADDS a fresh risk assessment, persists
-- the score/flags on the request, and only auto-approves LOW-risk players.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_min numeric := coalesce(_game_setting_num('finance.min_withdrawal'), 100);
  v_thr numeric := coalesce(_game_setting_num('finance.auto_approve_threshold'), 5000);
  v_bal numeric; v_auto boolean; v_id uuid;
  v_risk jsonb; v_score int; v_flags jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  SELECT balance INTO v_bal FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_bal IS NULL    THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;

  -- Risk gate: assess now; only LOW risk (<=30) under the amount threshold and
  -- not a marketer is eligible for auto-approval. Everyone else is queued for
  -- manual review with the score + flags attached.
  v_risk  := assess_player_risk(v_uid);
  v_score := (v_risk->>'score')::int;
  v_flags := coalesce(v_risk->'flags', '[]'::jsonb);
  v_auto  := (p_amount <= v_thr)
             AND (v_score <= 30)
             AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role = 'marketer');

  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, auto_approved, risk_score, risk_flags)
  VALUES (v_uid, p_amount, v_phone, 'pending', v_auto, v_score, v_flags) RETURNING id INTO v_id;

  RETURN jsonb_build_object('withdrawal_request_id', v_id, 'status', 'pending',
    'auto_approved', v_auto, 'phone', v_phone, 'amount', p_amount,
    'risk_score', v_score, 'risk_level', v_risk->>'level');
END $$;

-- ---- 6. Least-privilege grants ----------------------------------------------
REVOKE ALL ON FUNCTION public.assess_player_risk(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_device_fingerprint(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_assess_player_risk(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_fraud_alerts(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assess_player_risk(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.record_device_fingerprint(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_assess_player_risk(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_fraud_alerts(text,integer) TO authenticated, service_role;

COMMIT;
