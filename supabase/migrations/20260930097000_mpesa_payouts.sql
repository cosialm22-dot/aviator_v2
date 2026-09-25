-- ============================================================================
-- Automatic M-Pesa payouts (Safaricom Daraja B2C) — the whole withdrawal money path.
--
-- Before this migration a withdrawal request held nothing (the player kept betting the money)
-- and approval called a legacy function that was never configured, so no withdrawal could
-- complete. Now (invest254 docs/08 §3 + docs/33 + docs/43, hardened):
--
--   request   → the amount is HELD at once (real balance debited, ledger 'withdrawal_hold').
--               Small, low-risk requests within the brand's daily automatic budget are approved
--               on the spot; the rest wait for review.
--   approved  → queued. If the brand's payment owner (brand → platform → System, see
--               20260930096000) has a tested B2C account and the brand pays out automatically,
--               the payout worker sends it within seconds; otherwise staff pay it by hand and
--               record the M-Pesa receipt ("manual rail").
--   processing→ ONE B2C request per attempt, written to payout_attempts BEFORE it is sent
--               (write-ahead), keyed by our OriginatorConversationID. Safaricom answers on a
--               per-attempt callback URL carrying an HMAC token.
--   completed → Safaricom reported success for the exact amount; receipt stored; player told.
--   needs_attention → anything not provably settled (a Safaricom failure on our side such as
--               low float or a bad initiator, no answer after 60 minutes, a mismatch). Funds stay
--               HELD. Staff: retry, mark paid (with receipt) or refund.
--   failed / rejected / cancelled → terminal; the hold is returned to the player's wallet.
--
-- Never-double-pay rules: rows are claimed with FOR UPDATE SKIP LOCKED; an attempt whose outcome
-- is unknown is NEVER resent automatically (a Transaction Status query asks Safaricom instead);
-- a retry or refund after an unknown outcome needs staff to confirm the payout did not happen.
-- ============================================================================

-- ── 1. B2C accounts in the integrations catalog (payment scopes apply) ──────────────────────
CREATE OR REPLACE FUNCTION public._integration_catalog()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'cloudflare', jsonb_build_object(
      'label', 'Cloudflare (domains)',
      'help', 'Creates each brand''s Cloudflare zone, connects its domain to the app and issues HTTPS. The account must be the one that runs the app''s Worker.',
      'scopes', jsonb_build_array('global'),
      'config', jsonb_build_array(
        jsonb_build_object('name','account_id','label','Account ID','kind','text','required',true,'pattern','^[0-9a-f]{32}$',
          'help','Cloudflare dashboard → any domain → Overview → API → Account ID.'),
        jsonb_build_object('name','worker_service','label','Worker name','kind','text','required',true,'default','aviatorv2','pattern','^[a-z0-9][a-z0-9-]{0,62}$',
          'help','The Worker that serves the app (wrangler.jsonc "name").')),
      'secrets', jsonb_build_array(
        jsonb_build_object('name','api_token','label','API token','required',true,
          'help','My Profile → API Tokens → Create token. Permissions: Account · Workers Scripts · Edit; Zone · Zone · Edit; Zone · DNS · Edit; Zone · Workers Routes · Edit. Zone resources: all zones in the account.'))),
    'megapay', jsonb_build_object(
      'label', 'Mega Pay (M-Pesa deposits)',
      'help', 'Players pay by M-Pesa prompt into this Mega Pay account. The business name on the prompt is set in the Mega Pay merchant account; the account name is the brand''s "M-Pesa account name".',
      'scopes', jsonb_build_array('global','platform','site'),
      'config', jsonb_build_array(
        jsonb_build_object('name','email','label','Account email','kind','email','required',true,
          'help','The email of the Mega Pay merchant account (Mega Pay dashboard → Profile).'),
        jsonb_build_object('name','env','label','Environment','kind','enum','required',true,'default','production','options',jsonb_build_array('production','sandbox'),'owner_only',true,
          'help','Sandbox is for tests with a sandbox key. Only the System owner can choose it.'),
        jsonb_build_object('name','base_url','label','API address','kind','url','required',false,'owner_only',true,
          'help','Leave empty to use Mega Pay''s own address. Only the System owner can change it.')),
      'secrets', jsonb_build_array(
        jsonb_build_object('name','api_key','label','API key','required',true,
          'help','Mega Pay dashboard → API keys. Test the connection before going live.'))),
    'mpesa_b2c', jsonb_build_object(
      'label', 'M-Pesa payouts (Daraja B2C)',
      'help', 'Pays approved withdrawals straight to the player''s M-Pesa from this organisation''s B2C (bulk payment) account. Needs a Safaricom Daraja app with the B2C product on this shortcode. Test connection signs in and asks Safaricom for the account balance.',
      'scopes', jsonb_build_array('global','platform','site'),
      'config', jsonb_build_array(
        jsonb_build_object('name','shortcode','label','B2C shortcode','kind','text','required',true,'pattern','^[0-9]{5,7}$',
          'help','The bulk payment (B2C) shortcode the money is paid from.'),
        jsonb_build_object('name','initiator_name','label','Initiator name','kind','text','required',true,'pattern','^[A-Za-z0-9_.@ -]{2,60}$',
          'help','The API operator created in the M-Pesa organisation portal for this shortcode.'),
        jsonb_build_object('name','command_id','label','Payment type','kind','enum','required',true,'default','BusinessPayment',
          'options',jsonb_build_array('BusinessPayment','SalaryPayment','PromotionPayment'),
          'help','BusinessPayment for withdrawals (the usual choice).'),
        jsonb_build_object('name','env','label','Environment','kind','enum','required',true,'default','production','options',jsonb_build_array('production','sandbox'),'owner_only',true,
          'help','Sandbox is Safaricom''s test system. Only the System owner can choose it.'),
        jsonb_build_object('name','api_base','label','API address','kind','url','required',false,'owner_only',true,
          'help','Leave empty to use Safaricom''s own address. Only the System owner can change it.')),
      'secrets', jsonb_build_array(
        jsonb_build_object('name','consumer_key','label','Consumer key','required',true,'help','Daraja portal → My apps → the app with B2C.'),
        jsonb_build_object('name','consumer_secret','label','Consumer secret','required',true,'help','Same app.'),
        jsonb_build_object('name','security_credential','label','Security credential','required',true,
          'help','The initiator password encrypted with Safaricom''s certificate (Daraja portal → your app → Security credentials → Generate). Paste the long result.')))
  );
$$;

