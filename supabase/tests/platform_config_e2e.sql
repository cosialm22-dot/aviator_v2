-- e2e for platform global config (kill-switches + versioning). Rolled back.
-- Uses the EXISTING platform_superadmin root (role is a locked singleton).
DO $e2e$
DECLARE
  ps  uuid;                                              -- existing platform_superadmin
  p   uuid := 'aaaaaaaa-0000-0000-0000-000000000003';   -- player
  tgt uuid := 'aaaaaaaa-0000-0000-0000-000000000004';   -- promote target (player)
  site uuid := '00000000-0000-0000-0000-000000000001';
  r1 uuid := gen_random_uuid();
  v jsonb; v_res jsonb; v_base int;
BEGIN
  SELECT id INTO ps FROM profiles WHERE role='platform_superadmin' ORDER BY created_at LIMIT 1;
  IF ps IS NULL THEN RAISE EXCEPTION 'no platform_superadmin root present'; END IF;
  INSERT INTO auth.users(id,raw_user_meta_data) VALUES (p,'{"username":"player_pc"}');
  INSERT INTO auth.users(id,raw_user_meta_data) VALUES (tgt,'{"username":"promo_target"}');

  v := fn_platform_get_global_config();
  v_base := (v->>'version')::int;                        -- current live version (baseline)
  IF (v->>'play_enabled')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'C1 play should default ON'; END IF;

  -- non-platform-superadmin cannot set
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p)::text, true);
  BEGIN v := fn_platform_set_global_config('{"play_enabled":false}'::jsonb);
    RAISE EXCEPTION 'C2 non-PS set should be FORBIDDEN';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN RAISE EXCEPTION 'C2 err %',SQLERRM; END IF; END;

  -- PS disables play -> version bump + snapshot + audit
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ps)::text, true);
  v := fn_platform_set_global_config('{"play_enabled":false}'::jsonb);
  IF (v->>'play_enabled')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'C3 play not off'; END IF;
  IF (v->>'version')::int <> v_base+1 THEN RAISE EXCEPTION 'C4 version=% expected %',(v->>'version'),v_base+1; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform_global_config_versions WHERE version=v_base+1) THEN RAISE EXCEPTION 'C5 snapshot missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM admin_audit_log WHERE admin_id=ps AND action='platform_config_set') THEN RAISE EXCEPTION 'C6 audit missing'; END IF;
  IF fn_platform_switch('play_enabled') IS NOT FALSE THEN RAISE EXCEPTION 'C6b switch not false'; END IF;

  -- play gate: place_bet blocked
  INSERT INTO game_rounds(id,round_number,status,betting_ends_at,site_id) VALUES (r1,900101,'waiting',now()+interval '1 hour',site);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p)::text, true);
  BEGIN v_res := place_bet(r1,50::numeric,NULL,1::smallint);
    RAISE EXCEPTION 'C7 place_bet should be PLAY_DISABLED';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%PLAY_DISABLED%' THEN RAISE EXCEPTION 'C7 err %',SQLERRM; END IF; END;

  -- withdrawals gate
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ps)::text, true);
  v := fn_platform_set_global_config('{"withdrawals_enabled":false}'::jsonb);
  PERFORM _wallet_move(p, 100000,'real','deposit','test','x');
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p)::text, true);
  BEGIN v_res := request_withdrawal(100::numeric,'254712345678');
    RAISE EXCEPTION 'C8 withdrawal should be WITHDRAWALS_DISABLED';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%WITHDRAWALS_DISABLED%' THEN RAISE EXCEPTION 'C8 err %',SQLERRM; END IF; END;

  -- registrations gate: a brand-new signup is blocked
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ps)::text, true);
  v := fn_platform_set_global_config('{"registrations_enabled":false}'::jsonb);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN INSERT INTO auth.users(id,raw_user_meta_data) VALUES (gen_random_uuid(),'{"username":"blocked_signup"}');
    RAISE EXCEPTION 'C9 signup should be REGISTRATIONS_DISABLED';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%REGISTRATIONS_DISABLED%' THEN RAISE EXCEPTION 'C9 err %',SQLERRM; END IF; END;

  -- marketers gate: promote blocked (root passes _is_super_admin, then hits switch)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ps)::text, true);
  v := fn_platform_set_global_config('{"marketers_enabled":false}'::jsonb);
  BEGIN v_res := admin_promote_to_marketer('promo_target');
    RAISE EXCEPTION 'C10 promote should be MARKETERS_DISABLED';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%MARKETERS_DISABLED%' THEN RAISE EXCEPTION 'C10 err %',SQLERRM; END IF; END;

  -- re-enable everything -> switches true again
  v := fn_platform_set_global_config('{"play_enabled":true,"withdrawals_enabled":true,"registrations_enabled":true,"marketers_enabled":true}'::jsonb);
  IF fn_platform_switch('play_enabled') IS NOT TRUE OR fn_platform_switch('withdrawals_enabled') IS NOT TRUE
     OR fn_platform_switch('registrations_enabled') IS NOT TRUE OR fn_platform_switch('marketers_enabled') IS NOT TRUE THEN
    RAISE EXCEPTION 'C11 re-enable failed'; END IF;

  RAISE NOTICE '================= PLATFORM CONFIG E2E PASSED =================';
END
$e2e$;
