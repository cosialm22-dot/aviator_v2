-- =====================================================================
-- 20260829050000_support_chat.sql
-- Borrow #4 (DB layer): support conversations/transcripts + escalation +
-- KB schema (pgvector) + retrieval. invest254 0057, adapted to aviator:
-- no separate API service -> authenticated users drive the widget directly;
-- operator reads via _is_admin(); KB write/answering via service_role.
--
-- SHIPS NOW (usable): human support — start conversation, send message,
--   escalate to human, operators read transcripts. KB schema + fn_kb_search
--   are ready but DORMANT until the embedding-ingestion + LLM-answering
--   pipeline lands (#4b) — that needs an external embedding/LLM provider and
--   an edge function (deploy currently blocked). Additive + idempotent.
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Knowledge base (dormant until embeddings are ingested) ───────────
CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid REFERENCES public.sites(id) ON DELETE CASCADE,   -- NULL = shared across brands
  source      text NOT NULL,
  heading     text,
  chunk_index int  NOT NULL DEFAULT 0,
  content     text NOT NULL,
  embedding   vector(384) NOT NULL,            -- bge-small-en-v1.5 (normalised)
  token_count int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_chunks_site_idx ON public.kb_chunks(site_id);
DO $idx$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='kb_chunks_embedding_idx') THEN
    EXECUTE 'CREATE INDEX kb_chunks_embedding_idx ON public.kb_chunks USING hnsw (embedding vector_cosine_ops)';
  END IF;
EXCEPTION WHEN others THEN NULL;   -- hnsw unavailable -> sequential scan (KB is small)
END $idx$;

-- Top-k retrieval: shared KB (site_id null) + the caller brand's overrides.
CREATE OR REPLACE FUNCTION public.fn_kb_search(p_site_id uuid, p_embedding vector(384), p_k int DEFAULT 5)
 RETURNS TABLE(id uuid, source text, heading text, content text, distance real)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT k.id, k.source, k.heading, k.content, (k.embedding <=> p_embedding)::real AS distance
    FROM public.kb_chunks k
   WHERE k.site_id IS NULL OR k.site_id = p_site_id
   ORDER BY k.embedding <=> p_embedding
   LIMIT greatest(p_k, 1)
$$;

-- ── Support transcripts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.profiles(id),
  visitor_id    text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','escalated')),
  contact_email text,
  contact_phone text,
  escalated     boolean NOT NULL DEFAULT false,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_conv_site_idx ON public.support_conversations(site_id, last_at DESC);