-- ── 2. System kill switch for automatic payouts ─────────────────────────────────────────────
ALTER TABLE public.platform_global_config ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.fn_platform_set_global_config(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE g public.platform_global_config;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'platform_superadmin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;
  UPDATE public.platform_global_config SET
    deposits_enabled      = coalesce((p_patch->>'deposits_enabled')::boolean,      deposits_enabled),
    withdrawals_enabled   = coalesce((p_patch->>'withdrawals_enabled')::boolean,   withdrawals_enabled),
    payouts_enabled       = coalesce((p_patch->>'payouts_enabled')::boolean,       payouts_enabled),
    play_enabled          = coalesce((p_patch->>'play_enabled')::boolean,          play_enabled),
    marketers_enabled     = coalesce((p_patch->>'marketers_enabled')::boolean,     marketers_enabled),
    registrations_enabled = coalesce((p_patch->>'registrations_enabled')::boolean, registrations_enabled),
    maintenance_message   = CASE WHEN p_patch ? 'maintenance_message'
                                 THEN nullif(p_patch->>'maintenance_message','') ELSE maintenance_message END,
    version    = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
   WHERE id RETURNING * INTO g;
  INSERT INTO public.platform_global_config_versions(version, snapshot, changed_by)
    VALUES (g.version, to_jsonb(g), auth.uid());
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'platform_config_set', 'platform', 'global',
            jsonb_build_object('patch', p_patch, 'version', g.version));
  PERFORM pg_notify('platform_config_changed', g.version::text);
  -- turning automatic payouts back on releases anything queued meanwhile
  IF (p_patch->>'payouts_enabled')::boolean IS TRUE THEN PERFORM public._payout_kick(); END IF;
  RETURN to_jsonb(g);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_platform_switch(p_field text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT coalesce((
    SELECT CASE p_field
             WHEN 'deposits_enabled'      THEN deposits_enabled
             WHEN 'withdrawals_enabled'   THEN withdrawals_enabled
             WHEN 'payouts_enabled'       THEN payouts_enabled
             WHEN 'play_enabled'          THEN play_enabled
             WHEN 'marketers_enabled'     THEN marketers_enabled
             WHEN 'registrations_enabled' THEN registrations_enabled
             ELSE true END
      FROM public.platform_global_config WHERE id), true);
$function$;

-- ── 3. brand settings ───────────────────────────────────────────────────────────────────────
INSERT INTO public.brand_setting_defs(key, section, kind, label, help, default_value, inherit, min_value, max_value, options, pattern, max_len, is_public, edit_tier, floor_setting, ceil_setting, sort)
VALUES
 ('payments.auto_payout', 'payments', 'bool', 'Pay out automatically',
  'When this brand''s payment account can pay by M-Pesa (B2C), approved withdrawals are sent at once. Off: staff press Pay for each one.',
  'true', NULL, NULL, NULL, NULL, NULL, NULL, false, 'platform', NULL, NULL, 20),
 ('limits.auto_payout_daily', 'limits', 'money', 'Automatic approvals per day',
  'Most this brand approves automatically in one Nairobi day. Past it, withdrawals wait for review. Blank = no cap.',
  'null', NULL, 0, 100000000, NULL, NULL, NULL, false, 'platform', NULL, NULL, 125)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, help = EXCLUDED.help, section = EXCLUDED.section, kind = EXCLUDED.kind,
  default_value = EXCLUDED.default_value, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
  edit_tier = EXCLUDED.edit_tier, is_public = EXCLUDED.is_public, sort = EXCLUDED.sort;

-- ── 4. withdrawal state + attempts ──────────────────────────────────────────────────────────
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS held_cents        bigint,
  ADD COLUMN IF NOT EXISTS rail              text,             -- 'mpesa_b2c' | 'manual' (decided at approval, re-checked at send)
  ADD COLUMN IF NOT EXISTS payment_scope     text,
  ADD COLUMN IF NOT EXISTS integration_id    uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS release_requested boolean NOT NULL DEFAULT false,   -- staff pressed Pay (auto payout off)
  ADD COLUMN IF NOT EXISTS attempts          int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attention_reason  text,
  ADD COLUMN IF NOT EXISTS recipient_name    text,
  ADD COLUMN IF NOT EXISTS paid_manually     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
  ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
    CHECK (status IN ('pending','approved','processing','completed','needs_attention','rejected','failed','cancelled'));
  ALTER TABLE public.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_rail_check;
  ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_rail_check CHECK (rail IS NULL OR rail IN ('mpesa_b2c','manual'));
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawal_receipt ON public.withdrawal_requests(mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON public.withdrawal_requests(status, site_id);

CREATE TABLE IF NOT EXISTS public.payout_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- = our OriginatorConversationID
  withdrawal_id        uuid NOT NULL REFERENCES public.withdrawal_requests(id) ON DELETE CASCADE,
  site_id              uuid NOT NULL,
  integration_id       uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  payment_scope        text NOT NULL,
  amount               numeric NOT NULL,
  phone                text NOT NULL,
  status               text NOT NULL DEFAULT 'sending'
                       CHECK (status IN ('sending','accepted','rejected','unknown','timeout','succeeded','failed','abandoned')),   -- abandoned: staff confirmed unpaid (retry / refund / paid by hand)
  conversation_id      text,
  response_code        text,
  response_desc        text,
  result_code          text,
  result_desc          text,
  transaction_id       text,
  recipient_name       text,
  result_payload       jsonb,
  status_queries       int NOT NULL DEFAULT 0,
  escalated_at         timestamptz,                                 -- handed to staff; a late callback can still settle it
  last_status_query_at timestamptz,
  status_result        jsonb,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  resolved_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payout_attempts_w ON public.payout_attempts(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_payout_attempts_open ON public.payout_attempts(created_at) WHERE status IN ('sending','accepted','unknown','timeout') AND escalated_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_attempt_receipt ON public.payout_attempts(transaction_id) WHERE transaction_id IS NOT NULL AND status = 'succeeded';
ALTER TABLE public.payout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_attempts FROM anon, authenticated;

-- ── 5. secrets for the worker and the callback tokens (Vault; nothing in the environment) ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'payouts_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payouts_cron_secret', 'payouts-worker');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'payout_callback_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_callback_secret', 'HMAC key for Safaricom B2C callback URLs');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.svc_cron_secret_ok(p_name text, p_value text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault, extensions, pg_temp AS $$
DECLARE v text;
BEGIN
  IF p_name NOT IN ('domains_cron_secret','payouts_cron_secret') OR coalesce(p_value, '') = '' THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  RETURN v IS NOT NULL AND length(v) = length(p_value)
     AND extensions.digest(v, 'sha256') = extensions.digest(p_value, 'sha256');
END $$;

-- The callback token for a reference (an attempt id, or 'balance:<integration id>'):
-- HMAC-SHA256 with a Vault key, so nothing per-attempt needs storing and nobody can forge one.
CREATE OR REPLACE FUNCTION public.svc_payout_token(p_ref text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault, extensions, pg_temp AS $$
  SELECT encode(extensions.hmac(p_ref, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'payout_callback_secret' LIMIT 1), 'sha256'), 'hex');
$$;
CREATE OR REPLACE FUNCTION public._payout_token_ok(p_ref text, p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT coalesce(p_token, '') <> '' AND extensions.digest(public.svc_payout_token(p_ref), 'sha256') = extensions.digest(p_token, 'sha256');
$$;

-- ── 6. which rail pays a brand's withdrawals ────────────────────────────────────────────────
-- A complete, switched-on, successfully tested B2C account at EXACTLY this scope, or NULL.
CREATE OR REPLACE FUNCTION public._b2c_account(p_kind text, p_id uuid)
RETURNS integrations LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.* FROM integrations i
   WHERE i.provider = 'mpesa_b2c' AND i.scope_kind = p_kind AND i.scope_id IS NOT DISTINCT FROM p_id
     AND i.enabled AND i.test_ok IS TRUE
     AND i.secrets ? 'consumer_key' AND i.secrets ? 'consumer_secret' AND i.secrets ? 'security_credential'
     AND nullif(i.config->>'shortcode', '') IS NOT NULL AND nullif(i.config->>'initiator_name', '') IS NOT NULL;
$$;

-- Payouts follow the brand's payment owner (no mixing: a brand whose deposits go to its own
-- account is never paid out from the System's B2C). No ready account → staff pay by hand.
CREATE OR REPLACE FUNCTION public.fn_payout_rail(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o jsonb := public.fn_payment_owner(p_site); a integrations; v_auto boolean;
BEGIN
  a := public._b2c_account(o->>'kind', (o->>'id')::uuid);
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('rail', 'manual', 'scope', o->>'key', 'owner', o, 'integration_id', NULL, 'auto', false,
      'reason', 'No tested M-Pesa B2C account for ' || CASE o->>'kind' WHEN 'global' THEN 'the System' ELSE o->>'name' END);
  END IF;
  v_auto := coalesce(public._brand_bool(p_site, 'payments.auto_payout'), true);
  RETURN jsonb_build_object('rail', 'mpesa_b2c', 'scope', o->>'key', 'owner', o, 'integration_id', a.id,
    'auto', v_auto AND public.fn_platform_switch('payouts_enabled'),
    'reason', CASE WHEN NOT public.fn_platform_switch('payouts_enabled') THEN 'Automatic payouts are paused by the System'
                   WHEN NOT v_auto THEN 'Staff press Pay for each withdrawal' ELSE NULL END);
END $$;

-- Wake the payout worker now (only when something is due). pg_net sends after COMMIT.
CREATE OR REPLACE FUNCTION public._payout_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault AS $$
DECLARE v_url text; v_secret text; v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'payouts_cron_secret' LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN RETURN NULL; END IF;
  SELECT net.http_post(url := rtrim(v_url, '/') || '/functions/v1/payouts-worker', body := '{"action":"run"}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
                       timeout_milliseconds := 60000) INTO v_req;
  RETURN v_req;
END $$;

-- ── 7. money helpers ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._withdrawal_refund(p_id uuid, p_status text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests;
BEGIN
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF w.refunded_at IS NOT NULL THEN RETURN; END IF;                -- idempotent
  IF coalesce(w.held_cents, 0) > 0 THEN
    PERFORM public._wallet_move(w.user_id, w.held_cents, 'real', 'withdrawal_refund', 'withdrawal_requests', w.id::text);
  END IF;
  UPDATE withdrawal_requests SET status = p_status, refunded_at = now(), updated_at = now(),
         rejection_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), rejection_reason),
         completed_at = coalesce(completed_at, now()), release_requested = false
   WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public._withdrawal_complete(p_id uuid, p_receipt text, p_recipient text, p_manual boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests;
BEGIN
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF w.status = 'completed' THEN RETURN; END IF;
  UPDATE withdrawal_requests SET status = 'completed', mpesa_receipt = p_receipt, recipient_name = coalesce(p_recipient, recipient_name),
         paid_manually = p_manual, completed_at = now(), updated_at = now(), release_requested = false,
         attention_reason = CASE WHEN attention_reason LIKE 'ALERT:%' THEN attention_reason END   -- an alarm outlives the payout
   WHERE id = p_id;
  -- the money already left the wallet at request time: this is the history row, not a move
  INSERT INTO transactions(user_id, type, amount, payment_method, reference, description, status, site_id)
  VALUES (w.user_id, 'withdrawal', w.amount, 'mpesa', p_receipt,
          CASE WHEN p_manual THEN 'M-Pesa withdrawal (paid by staff)' ELSE 'M-Pesa withdrawal' END, 'completed', w.site_id);
  UPDATE profiles SET total_withdrawn = coalesce(total_withdrawn, 0) + w.amount WHERE id = w.user_id;
  INSERT INTO user_notifications(user_id, level, title, body, category, site_id)
  VALUES (w.user_id, 'success', 'Withdrawal paid', 'KES ' || to_char(w.amount, 'FM999,999,999') || ' was sent to your M-Pesa ' || w.phone_number ||
          CASE WHEN p_receipt IS NOT NULL THEN ' (M-Pesa ' || p_receipt || ').' ELSE '.' END, 'payment', w.site_id);
END $$;

CREATE OR REPLACE FUNCTION public._withdrawal_attention(p_id uuid, p_reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE withdrawal_requests SET status = 'needs_attention', attention_reason = left(p_reason, 400), updated_at = now(), release_requested = false
   WHERE id = p_id AND status IN ('approved','processing','needs_attention');
$$;

-- Result codes where the recipient cannot receive (money did not move; nothing to fix on our
-- side): the hold goes straight back to the player. Every other failure waits for staff.
CREATE OR REPLACE FUNCTION public._b2c_refund_code(p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_code IN ('2040', 'SFC_IC0003', '2032');
$$;

-- ── 8. the player's side ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_site uuid; v_min numeric; v_maxreq numeric; v_daily numeric; v_thr numeric; v_today numeric; v_budget numeric; v_auto_today numeric;
  v_real_cents bigint; v_cents bigint; v_id uuid; v_auto boolean; v_rail jsonb;
  v_risk jsonb; v_score int; v_flags jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.fn_platform_switch('withdrawals_enabled') THEN RAISE EXCEPTION 'WITHDRAWALS_DISABLED'; END IF;
  IF public.fn_is_marketer_account(v_uid) THEN RAISE EXCEPTION 'MARKETER_DEMO_NON_WITHDRAWABLE'; END IF;
  SELECT site_id INTO v_site FROM profiles WHERE id = v_uid;
  IF (SELECT is_banned FROM profiles WHERE id = v_uid) THEN RAISE EXCEPTION 'ACCOUNT_BANNED'; END IF;
  IF public._brand_bool(v_site, 'features.maintenance') THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
  IF NOT public._brand_bool(v_site, 'features.withdrawals') THEN RAISE EXCEPTION 'WITHDRAWALS_DISABLED'; END IF;
  v_min    := coalesce(public._brand_num(v_site, 'limits.min_withdrawal'), 100);
  v_maxreq := public._brand_num(v_site, 'limits.max_withdrawal');
  v_daily  := public._brand_num(v_site, 'limits.daily_withdrawal');
  v_thr    := coalesce(public._brand_num(v_site, 'limits.auto_approve'), 0);
  v_budget := public._brand_num(v_site, 'limits.auto_payout_daily');
  IF    length(v_phone) = 9                              THEN v_phone := '254' || v_phone;
  ELSIF length(v_phone) = 10 AND left(v_phone,1) = '0'   THEN v_phone := '254' || substr(v_phone,2);
  ELSIF length(v_phone) = 12 AND left(v_phone,3) = '254' THEN v_phone := v_phone;
  ELSE  RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF v_phone !~ '^254(7|1)[0-9]{8}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'AMOUNT_TOO_LOW: minimum is %', v_min; END IF;
  IF p_amount <> trunc(p_amount)          THEN RAISE EXCEPTION 'AMOUNT_NOT_INTEGER'; END IF;
  IF v_maxreq IS NOT NULL AND p_amount > v_maxreq THEN RAISE EXCEPTION 'AMOUNT_TOO_HIGH: maximum is %', v_maxreq; END IF;
  v_cents := round(p_amount * 100)::bigint;
  -- lock the wallet: the balance check and the hold are one atomic step
  SELECT real_balance INTO v_real_cents FROM wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_real_cents IS NULL           THEN RAISE EXCEPTION 'NO_WALLET'; END IF;
  IF v_real_cents < v_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE user_id = v_uid AND status IN ('pending','approved','processing','needs_attention')) THEN
    RAISE EXCEPTION 'WITHDRAWAL_PENDING';
  END IF;
  IF v_daily IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO v_today FROM withdrawal_requests
     WHERE user_id = v_uid AND status NOT IN ('rejected','failed','cancelled')
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi');
    IF v_today + p_amount > v_daily THEN RAISE EXCEPTION 'DAILY_LIMIT: % left today', greatest(v_daily - v_today, 0); END IF;
  END IF;
  v_risk  := assess_player_risk(v_uid);
  v_score := (v_risk->>'score')::int;
  v_flags := coalesce(v_risk->'flags', '[]'::jsonb);
  v_auto  := (p_amount <= v_thr) AND (v_score <= 30);
  IF v_auto AND v_budget IS NOT NULL THEN
    -- the brand's automatic budget for today (Nairobi day), serialised per brand
    PERFORM pg_advisory_xact_lock(hashtext('auto_payout_budget:' || v_site::text));
    SELECT coalesce(sum(amount), 0) INTO v_auto_today FROM withdrawal_requests
     WHERE site_id = v_site AND auto_approved AND approved_at IS NOT NULL AND status NOT IN ('rejected','cancelled')
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi');
    IF v_auto_today + p_amount > v_budget THEN v_auto := false; v_flags := v_flags || to_jsonb('auto_budget_reached'::text); END IF;
  END IF;
  v_rail := public.fn_payout_rail(v_site);
  INSERT INTO withdrawal_requests(user_id, amount, phone_number, status, auto_approved, risk_score, risk_flags, held_cents,
                                  approved_at, rail, site_id)
  VALUES (v_uid, p_amount, v_phone, CASE WHEN v_auto THEN 'approved' ELSE 'pending' END, v_auto, v_score, v_flags, v_cents,
          CASE WHEN v_auto THEN now() END, CASE WHEN v_auto THEN v_rail->>'rail' END, v_site)
  RETURNING id INTO v_id;
  PERFORM public._wallet_move(v_uid, -v_cents, 'real', 'withdrawal_hold', 'withdrawal_requests', v_id::text);
  IF v_auto AND (v_rail->>'auto')::boolean THEN PERFORM public._payout_kick(); END IF;
  RETURN jsonb_build_object('withdrawal_request_id', v_id, 'status', CASE WHEN v_auto THEN 'approved' ELSE 'pending' END,
    'auto_approved', v_auto, 'automatic_payout', v_auto AND (v_rail->>'auto')::boolean,
    'phone', v_phone, 'amount', p_amount, 'risk_score', v_score, 'risk_level', v_risk->>'level');
END $function$;

-- A player may cancel a request that has not been sent yet; the hold comes back at once.
CREATE OR REPLACE FUNCTION public.cancel_my_withdrawal(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF w.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'CANNOT_CANCEL: %', w.status; END IF;
  PERFORM public._withdrawal_refund(p_id, 'cancelled', 'Cancelled by the player');
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'cancelled');
END $$;

CREATE OR REPLACE FUNCTION public.my_withdrawals(p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'phone', phone_number, 'status', status,
           'receipt', mpesa_receipt, 'created_at', created_at, 'completed_at', completed_at,
           'reason', CASE WHEN status IN ('rejected','failed') THEN rejection_reason END,
           'can_cancel', status IN ('pending','approved')) ORDER BY created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM withdrawal_requests WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT greatest(1, least(p_limit, 100))) w;
$$;

-- ── 9. staff actions ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._withdrawal_for_staff(p_id uuid)
RETURNS withdrawal_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests;
BEGIN
  IF NOT public._is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public._can_admin_site(w.site_id) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  RETURN w;
END $$;

CREATE OR REPLACE FUNCTION public._withdrawal_audit(p_action text, w withdrawal_requests, p_details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), p_action, 'withdrawal', w.id::text,
          jsonb_build_object('amount', w.amount, 'phone', w.phone_number, 'user_id', w.user_id) || coalesce(p_details, '{}'::jsonb), w.site_id);
$$;

-- Is the last attempt's outcome unknown (it may have been paid)? Retry/refund then need confirmation.
CREATE OR REPLACE FUNCTION public._withdrawal_outcome_unknown(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT status IN ('sending','accepted','unknown','timeout') FROM payout_attempts
                    WHERE withdrawal_id = p_id ORDER BY created_at DESC LIMIT 1), false);
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(p_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id); v_rail jsonb;
BEGIN
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'NOT_PENDING: %', w.status; END IF;
  v_rail := public.fn_payout_rail(w.site_id);
  UPDATE withdrawal_requests SET status = 'approved', approved_at = now(), reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), ''), rail = v_rail->>'rail', updated_at = now()
   WHERE id = p_id;
  PERFORM public._withdrawal_audit('withdrawal_approved', w, jsonb_build_object('note', p_note, 'rail', v_rail->>'rail'));
  IF (v_rail->>'auto')::boolean THEN PERFORM public._payout_kick(); END IF;
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'approved', 'rail', v_rail->>'rail',
    'automatic_payout', (v_rail->>'auto')::boolean, 'amount', w.amount, 'phone_number', w.phone_number, 'user_id', w.user_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id);
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF w.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'NOT_PENDING: %', w.status; END IF;
  UPDATE withdrawal_requests SET reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_id;
  PERFORM public._withdrawal_refund(p_id, 'rejected', p_reason);
  PERFORM public._withdrawal_audit('withdrawal_rejected', w, jsonb_build_object('reason', trim(p_reason)));
  INSERT INTO user_notifications(user_id, level, title, body, category, site_id)
  VALUES (w.user_id, 'warning', 'Withdrawal declined', 'Your withdrawal of KES ' || to_char(w.amount, 'FM999,999,999') ||
          ' was declined and the money is back in your wallet. Reason: ' || left(trim(p_reason), 300), 'payment', w.site_id);
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'rejected');
END $$;

