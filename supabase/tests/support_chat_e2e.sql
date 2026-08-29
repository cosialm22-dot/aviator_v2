-- e2e for support chat + KB retrieval (rolled back).
DO $e2e$
DECLARE
  u    uuid := '10101010-1010-1010-1010-101010101010';
  v    uuid := '20202020-2020-2020-2020-202020202020';
  site uuid := '00000000-0000-0000-0000-000000000001';
  v_conv uuid; v_mid uuid; v_owner uuid; v_status text; v_esc boolean; v_email text;
  v_vec vector(384); v_cnt int; v_dist real; v_src text;
BEGIN
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (u,'{"username":"support_u"}');
  INSERT INTO auth.users(id, raw_user_meta_data) VALUES (v,'{"username":"support_v"}');

  -- start (as U)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u)::text, true);
  v_conv := fn_support_start(NULL, NULL, NULL);
  SELECT user_id,status FROM support_conversations WHERE id=v_conv INTO v_owner,v_status;
  IF v_owner<>u OR v_status<>'open' THEN RAISE EXCEPTION 'S1 start wrong owner/status % %',v_owner,v_status; END IF;

  -- send a user message
  v_mid := fn_support_send(v_conv, 'I cannot withdraw my balance');
  IF (SELECT count(*) FROM support_messages WHERE conversation_id=v_conv AND role='user')<>1 THEN
    RAISE EXCEPTION 'S2 user message not logged'; END IF;

  -- non-owner cannot send on U''s conversation
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v)::text, true);
  BEGIN
    v_mid := fn_support_send(v_conv, 'hijack');
    RAISE EXCEPTION 'S3 non-owner send should be FORBIDDEN';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN RAISE EXCEPTION 'S3 wrong error: %',SQLERRM; END IF;
  END;

  -- assistant turn via service logger (role=assistant)
  PERFORM set_config('request.jwt.claims', '', true);   -- service-style (no auth.uid)
  v_mid := fn_support_log(v_conv, 'assistant', 'Withdrawals require a verified phone. ...',
                          '[{"source":"docs/wallet.md"}]'::jsonb, 0.82::real);
  IF (SELECT count(*) FROM support_messages WHERE conversation_id=v_conv)<>2 THEN
    RAISE EXCEPTION 'S4 expected 2 messages'; END IF;

  -- escalate (as owner U)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u)::text, true);
  PERFORM fn_support_escalate(v_conv, 'u@example.com', '254712345678');
  SELECT escalated,status,contact_email FROM support_conversations WHERE id=v_conv INTO v_esc,v_status,v_email;
  IF v_esc IS NOT TRUE OR v_status<>'escalated' OR v_email<>'u@example.com' THEN
    RAISE EXCEPTION 'S5 escalate wrong e%/s%/mail%',v_esc,v_status,v_email; END IF;

  -- KB retrieval: insert a shared chunk, search with same vector -> distance ~0
  v_vec := ('['||array_to_string(array_fill(0.1::real, ARRAY[384]),',')||']')::vector;
  INSERT INTO kb_chunks(site_id, source, heading, content, embedding)
    VALUES (NULL, 'docs/wallet.md', 'Withdrawals', 'To withdraw, verify your phone...', v_vec);
  SELECT count(*) FROM fn_kb_search(site, v_vec, 3) INTO v_cnt;
  IF v_cnt < 1 THEN RAISE EXCEPTION 'S6 kb search returned nothing'; END IF;
  SELECT source, distance FROM fn_kb_search(site, v_vec, 1) INTO v_src, v_dist;
  IF v_src<>'docs/wallet.md' OR v_dist > 0.001 THEN RAISE EXCEPTION 'S7 kb search wrong src/dist %/%',v_src,v_dist; END IF;

  RAISE NOTICE '================= SUPPORT CHAT E2E PASSED =================';
END
$e2e$;