CREATE INDEX IF NOT EXISTS support_conv_user_idx ON public.support_conversations(user_id, last_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence      real,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_msg_conv_idx ON public.support_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS support_msg_site_idx ON public.support_messages(site_id, created_at DESC);

-- ── RPCs ─────────────────────────────────────────────────────────────
-- Start a conversation. Authenticated -> own conversation + their brand.
-- service_role -> may pass p_site_id/p_user (for the answering pipeline).
CREATE OR REPLACE FUNCTION public.fn_support_start(p_site_id uuid DEFAULT NULL, p_visitor text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_site uuid; v_user uuid; v_id uuid;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT site_id INTO v_site FROM public.profiles WHERE id = v_uid;
    v_user := v_uid;
  ELSE
    v_site := coalesce(p_site_id, '00000000-0000-0000-0000-000000000001'::uuid);
    v_user := p_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site) THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  INSERT INTO public.support_conversations(site_id, visitor_id, user_id)
    VALUES (v_site, nullif(btrim(coalesce(p_visitor,'')),''), v_user)
    RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- Authenticated user sends a 'user' message on their OWN conversation.
CREATE OR REPLACE FUNCTION public.fn_support_send(p_conversation uuid, p_content text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_site uuid; v_owner uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF coalesce(btrim(p_content),'') = '' THEN RAISE EXCEPTION 'EMPTY_CONTENT'; END IF;
  SELECT site_id, user_id INTO v_site, v_owner FROM public.support_conversations WHERE id = p_conversation;
  IF NOT found THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  IF v_owner IS DISTINCT FROM v_uid AND NOT public._is_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.support_messages(conversation_id, site_id, role, content)
    VALUES (p_conversation, v_site, 'user', p_content) RETURNING id INTO v_id;
  UPDATE public.support_conversations SET last_at = now() WHERE id = p_conversation;
  RETURN v_id;
END $fn$;

-- Full logger (assistant/system turns with citations+confidence): service_role.
CREATE OR REPLACE FUNCTION public.fn_support_log(
  p_conversation uuid, p_role text, p_content text, p_sources jsonb DEFAULT '[]'::jsonb, p_confidence real DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_site uuid; v_id uuid;
BEGIN
  IF p_role NOT IN ('user','assistant','system') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF coalesce(btrim(p_content),'') = '' THEN RAISE EXCEPTION 'EMPTY_CONTENT'; END IF;
  SELECT site_id INTO v_site FROM public.support_conversations WHERE id = p_conversation;
  IF NOT found THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  INSERT INTO public.support_messages(conversation_id, site_id, role, content, sources, confidence)
    VALUES (p_conversation, v_site, p_role, p_content, coalesce(p_sources,'[]'::jsonb), p_confidence)
    RETURNING id INTO v_id;
  UPDATE public.support_conversations SET last_at = now() WHERE id = p_conversation;
  RETURN v_id;
END $fn$;

-- Escalate to a human (own conversation, admin, or service_role).
CREATE OR REPLACE FUNCTION public.fn_support_escalate(p_conversation uuid, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.support_conversations WHERE id = p_conversation;
  IF NOT found THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
  IF v_uid IS NOT NULL AND v_owner IS DISTINCT FROM v_uid AND NOT public._is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.support_conversations
     SET escalated = true, status = 'escalated',
         contact_email = coalesce(nullif(btrim(coalesce(p_email,'')),''), contact_email),
         contact_phone = coalesce(nullif(btrim(coalesce(p_phone,'')),''), contact_phone),
         last_at = now()
   WHERE id = p_conversation;
END $fn$;

-- ── RLS: users read their own; operators read all ────────────────────
ALTER TABLE public.kb_chunks             ENABLE ROW LEVEL SECURITY;   -- no policies: service_role/definer only
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages      ENABLE ROW LEVEL SECURITY;
DO $mig$
BEGIN
  DROP POLICY IF EXISTS sel_own_or_admin ON public.support_conversations;
  CREATE POLICY sel_own_or_admin ON public.support_conversations FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public._is_admin());
  DROP POLICY IF EXISTS sel_own_or_admin ON public.support_messages;
  CREATE POLICY sel_own_or_admin ON public.support_messages FOR SELECT TO authenticated
    USING (public._is_admin() OR EXISTS (
      SELECT 1 FROM public.support_conversations c
       WHERE c.id = support_messages.conversation_id AND c.user_id = auth.uid()));
END $mig$;
GRANT SELECT ON public.support_conversations, public.support_messages TO authenticated;

-- ── Grants ───────────────────────────────────────────────────────────
DO $g$
BEGIN
  REVOKE ALL ON FUNCTION public.fn_kb_search(uuid,vector,int)             FROM public, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.fn_kb_search(uuid,vector,int)          TO service_role;
  REVOKE ALL ON FUNCTION public.fn_support_start(uuid,text,uuid)          FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_support_start(uuid,text,uuid)       TO authenticated, service_role;
  REVOKE ALL ON FUNCTION public.fn_support_send(uuid,text)                FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_support_send(uuid,text)             TO authenticated, service_role;
  REVOKE ALL ON FUNCTION public.fn_support_log(uuid,text,text,jsonb,real) FROM public, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.fn_support_log(uuid,text,text,jsonb,real) TO service_role;
  REVOKE ALL ON FUNCTION public.fn_support_escalate(uuid,text,text)       FROM public, anon;
  GRANT  EXECUTE ON FUNCTION public.fn_support_escalate(uuid,text,text)    TO authenticated, service_role;
END
$g$;

COMMIT;
-- REVERT: drop fns fn_support_*/fn_kb_search; drop tables support_messages,
--   support_conversations, kb_chunks. (extension vector left installed.)