-- Automatic payout switched off for the brand: staff release one approved withdrawal.
CREATE OR REPLACE FUNCTION public.admin_withdrawal_pay_now(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id); v_rail jsonb;
BEGIN
  IF w.status <> 'approved' THEN RAISE EXCEPTION 'NOT_APPROVED: %', w.status; END IF;
  IF NOT public.fn_platform_switch('payouts_enabled') THEN RAISE EXCEPTION 'PAYOUTS_PAUSED'; END IF;
  v_rail := public.fn_payout_rail(w.site_id);
  IF v_rail->>'rail' <> 'mpesa_b2c' THEN RAISE EXCEPTION 'NO_PAYOUT_ACCOUNT: %', v_rail->>'reason'; END IF;
  UPDATE withdrawal_requests SET release_requested = true, rail = 'mpesa_b2c', updated_at = now() WHERE id = p_id;
  PERFORM public._withdrawal_audit('withdrawal_pay_now', w, NULL);
  PERFORM public._payout_kick();
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'approved', 'queued', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_withdrawal_retry(p_id uuid, p_confirm_unpaid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id); v_rail jsonb;
BEGIN
  IF w.status <> 'needs_attention' THEN RAISE EXCEPTION 'NOT_IN_ATTENTION: %', w.status; END IF;
  IF public._withdrawal_outcome_unknown(p_id) AND NOT p_confirm_unpaid THEN
    RAISE EXCEPTION 'OUTCOME_UNKNOWN: Safaricom never confirmed the last attempt. Check the M-Pesa statement first, then confirm it was not paid';
  END IF;
  IF NOT public.fn_platform_switch('payouts_enabled') THEN RAISE EXCEPTION 'PAYOUTS_PAUSED'; END IF;
  v_rail := public.fn_payout_rail(w.site_id);
  IF v_rail->>'rail' <> 'mpesa_b2c' THEN RAISE EXCEPTION 'NO_PAYOUT_ACCOUNT: %', v_rail->>'reason'; END IF;
  -- close the unknown attempt as failed (staff confirmed it did not pay)
  UPDATE payout_attempts SET status = 'abandoned', resolved_at = now(),
         result_desc = coalesce(result_desc, 'Closed by staff: confirmed not paid')
   WHERE withdrawal_id = p_id AND status IN ('sending','accepted','unknown','timeout');
  UPDATE withdrawal_requests SET status = 'approved', release_requested = true, rail = 'mpesa_b2c', attention_reason = NULL, updated_at = now() WHERE id = p_id;
  PERFORM public._withdrawal_audit('withdrawal_retry', w, jsonb_build_object('confirmed_unpaid', p_confirm_unpaid));
  PERFORM public._payout_kick();
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'approved', 'queued', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_withdrawal_mark_paid(p_id uuid, p_receipt text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id); v_r text := upper(trim(coalesce(p_receipt, '')));
BEGIN
  IF w.status NOT IN ('approved','needs_attention') THEN RAISE EXCEPTION 'CANNOT_MARK_PAID: %', w.status; END IF;
  IF v_r !~ '^[A-Z0-9]{8,12}$' THEN RAISE EXCEPTION 'INVALID_RECEIPT: Enter the M-Pesa receipt code, e.g. SIK2AB3CD4'; END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE mpesa_receipt = v_r AND id <> p_id) THEN RAISE EXCEPTION 'RECEIPT_USED: That receipt is already on another withdrawal'; END IF;
  UPDATE payout_attempts SET status = 'abandoned', resolved_at = now(), result_desc = coalesce(result_desc, 'Closed by staff: paid by hand')
   WHERE withdrawal_id = p_id AND status IN ('sending','accepted','unknown','timeout');
  PERFORM public._withdrawal_complete(p_id, v_r, NULL, true);
  UPDATE withdrawal_requests SET reviewed_by = coalesce(reviewed_by, auth.uid()), review_note = coalesce(nullif(trim(coalesce(p_note,'')), ''), review_note) WHERE id = p_id;
  PERFORM public._withdrawal_audit('withdrawal_marked_paid', w, jsonb_build_object('receipt', v_r, 'note', p_note));
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'completed', 'receipt', v_r);
END $$;

