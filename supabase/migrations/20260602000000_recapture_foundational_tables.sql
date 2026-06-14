-- ============================================================================
-- RECAPTURE: foundational tables created out-of-band (repo<->DB drift fix)
-- ============================================================================
-- These six tables exist in the live database but were never created by any
-- repo migration (they were applied directly to the project). Later migrations
-- (e.g. 20260611_phase1_schema) ALTER/INSERT into them and assume they already
-- exist, so a from-scratch rebuild from this repo alone would fail.
--
-- This migration recaptures their exact live DDL (columns, constraints,
-- indexes, RLS, policies) using IF NOT EXISTS / guarded CREATE POLICY so it is:
--   * a no-op on the current live database (objects already exist), and
--   * the authoritative creator on a fresh rebuild.
--
-- It is intentionally timestamped before 20260611_phase1_schema so crash_queue
-- and withdrawal_requests exist before that migration adds columns/FKs to them
-- (notably game_rounds.queue_id -> crash_queue(id)).
--
-- Table grants are intentionally omitted: every table carries Supabase's
-- standard default privileges (verified identical across all six), which a
-- fresh project applies automatically; RLS is the real access gate.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- system_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  category text DEFAULT 'general'::text NOT NULL,
  description text,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT system_settings_pkey PRIMARY KEY (key),
  CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id)
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.system_settings FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
END $p$;

-- ---------------------------------------------------------------------------
-- admin_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON public.admin_audit_log USING btree (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.admin_audit_log USING btree (created_at DESC);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_audit_log' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.admin_audit_log FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
END $p$;

-- ---------------------------------------------------------------------------
-- mpesa_config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  environment text DEFAULT 'sandbox'::text NOT NULL,
  consumer_key text DEFAULT ''::text NOT NULL,
  consumer_secret text DEFAULT ''::text NOT NULL,
  passkey text DEFAULT ''::text NOT NULL,
  shortcode text DEFAULT '174379'::text NOT NULL,
  b2c_shortcode text DEFAULT '174379'::text,
  initiator_name text DEFAULT 'testapi'::text,
  security_credential text DEFAULT ''::text,
  callback_base_url text DEFAULT ''::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT mpesa_config_pkey PRIMARY KEY (id),
  CONSTRAINT mpesa_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id)
);
ALTER TABLE public.mpesa_config ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mpesa_config' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.mpesa_config FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
END $p$;

-- ---------------------------------------------------------------------------
-- withdrawal_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  phone_number text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  reviewed_by uuid,
  review_note text,
  auto_approved boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  completed_at timestamp with time zone,
  risk_score integer DEFAULT 0,
  risk_flags jsonb DEFAULT '[]'::jsonb,
  rejection_reason text,
  mpesa_receipt text,
  CONSTRAINT withdrawal_requests_pkey PRIMARY KEY (id),
  CONSTRAINT withdrawal_requests_risk_score_check CHECK (((risk_score >= 0) AND (risk_score <= 100))),
  CONSTRAINT withdrawal_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id),
  CONSTRAINT withdrawal_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawal_requests USING btree (status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON public.withdrawal_requests USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_wr_auto_approved ON public.withdrawal_requests USING btree (auto_approved) WHERE (auto_approved = true);
CREATE INDEX IF NOT EXISTS idx_wr_risk_score ON public.withdrawal_requests USING btree (risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_wr_status_pending ON public.withdrawal_requests USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_wr_user_id ON public.withdrawal_requests USING btree (user_id);
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.withdrawal_requests FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='user_read_own_withdrawals') THEN
    CREATE POLICY "user_read_own_withdrawals" ON public.withdrawal_requests FOR SELECT USING ((user_id = auth.uid()));
  END IF;
END $p$;

-- ---------------------------------------------------------------------------
-- crash_queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crash_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  crash_multiplier numeric NOT NULL,
  position integer NOT NULL,
  source text DEFAULT 'algorithm'::text NOT NULL,
  is_override boolean DEFAULT false NOT NULL,
  override_reason text,
  status text DEFAULT 'pending'::text NOT NULL,
  used_at timestamp with time zone,
  round_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  batch_id uuid,
  notes text,
  CONSTRAINT crash_queue_pkey PRIMARY KEY (id),
  CONSTRAINT crash_queue_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id),
  CONSTRAINT crash_queue_round_id_fkey FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);
CREATE INDEX IF NOT EXISTS idx_crash_queue_batch_id ON public.crash_queue USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_crash_queue_pending ON public.crash_queue USING btree ("position") WHERE (status = 'pending'::text);
ALTER TABLE public.crash_queue ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crash_queue' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.crash_queue FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
END $p$;

-- ---------------------------------------------------------------------------
-- player_risk_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_risk_scores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  risk_level text DEFAULT 'low'::text NOT NULL,
  score integer DEFAULT 0 NOT NULL,
  flags jsonb DEFAULT '[]'::jsonb NOT NULL,
  last_assessed_at timestamp with time zone DEFAULT now() NOT NULL,
  notes text,
  CONSTRAINT player_risk_scores_pkey PRIMARY KEY (id),
  CONSTRAINT player_risk_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id),
  CONSTRAINT player_risk_scores_user_id_key UNIQUE (user_id)
);
ALTER TABLE public.player_risk_scores ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='player_risk_scores' AND policyname='admin_full_access') THEN
    CREATE POLICY "admin_full_access" ON public.player_risk_scores FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
  END IF;
END $p$;

COMMIT;