CREATE OR REPLACE FUNCTION public.admin_withdrawal_refund(p_id uuid, p_reason text, p_confirm_unpaid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests := public._withdrawal_for_staff(p_id);
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF w.status NOT IN ('approved','needs_attention') THEN RAISE EXCEPTION 'CANNOT_REFUND: %', w.status; END IF;
  IF public._withdrawal_outcome_unknown(p_id) AND NOT p_confirm_unpaid THEN
    RAISE EXCEPTION 'OUTCOME_UNKNOWN: Safaricom never confirmed the last attempt. Check the M-Pesa statement first, then confirm it was not paid';
  END IF;
  UPDATE payout_attempts SET status = 'abandoned', resolved_at = now(), result_desc = coalesce(result_desc, 'Closed by staff: refunded')
   WHERE withdrawal_id = p_id AND status IN ('sending','accepted','unknown','timeout');
  PERFORM public._withdrawal_refund(p_id, 'failed', p_reason);
  PERFORM public._withdrawal_audit('withdrawal_refunded', w, jsonb_build_object('reason', trim(p_reason), 'confirmed_unpaid', p_confirm_unpaid));
  INSERT INTO user_notifications(user_id, level, title, body, category, site_id)
  VALUES (w.user_id, 'warning', 'Withdrawal not paid', 'Your withdrawal of KES ' || to_char(w.amount, 'FM999,999,999') ||
          ' could not be paid, so the money is back in your wallet. ' || left(trim(p_reason), 300), 'payment', w.site_id);
  RETURN jsonb_build_object('withdrawal_request_id', p_id, 'status', 'failed');
END $$;

-- Queue view for the Withdrawals page (brand-scoped like every staff read).
DROP FUNCTION IF EXISTS public.admin_list_withdrawals(text, integer, integer);
CREATE FUNCTION public.admin_list_withdrawals(p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, user_id uuid, username text, phone_number text, amount numeric, status text, auto_approved boolean,
  risk_score integer, risk_flags jsonb, rejection_reason text, review_note text, reviewed_by uuid, reviewer_username text,
  reviewed_at timestamptz, created_at timestamptz, completed_at timestamptz, mpesa_receipt text, wallet_balance numeric,
  total_deposited numeric, total_withdrawn numeric, total_wagered numeric, total_won numeric,
  site_id uuid, site_name text, rail text, approved_at timestamptz, attempts integer, attention_reason text,
  recipient_name text, paid_manually boolean, release_requested boolean, outcome_unknown boolean, last_attempt jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT _is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT w.id, w.user_id, p.username, w.phone_number, w.amount, w.status, w.auto_approved, w.risk_score, w.risk_flags,
         w.rejection_reason, w.review_note, w.reviewed_by, r.username, w.reviewed_at, w.created_at, w.completed_at, w.mpesa_receipt,
         wal.balance, p.total_deposited, p.total_withdrawn, p.total_wagered, p.total_won,
         w.site_id, s.name, w.rail, w.approved_at, w.attempts, w.attention_reason, w.recipient_name, w.paid_manually, w.release_requested,
         public._withdrawal_outcome_unknown(w.id),
         (SELECT jsonb_build_object('id', a.id, 'status', a.status, 'result_code', a.result_code, 'result_desc', a.result_desc,
                   'response_desc', a.response_desc, 'created_at', a.created_at, 'transaction_id', a.transaction_id)
            FROM payout_attempts a WHERE a.withdrawal_id = w.id ORDER BY a.created_at DESC LIMIT 1)
    FROM withdrawal_requests w
    JOIN profiles p ON p.id = w.user_id
    LEFT JOIN sites s ON s.id = w.site_id
    LEFT JOIN wallets wal ON wal.user_id = w.user_id
    LEFT JOIN profiles r ON r.id = w.reviewed_by
   WHERE (_is_platform_superadmin() OR w.site_id = current_site())
     AND (p_status IS NULL OR w.status = p_status
          OR (p_status = 'open' AND w.status IN ('pending','approved','processing','needs_attention'))
          OR (p_status = 'closed' AND w.status IN ('rejected','failed','cancelled')))
   ORDER BY (w.status = 'needs_attention') DESC, (w.status = 'pending') DESC,
            CASE WHEN w.status IN ('pending','needs_attention') THEN w.created_at END ASC, w.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limit, 50), 200)) OFFSET greatest(0, coalesce(p_offset, 0));
END $$;

CREATE OR REPLACE FUNCTION public.admin_withdrawal_detail(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests;
BEGIN
  IF NOT public._is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public._can_admin_site(w.site_id) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
  RETURN to_jsonb(w) - 'held_cents' || jsonb_build_object(
    'rail_now', public.fn_payout_rail(w.site_id) - 'owner',
    'outcome_unknown', public._withdrawal_outcome_unknown(p_id),
    'attempts_list', coalesce((SELECT jsonb_agg(to_jsonb(a) - 'result_payload' - 'status_result' - 'created_by' ORDER BY a.created_at DESC)
                                 FROM payout_attempts a WHERE a.withdrawal_id = p_id), '[]'::jsonb),
    'audit', coalesce((SELECT jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'by', pr.username, 'details', l.details) ORDER BY l.created_at)
                         FROM admin_audit_log l LEFT JOIN profiles pr ON pr.id = l.admin_id
                        WHERE l.target_type = 'withdrawal' AND l.target_id = p_id::text), '[]'::jsonb));
END $$;

-- How a brand (or, for the owner with no brand picked, the System) pays out right now.
CREATE OR REPLACE FUNCTION public.admin_payout_status(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_site uuid := coalesce(p_site, '00000000-0000-0000-0000-000000000001'::uuid);
BEGIN
  IF NOT public._is_admin() OR NOT public._can_admin_site(v_site) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN public.fn_payout_rail(v_site) || jsonb_build_object(
    'payouts_enabled', public.fn_platform_switch('payouts_enabled'),
    'brand_auto_payout', coalesce(public._brand_bool(v_site, 'payments.auto_payout'), true),
    'auto_approve_below', public._brand_num(v_site, 'limits.auto_approve'),
    'auto_daily_budget', public._brand_num(v_site, 'limits.auto_payout_daily'),
    'account', (SELECT jsonb_build_object('id', i.id, 'shortcode', i.config->>'shortcode', 'env', i.config->>'env',
                  'test_ok', i.test_ok, 'test_message', i.test_message, 'tested_at', i.tested_at)
                  FROM integrations i WHERE i.id = (public.fn_payout_rail(v_site)->>'integration_id')::uuid),
    'counts', (SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'approved', count(*) FILTER (WHERE status = 'approved'),
        'processing', count(*) FILTER (WHERE status = 'processing'),
        'needs_attention', count(*) FILTER (WHERE status = 'needs_attention'),
        'paid_today', count(*) FILTER (WHERE status = 'completed' AND completed_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')),
        'paid_today_kes', coalesce(sum(amount) FILTER (WHERE status = 'completed' AND completed_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')), 0),
        'held_kes', coalesce(sum(amount) FILTER (WHERE status IN ('pending','approved','processing','needs_attention')), 0),
        'alerts', count(*) FILTER (WHERE attention_reason LIKE 'ALERT:%'))
      FROM withdrawal_requests WHERE (p_site IS NULL AND public._is_platform_superadmin()) OR site_id = v_site));
END $$;

-- ── 10. the worker's side (service role only) ──────────────────────────────────────────────
-- Claim approved withdrawals for automatic payout: one attempt row per send, written before the
-- request leaves (write-ahead). SKIP LOCKED: two workers never claim the same withdrawal.
CREATE OR REPLACE FUNCTION public.svc_payout_claim(p_limit int DEFAULT 10)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w withdrawal_requests; v_rail jsonb; v_att uuid;
BEGIN
  IF NOT public.fn_platform_switch('payouts_enabled') THEN RETURN; END IF;
  FOR w IN SELECT * FROM withdrawal_requests
            WHERE status = 'approved' AND coalesce(rail, 'mpesa_b2c') = 'mpesa_b2c'
              AND (release_requested OR coalesce((public.fn_payout_rail(site_id)->>'auto')::boolean, false))
            ORDER BY approved_at NULLS LAST, created_at
            LIMIT greatest(1, least(p_limit, 50)) FOR UPDATE SKIP LOCKED LOOP
    v_rail := public.fn_payout_rail(w.site_id);
    -- the account is not usable right now (being edited / re-tested / removed): leave it approved;
    -- it goes out once the account is ready again, or staff pay it by hand meanwhile
    IF v_rail->>'rail' <> 'mpesa_b2c' THEN CONTINUE; END IF;
    IF NOT (v_rail->>'auto')::boolean AND NOT w.release_requested THEN
      UPDATE withdrawal_requests SET rail = 'mpesa_b2c' WHERE id = w.id AND rail IS NULL;  -- waits for Pay
      CONTINUE;
    END IF;
    INSERT INTO payout_attempts(withdrawal_id, site_id, integration_id, payment_scope, amount, phone)
    VALUES (w.id, w.site_id, (v_rail->>'integration_id')::uuid, v_rail->>'scope', w.amount, w.phone_number)
    RETURNING id INTO v_att;
    UPDATE withdrawal_requests SET status = 'processing', rail = 'mpesa_b2c', payment_scope = v_rail->>'scope',
           integration_id = (v_rail->>'integration_id')::uuid, attempts = attempts + 1, release_requested = false, updated_at = now()
     WHERE id = w.id;
    RETURN NEXT jsonb_build_object('attempt_id', v_att, 'token', public.svc_payout_token(v_att::text), 'withdrawal_id', w.id,
      'amount', w.amount, 'phone', w.phone_number, 'integration_id', v_rail->>'integration_id', 'site_id', w.site_id);
  END LOOP;
END $$;

-- The synchronous answer to the B2C request.
CREATE OR REPLACE FUNCTION public.svc_payout_sent(p_attempt uuid, p_accepted boolean, p_conversation_id text, p_code text, p_desc text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a payout_attempts;
BEGIN
  SELECT * INTO a FROM payout_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND OR a.status <> 'sending' THEN RETURN jsonb_build_object('result', 'ignored'); END IF;
  IF p_accepted THEN
    UPDATE payout_attempts SET status = 'accepted', conversation_id = p_conversation_id, response_code = p_code,
           response_desc = left(p_desc, 300), sent_at = now() WHERE id = p_attempt;
    RETURN jsonb_build_object('result', 'accepted');
  END IF;
  -- Safaricom refused the request outright: nothing was paid. Staff fix the cause and retry.
  UPDATE payout_attempts SET status = 'rejected', response_code = p_code, response_desc = left(p_desc, 300), sent_at = now(), resolved_at = now()
   WHERE id = p_attempt;
  PERFORM public._withdrawal_attention(a.withdrawal_id, 'Safaricom refused the payout request: ' || coalesce(p_desc, p_code, 'no reason'));
  RETURN jsonb_build_object('result', 'rejected');
END $$;

-- We could not tell whether the request reached Safaricom (network error / timeout). Never
-- resent automatically: the status query settles it.
CREATE OR REPLACE FUNCTION public.svc_payout_unknown(p_attempt uuid, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE payout_attempts SET status = 'unknown', response_desc = left(p_error, 300), sent_at = coalesce(sent_at, now())
   WHERE id = p_attempt AND status = 'sending';
$$;

-- Safaricom's callbacks: 'result' (B2C result), 'timeout' (queue timeout), 'status' (Transaction
-- Status result). The edge function parses the JSON; this decides. Token = HMAC(attempt id).
CREATE OR REPLACE FUNCTION public.svc_payout_callback(p_attempt uuid, p_token text, p_kind text, p_r jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a payout_attempts; w withdrawal_requests; v_code text := p_r->>'result_code'; v_desc text := left(p_r->>'result_desc', 300);
        v_receipt text := nullif(upper(trim(coalesce(p_r->>'transaction_id', ''))), ''); v_amt numeric := (p_r->>'amount')::numeric;
        v_status text := p_r->>'transaction_status';
BEGIN
  IF NOT public._payout_token_ok(p_attempt::text, p_token) THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
  SELECT * INTO a FROM payout_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'unknown_attempt'); END IF;
  -- the ids in the body must be this attempt's
  IF p_r ? 'originator_id' AND nullif(p_r->>'originator_id', '') IS NOT NULL AND p_r->>'originator_id' <> a.id::text THEN
    RETURN jsonb_build_object('result', 'mismatch');
  END IF;
  IF a.conversation_id IS NOT NULL AND nullif(p_r->>'conversation_id', '') IS NOT NULL AND p_r->>'conversation_id' <> a.conversation_id
     AND p_kind = 'result' THEN
    RETURN jsonb_build_object('result', 'mismatch');
  END IF;
  SELECT * INTO w FROM withdrawal_requests WHERE id = a.withdrawal_id FOR UPDATE;

  IF p_kind = 'timeout' THEN
    IF a.status IN ('sending','accepted','unknown') THEN
      UPDATE payout_attempts SET status = 'timeout', result_desc = 'Safaricom queue timeout', result_payload = p_r->'raw' WHERE id = a.id;
    END IF;
    RETURN jsonb_build_object('result', 'timeout');
  END IF;

  IF p_kind = 'status' THEN
    UPDATE payout_attempts SET status_result = p_r - 'raw', last_status_query_at = now() WHERE id = a.id;
    IF a.status IN ('succeeded','failed','rejected') THEN RETURN jsonb_build_object('result', 'already_' || a.status); END IF;
    IF a.status = 'abandoned' AND NOT (v_code = '0' AND lower(coalesce(v_status, '')) = 'completed') THEN
      RETURN jsonb_build_object('result', 'already_abandoned');
    END IF;
    IF v_code = '0' AND lower(coalesce(v_status, '')) = 'completed' THEN
      v_code := '0';                                            -- fall through to the success path below
    ELSIF v_code = '0' AND lower(coalesce(v_status, '')) IN ('failed','declined','cancelled','expired','reversed') THEN
      UPDATE payout_attempts SET status = 'failed', result_code = 'STATUS', result_desc = 'Safaricom reports: ' || v_status, resolved_at = now() WHERE id = a.id;
      PERFORM public._withdrawal_attention(w.id, 'Safaricom reports the payout ' || lower(v_status) || '. Safe to retry or refund.');
      RETURN jsonb_build_object('result', 'failed');
    ELSE
      RETURN jsonb_build_object('result', 'unresolved');         -- the sweep asks again, then hands it to staff
    END IF;
  ELSIF p_kind <> 'result' THEN
    RETURN jsonb_build_object('result', 'bad_kind');
  END IF;

  IF a.status IN ('succeeded','failed','rejected') THEN RETURN jsonb_build_object('result', 'already_' || a.status); END IF;
  -- staff closed this attempt as unpaid; only a SUCCESS still matters (it means money left)
  IF a.status = 'abandoned' AND v_code <> '0' THEN
    UPDATE payout_attempts SET result_code = v_code, result_desc = coalesce(v_desc, result_desc), result_payload = coalesce(p_r->'raw', result_payload) WHERE id = a.id;
    RETURN jsonb_build_object('result', 'already_abandoned');
  END IF;

  IF v_code = '0' THEN
    UPDATE payout_attempts SET status = 'succeeded', result_code = '0', result_desc = coalesce(v_desc, 'Completed'),
           transaction_id = v_receipt, recipient_name = left(p_r->>'recipient_name', 120),
           result_payload = coalesce(p_r->'raw', result_payload), resolved_at = now() WHERE id = a.id;
    IF v_amt IS NOT NULL AND v_amt <> a.amount THEN
      PERFORM public._withdrawal_attention(w.id, 'Safaricom paid KES ' || v_amt || ' instead of KES ' || a.amount || ' (receipt ' || coalesce(v_receipt, '?') || ').');
      RETURN jsonb_build_object('result', 'amount_mismatch');
    END IF;
    IF (a.status <> 'abandoned' AND w.status IN ('processing','needs_attention','approved'))
       OR (a.status = 'abandoned' AND w.status IN ('needs_attention','approved')) THEN
      UPDATE withdrawal_requests SET recipient_name = left(p_r->>'recipient_name', 120) WHERE id = w.id;
      PERFORM public._withdrawal_complete(w.id, v_receipt, left(p_r->>'recipient_name', 120), false);
      RETURN jsonb_build_object('result', 'paid');
    END IF;
    -- paid although staff had closed it (refunded, paid by hand, or re-sent): flag loudly for recovery
    INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (public._root_super_admin(), 'withdrawal_paid_after_close', 'withdrawal', w.id::text,   -- system event, filed under the owner
            jsonb_build_object('status', w.status, 'receipt', v_receipt, 'amount', a.amount, 'attempt', a.id), w.site_id);
    UPDATE withdrawal_requests SET attention_reason = left('ALERT: Safaricom paid attempt ' || a.id || ' (receipt ' || coalesce(v_receipt, '?') ||
           ') after it was closed as unpaid. Recover KES ' || a.amount || ' from the player.', 400), updated_at = now() WHERE id = w.id;
    RETURN jsonb_build_object('result', 'paid_after_close');
  END IF;

  -- a definitive failure: nothing was paid
  UPDATE payout_attempts SET status = 'failed', result_code = v_code, result_desc = v_desc,
         result_payload = coalesce(p_r->'raw', result_payload), resolved_at = now() WHERE id = a.id;
  IF w.status NOT IN ('processing','needs_attention') THEN RETURN jsonb_build_object('result', 'failed_ignored'); END IF;
  IF public._b2c_refund_code(v_code) THEN
    PERFORM public._withdrawal_refund(w.id, 'failed', 'M-Pesa could not pay this number: ' || coalesce(v_desc, v_code));
    INSERT INTO user_notifications(user_id, level, title, body, category, site_id)
    VALUES (w.user_id, 'warning', 'Withdrawal not paid', 'M-Pesa could not pay ' || w.phone_number ||
            '. The KES ' || to_char(w.amount, 'FM999,999,999') || ' is back in your wallet. Check the number and try again.', 'payment', w.site_id);
    RETURN jsonb_build_object('result', 'refunded');
  END IF;
  PERFORM public._withdrawal_attention(w.id, 'Payout failed (' || coalesce(v_code, '?') || '): ' || coalesce(v_desc, 'no reason') || '. The money is still held.');
  RETURN jsonb_build_object('result', 'attention');
END $$;

-- Attempts still waiting for Safaricom: ask for their status (after 3 min, every 5 min), and after
-- 60 min or 6 questions hand them to staff with the money still held.
CREATE OR REPLACE FUNCTION public.svc_payouts_unresolved(p_limit int DEFAULT 20)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a payout_attempts;
BEGIN
  FOR a IN SELECT * FROM payout_attempts
            WHERE status IN ('accepted','unknown','timeout','sending') AND escalated_at IS NULL AND created_at < now() - interval '3 minutes'
            ORDER BY created_at LIMIT greatest(1, least(p_limit, 100)) FOR UPDATE SKIP LOCKED LOOP
    IF a.created_at < now() - interval '60 minutes' OR a.status_queries >= 6 THEN
      UPDATE payout_attempts SET escalated_at = now() WHERE id = a.id;
      PERFORM public._withdrawal_attention(a.withdrawal_id,
        'No answer from Safaricom after ' || a.status_queries || ' status checks. The money is still held: check the M-Pesa statement, then mark paid or retry.');
      CONTINUE;
    END IF;
    IF a.last_status_query_at IS NOT NULL AND a.last_status_query_at > now() - interval '5 minutes' THEN CONTINUE; END IF;
    UPDATE payout_attempts SET status_queries = status_queries + 1, last_status_query_at = now() WHERE id = a.id;
    RETURN NEXT jsonb_build_object('attempt_id', a.id, 'token', public.svc_payout_token(a.id::text), 'integration_id', a.integration_id,
      'transaction_id', a.transaction_id, 'conversation_id', a.conversation_id);
  END LOOP;
END $$;

-- "Test connection" for a B2C account: the balance result arrives on a callback.
CREATE OR REPLACE FUNCTION public.svc_b2c_balance_result(p_integration uuid, p_token text, p_ok boolean, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._payout_token_ok('balance:' || p_integration, p_token) THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
  UPDATE integrations SET test_ok = p_ok, test_message = left(p_message, 300), tested_at = now() WHERE id = p_integration AND provider = 'mpesa_b2c';
  RETURN jsonb_build_object('result', CASE WHEN FOUND THEN 'recorded' ELSE 'unknown' END);
END $$;

-- The minute tick: wake the worker only when something is due.
CREATE OR REPLACE FUNCTION public.payouts_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM withdrawal_requests WHERE status = 'approved' AND coalesce(rail, 'mpesa_b2c') = 'mpesa_b2c'
              AND (release_requested OR coalesce((public.fn_payout_rail(site_id)->>'auto')::boolean, false)))
     OR EXISTS (SELECT 1 FROM payout_attempts WHERE status IN ('accepted','unknown','timeout','sending') AND escalated_at IS NULL
                  AND created_at < now() - interval '3 minutes') THEN
    RETURN public._payout_kick();
  END IF;
  RETURN 0;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mpesa_payouts') THEN PERFORM cron.unschedule('mpesa_payouts'); END IF;
  PERFORM cron.schedule('mpesa_payouts', '* * * * *', 'SELECT public.payouts_tick();');
END $$;

-- ── 11. players see how they will be paid ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_public_payment_config(p_site uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_site uuid; e jsonb; v_rail jsonb;
BEGIN
  v_site := coalesce((SELECT site_id FROM profiles WHERE id = auth.uid()),
                     (SELECT id FROM sites WHERE id = p_site),
                     '00000000-0000-0000-0000-000000000001'::uuid);
  e := public.fn_brand_effective(v_site, true);
  v_rail := public.fn_payout_rail(v_site);
  RETURN jsonb_build_object(
    'site_id', v_site,
    'deposit_provider', coalesce((SELECT value #>> '{}' FROM system_settings WHERE key = 'payments.deposit_provider'), 'megapay'),
    'min_deposit', (e->>'limits.min_deposit')::numeric, 'max_deposit', (e->>'limits.max_deposit')::numeric,
    'deposit_chips', e->'limits.deposit_chips',
    'min_withdrawal', (e->>'limits.min_withdrawal')::numeric,
    'max_withdrawal', (e->>'limits.max_withdrawal')::numeric, 'daily_withdrawal', (e->>'limits.daily_withdrawal')::numeric,
    'min_bet', (e->>'limits.min_bet')::numeric, 'max_bet', (e->>'limits.max_bet')::numeric,
    'max_payout', (e->>'limits.max_payout')::numeric, 'default_bet', (e->>'limits.default_bet')::numeric,
    'bet_chips', e->'limits.bet_chips',
    'deposits', (e->>'features.deposits')::boolean AND NOT (e->>'features.maintenance')::boolean AND public._payment_gateway_ready(v_site),
    'withdrawals', (e->>'features.withdrawals')::boolean AND NOT (e->>'features.maintenance')::boolean,
    'payouts_automatic', (v_rail->>'auto')::boolean,
    'offer', CASE WHEN (e->>'bonus.welcome_enabled')::boolean OR (e->>'bonus.deposit_enabled')::boolean THEN jsonb_build_object(
        'welcome', CASE WHEN (e->>'bonus.welcome_enabled')::boolean THEN (e->>'bonus.welcome_amount')::numeric ELSE 0 END,
        'match_pct', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_pct')::numeric ELSE 0 END,
        'match_cap', CASE WHEN (e->>'bonus.deposit_enabled')::boolean THEN (e->>'bonus.deposit_cap')::numeric ELSE 0 END,
        'wager_x', greatest((e->>'bonus.welcome_wager_x')::numeric, (e->>'bonus.deposit_wager_x')::numeric)) END);
END $$;

-- ── 12. grants ──────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.svc_payout_token(text), public._payout_token_ok(text, text), public._b2c_account(text, uuid),
  public.fn_payout_rail(uuid), public._payout_kick(), public._withdrawal_refund(uuid, text, text), public._withdrawal_complete(uuid, text, text, boolean),
  public._withdrawal_attention(uuid, text), public._withdrawal_for_staff(uuid), public._withdrawal_audit(text, withdrawal_requests, jsonb),
  public._withdrawal_outcome_unknown(uuid), public.svc_payout_claim(int), public.svc_payout_sent(uuid, boolean, text, text, text),
  public.svc_payout_unknown(uuid, text), public.svc_payout_callback(uuid, text, text, jsonb), public.svc_payouts_unresolved(int),
  public.svc_b2c_balance_result(uuid, text, boolean, text), public.payouts_tick()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.svc_payout_token(text), public.fn_payout_rail(uuid), public.svc_payout_claim(int),
  public.svc_payout_sent(uuid, boolean, text, text, text), public.svc_payout_unknown(uuid, text), public.svc_payout_callback(uuid, text, text, jsonb),
  public.svc_payouts_unresolved(int), public.svc_b2c_balance_result(uuid, text, boolean, text), public.payouts_tick() TO service_role;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text), public.cancel_my_withdrawal(uuid), public.my_withdrawals(int),
  public.admin_approve_withdrawal(uuid, text), public.admin_reject_withdrawal(uuid, text), public.admin_withdrawal_pay_now(uuid),
  public.admin_withdrawal_retry(uuid, boolean), public.admin_withdrawal_mark_paid(uuid, text, text), public.admin_withdrawal_refund(uuid, text, boolean),
  public.admin_list_withdrawals(text, integer, integer), public.admin_withdrawal_detail(uuid), public.admin_payout_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text), public.cancel_my_withdrawal(uuid), public.my_withdrawals(int),
  public.admin_approve_withdrawal(uuid, text), public.admin_reject_withdrawal(uuid, text), public.admin_withdrawal_pay_now(uuid),
  public.admin_withdrawal_retry(uuid, boolean), public.admin_withdrawal_mark_paid(uuid, text, text), public.admin_withdrawal_refund(uuid, text, boolean),
  public.admin_list_withdrawals(text, integer, integer), public.admin_withdrawal_detail(uuid), public.admin_payout_status(uuid) TO authenticated;
