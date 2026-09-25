-- ============================================================================
-- Multi-brand, step 2: one brand-configuration contract.
--
-- Borrowed from invest254's GATEWAY_SCHEMAS pattern ("the single source of truth serialised to
-- the browser so the form renders exactly the fields the backend validates"): every per-brand
-- setting is a ROW in brand_setting_defs (key, type, bounds, default, who may edit it, whether
-- players may see it). The admin console renders its forms from this table, the save RPC
-- validates against it, and the public brand payload is filtered by it. Adding a setting is one
-- INSERT here — no new column, no form code, no drift.
--
-- A brand stores ONLY its overrides (sites.config jsonb). Resolution per key:
--   brand override  ->  inherited platform value (system_settings / bonus_config)  ->  default.
-- So a brand that never touched "limits.min_bet" follows the global minimum bet automatically.
--
-- Every save bumps sites.config_version, writes a full snapshot to site_config_versions (history,
-- diff, one-click rollback), writes the audit log, and broadcasts {site_id, version} on the public
-- "config" topic so open player pages re-skin live.
-- Idempotent.
-- ============================================================================
BEGIN;

-- ── 1. registry ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_setting_defs (
  key           text PRIMARY KEY CHECK (key ~ '^[a-z]+\.[a-z0-9_]+$'),
  section       text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('bool','int','number','money','text','longtext','enum','color','url','email','phone','list')),
  label         text NOT NULL,
  help          text,
  default_value jsonb,                 -- used when neither the brand nor the inherit source has a value
  inherit       text,                  -- 'setting:<system_settings key>' | 'bonus:<field>' (platform-wide value)
  min_value     numeric,
  max_value     numeric,
  options       jsonb,                 -- enum: [["value","Label"], …]
  pattern       text,                  -- text: regex the value must match
  max_len       int,
  is_public     boolean NOT NULL DEFAULT true,   -- served to players in the brand payload
  edit_tier     text NOT NULL DEFAULT 'platform' CHECK (edit_tier IN ('owner','platform','brand')),
  floor_setting text,                  -- non-owner edits may not go BELOW this platform setting
  ceil_setting  text,                  -- non-owner edits may not go ABOVE this platform setting
  sort          int NOT NULL DEFAULT 0
);
ALTER TABLE public.brand_setting_defs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_setting_defs FROM anon, authenticated;

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS config_version int NOT NULL DEFAULT 1;
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_config_is_object;
ALTER TABLE public.sites ADD CONSTRAINT sites_config_is_object CHECK (jsonb_typeof(config) = 'object');

CREATE TABLE IF NOT EXISTS public.site_config_versions (
  id          bigserial PRIMARY KEY,
  site_id     uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  version     int NOT NULL,
  snapshot    jsonb NOT NULL,          -- {identity, theme_tokens, config}
  diff        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  changed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);
ALTER TABLE public.site_config_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_config_versions FROM anon, authenticated;

-- ── 2. domains (step 5 adds the Cloudflare automation columns' behaviour) ─────────────────────
CREATE TABLE IF NOT EXISTS public.site_domains (
  hostname        text PRIMARY KEY CHECK (hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  is_primary      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error')),
  zone_id         text,
  zone_status     text,
  nameservers     text[],
  worker_status   text,
  ssl_status      text,
  last_checked_at timestamptz,
  last_error      text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_domains_primary ON public.site_domains(site_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_site_domains_site ON public.site_domains(site_id);
ALTER TABLE public.site_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_domains FROM anon, authenticated;

INSERT INTO public.site_domains(hostname, site_id, is_primary, status)
SELECT lower(primary_domain), id, true, 'active' FROM public.sites
 WHERE primary_domain IS NOT NULL AND primary_domain <> ''
ON CONFLICT (hostname) DO NOTHING;

-- sites.primary_domain mirrors the primary site_domains row (read by older code paths).
CREATE OR REPLACE FUNCTION public._site_domains_sync_primary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_site uuid := coalesce(NEW.site_id, OLD.site_id);
BEGIN
  UPDATE sites SET primary_domain = (SELECT hostname FROM site_domains WHERE site_id = v_site AND is_primary LIMIT 1)
   WHERE id = v_site AND primary_domain IS DISTINCT FROM (SELECT hostname FROM site_domains WHERE site_id = v_site AND is_primary LIMIT 1);
  IF TG_OP = 'UPDATE' AND OLD.site_id IS DISTINCT FROM NEW.site_id THEN
    UPDATE sites SET primary_domain = (SELECT hostname FROM site_domains WHERE site_id = OLD.site_id AND is_primary LIMIT 1) WHERE id = OLD.site_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_site_domains_sync ON public.site_domains;
CREATE TRIGGER trg_site_domains_sync AFTER INSERT OR UPDATE OR DELETE ON public.site_domains
  FOR EACH ROW EXECUTE FUNCTION public._site_domains_sync_primary();

-- ── 3. the settings ──────────────────────────────────────────────────────────────────────────
-- (key, section, kind, label, help, default, inherit, min, max, options, pattern, max_len, public, tier, floor, ceil, sort)
DELETE FROM public.brand_setting_defs;
INSERT INTO public.brand_setting_defs
  (key, section, kind, label, help, default_value, inherit, min_value, max_value, options, pattern, max_len, is_public, edit_tier, floor_setting, ceil_setting, sort)
VALUES
-- Look: the game screen
('look.theme_id','look','text','Theme','Gallery theme this brand started from.', 'null', NULL, NULL, NULL, NULL, '^[a-z0-9-]{1,40}$', 40, true, 'platform', NULL, NULL, 10),
('look.canvas_style','look','enum','Sky','Background behind the flight.', '"sunburst"', NULL, NULL, NULL,
  '[["sunburst","Sunburst"],["rays","Soft rays"],["grid","Radar grid"],["stars","Night stars"],["plain","Plain"]]', NULL, NULL, true, 'platform', NULL, NULL, 20),
('look.canvas_bg','look','color','Sky colour',NULL, '"#0d0d0d"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 30),
('look.canvas_ray','look','color','Ray colour','The lighter of the two alternating sky rays.', '"#1e1e1e"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
('look.curve','look','color','Flight line',NULL, '"#e51e3c"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 50),
('look.wait_bar','look','color','Countdown bar',NULL, '"#e8123c"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 60),
('look.multiplier','look','color','Multiplier',NULL, '"#ffffff"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 70),
('look.crash','look','color','Fly-away colour',NULL, '"#e51e3c"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 80),
('look.glow','look','bool','Glow','Colour glow behind the multiplier.', 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 90),
('look.header_mark','look','enum','Header mark',NULL, '"plane"', NULL, NULL, NULL,
  '[["plane","Plane"],["logo","Logo image"],["wordmark","Wordmark only"]]', NULL, NULL, true, 'platform', NULL, NULL, 100),
-- Plane: what players see
('plane.model','plane','enum','Plane',NULL, '"classic"', NULL, NULL, NULL,
  '[["classic","Classic"],["jet","Jet"],["prop","Propeller"],["biplane","Biplane"],["fighter","Fighter"],["stealth","Stealth"],["rocket","Rocket"],["cargo","Cargo"],["glider","Glider"],["seaplane","Seaplane"],["concorde","Supersonic"],["custom","Uploaded image"]]',
  NULL, NULL, true, 'platform', NULL, NULL, 10),
('plane.body','plane','color','Body',NULL, '"#e51e3c"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 20),
('plane.accent','plane','color','Wings & tail',NULL, '"#b3122e"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 30),
('plane.canopy','plane','color','Windows',NULL, '"#bfe6ff"', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
('plane.image_url','plane','url','Uploaded plane','PNG or SVG facing right, transparent background.', 'null', NULL, NULL, NULL, NULL, NULL, 500, true, 'platform', NULL, NULL, 50),
('plane.scale','plane','number','Size',NULL, '1', NULL, 0.7, 1.5, NULL, NULL, NULL, true, 'platform', NULL, NULL, 60),
('plane.exhaust','plane','bool','Exhaust','Engine glow / propeller blur while flying.', 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 70),
-- Streamer mode: what marketers show on TikTok
('stream.bird','stream','enum','Bird','Marketers stream a bird instead of the plane.', '"fisheagle"', NULL, NULL, NULL,
  '[["fisheagle","African Fish Eagle"],["augur","Augur Buzzard"],["vulture","White-backed Vulture"],["albatross","Wandering Albatross"],["osprey","Osprey"],["swift","Common Swift"],["swallow","Barn Swallow"],["falcon","Peregrine Falcon"],["martin","House Martin"],["bee-eater","Little Bee-eater"],["weaver","Speke''s Weaver"],["roller","Lilac-breasted Roller"],["starling","Superb Starling"],["sunbird","Scarlet-chested Sunbird"],["sparrow","House Sparrow"],["flamingo","Lesser Flamingo"],["crownedcrane","Grey Crowned Crane"],["pelican","Great White Pelican"],["heron","Grey Heron"],["hornbill","Von der Decken''s Hornbill"]]',
  NULL, NULL, true, 'platform', NULL, NULL, 10),
('stream.default_on','stream','bool','On by default','Marketers open the game in streamer mode.', 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 20),
('stream.curve','stream','color','Flight line (stream)','Blank = same as the player flight line.', 'null', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 30),
('stream.show_domain','stream','bool','Show domain','Header shows the site address while streaming.', 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
-- Words players read
('copy.flew_away','copy','text','Fly-away text',NULL, '"FLEW AWAY!"', NULL, NULL, NULL, NULL, NULL, 24, true, 'brand', NULL, NULL, 10),
('copy.tagline','copy','text','Tagline','Under the name on the sign-in sheet.', 'null', NULL, NULL, NULL, NULL, NULL, 80, true, 'brand', NULL, NULL, 20),
('copy.announcement','copy','text','Announcement','One line above the game. Blank = none.', 'null', NULL, NULL, NULL, NULL, NULL, 140, true, 'brand', NULL, NULL, 30),
('copy.register_title','copy','text','Sign-up title',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 60, true, 'brand', NULL, NULL, 40),
-- Search & sharing
('seo.title','seo','text','Page title','Browser tab and search result. Blank = brand name.', 'null', NULL, NULL, NULL, NULL, NULL, 70, true, 'brand', NULL, NULL, 10),
('seo.description','seo','text','Description',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 300, true, 'brand', NULL, NULL, 20),
('seo.og_image','seo','url','Share image','1200×630.', 'null', NULL, NULL, NULL, NULL, NULL, 500, true, 'brand', NULL, NULL, 30),
('seo.indexing','seo','enum','Search engines',NULL, '"index"', NULL, NULL, NULL, '[["index","Allow"],["noindex","Hide"]]', NULL, NULL, true, 'brand', NULL, NULL, 40),
-- Support & social
('support.whatsapp','support','phone','WhatsApp',NULL, 'null', NULL, NULL, NULL, NULL, NULL, NULL, true, 'brand', NULL, NULL, 10),
('support.phone','support','phone','Phone',NULL, 'null', NULL, NULL, NULL, NULL, NULL, NULL, true, 'brand', NULL, NULL, 20),
('support.telegram','support','url','Telegram',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 30),
('support.hours','support','text','Hours',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 60, true, 'brand', NULL, NULL, 40),
('social.facebook','social','url','Facebook',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 10),
('social.instagram','social','url','Instagram',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 20),
('social.tiktok','social','url','TikTok',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 30),
('social.x','social','url','X',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 40),
('social.youtube','social','url','YouTube',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 200, true, 'brand', NULL, NULL, 50),
-- Features (enforced by the server where money or accounts are involved)
('features.registrations','features','bool','Sign-ups',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 10),
('features.play','features','bool','Real-money play',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 20),
('features.deposits','features','bool','Deposits',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 30),
('features.withdrawals','features','bool','Withdrawals',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
('features.demo','features','bool','Demo mode',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 50),
('features.two_bets','features','bool','Second bet',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 60),
('features.autobet','features','bool','Auto play',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 70),
('features.chat','features','bool','Chat',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 80),
('features.live_bets','features','bool','Live bets',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 90),
('features.history','features','bool','Round history',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 100),
('features.promo_codes','features','bool','Promo codes',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 110),
('features.free_bets','features','bool','Free bets',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 120),
('features.rain','features','bool','Rain',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 130),
('features.referrals','features','bool','Invite friends',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 140),
('features.sound','features','bool','Sound on at first visit',NULL, 'true', NULL, NULL, NULL, NULL, NULL, NULL, true, 'brand', NULL, NULL, 150),
('features.maintenance','features','bool','Maintenance','Stops bets, deposits and withdrawals on this brand only.', 'false', NULL, NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 160),
('features.maintenance_message','features','text','Maintenance message',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 140, true, 'platform', NULL, NULL, 170),
-- Limits (KES; enforced by the server). Blank = the platform value.
('limits.min_bet','limits','money','Minimum bet',NULL, '50', 'setting:game.min_bet', 1, 1000000, NULL, NULL, NULL, true, 'platform', 'game.min_bet', NULL, 10),
('limits.max_bet','limits','money','Maximum bet',NULL, '100000', 'setting:game.max_bet', 1, 10000000, NULL, NULL, NULL, true, 'platform', NULL, 'game.max_bet', 20),
('limits.max_payout','limits','money','Maximum win per bet',NULL, '500000', 'setting:game.max_payout', 1, 100000000, NULL, NULL, NULL, true, 'platform', NULL, 'game.max_payout', 30),
('limits.default_bet','limits','money','Starting bet','Pre-filled stake.', '100', NULL, 1, 1000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
('limits.bet_chips','limits','list','Bet chips','Four quick stakes.', '[50,100,200,500]', NULL, 1, 1000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 50),
('limits.min_deposit','limits','money','Minimum deposit',NULL, '100', 'setting:finance.min_deposit', 1, 1000000, NULL, NULL, NULL, true, 'platform', 'finance.min_deposit', NULL, 60),
('limits.max_deposit','limits','money','Maximum deposit',NULL, '150000', 'setting:finance.max_deposit', 1, 10000000, NULL, NULL, NULL, true, 'platform', NULL, 'finance.max_deposit', 70),
('limits.deposit_chips','limits','list','Deposit chips','Blank = chosen from the limits.', 'null', NULL, 1, 10000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 80),
('limits.min_withdrawal','limits','money','Minimum withdrawal',NULL, '100', 'setting:finance.min_withdrawal', 1, 1000000, NULL, NULL, NULL, true, 'platform', 'finance.min_withdrawal', NULL, 90),
('limits.max_withdrawal','limits','money','Maximum withdrawal','Per request. Blank = no cap.', 'null', NULL, 1, 10000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 100),
('limits.daily_withdrawal','limits','money','Daily withdrawal cap','Per player. Blank = no cap.', 'null', NULL, 1, 100000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 110),
('limits.auto_approve','limits','money','Auto-approve up to','Low-risk withdrawals up to this amount skip review.', '2000', 'setting:finance.auto_approve_threshold', 0, 10000000, NULL, NULL, NULL, false, 'platform', NULL, 'finance.auto_approve_threshold', 120),
-- Bonuses (enforced). Blank = the platform offer.
('bonus.welcome_enabled','bonus','bool','Welcome bonus',NULL, 'false', 'bonus:welcome_enabled', NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 10),
('bonus.welcome_amount','bonus','money','Welcome amount',NULL, '0', 'bonus:welcome_amount', 0, 100000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 20),
('bonus.welcome_wager_x','bonus','number','Welcome wagering',NULL, '1', 'bonus:welcome_wager_x', 0, 100, NULL, NULL, NULL, true, 'platform', NULL, NULL, 30),
('bonus.deposit_enabled','bonus','bool','First-deposit match',NULL, 'false', 'bonus:deposit_enabled', NULL, NULL, NULL, NULL, NULL, true, 'platform', NULL, NULL, 40),
('bonus.deposit_pct','bonus','number','Match %',NULL, '0', 'bonus:deposit_pct', 0, 500, NULL, NULL, NULL, true, 'platform', NULL, NULL, 50),
('bonus.deposit_cap','bonus','money','Match cap',NULL, '0', 'bonus:deposit_cap', 0, 1000000, NULL, NULL, NULL, true, 'platform', NULL, NULL, 60),
('bonus.deposit_wager_x','bonus','number','Match wagering',NULL, '1', 'bonus:deposit_wager_x', 0, 100, NULL, NULL, NULL, true, 'platform', NULL, NULL, 70),
-- Payments
('payments.stk_reference','payments','text','M-Pesa account name','What the payer sees on the prompt. Blank = brand name.', 'null', NULL, NULL, NULL, NULL, '^[A-Z0-9]{2,12}$', 12, false, 'platform', NULL, NULL, 10),
-- Legal
('legal.min_age','legal','int','Minimum age',NULL, '18', NULL, 18, 25, NULL, NULL, NULL, true, 'platform', NULL, NULL, 10),
('legal.company','legal','text','Operator',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 120, true, 'brand', NULL, NULL, 20),
('legal.licence_no','legal','text','Licence number',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 60, true, 'brand', NULL, NULL, 30),
('legal.terms','legal','longtext','Terms',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 40000, true, 'brand', NULL, NULL, 40),
('legal.privacy','legal','longtext','Privacy',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 40000, true, 'brand', NULL, NULL, 50),
('legal.responsible','legal','longtext','Responsible gaming',NULL, 'null', NULL, NULL, NULL, NULL, NULL, 20000, true, 'brand', NULL, NULL, 60),
-- Analytics
('analytics.ga4','analytics','text','Google Analytics 4','G-XXXXXXX', 'null', NULL, NULL, NULL, NULL, '^G-[A-Z0-9]{4,14}$', 16, true, 'brand', NULL, NULL, 10),
('analytics.gtm','analytics','text','Tag Manager','GTM-XXXXXX', 'null', NULL, NULL, NULL, NULL, '^GTM-[A-Z0-9]{4,12}$', 16, true, 'brand', NULL, NULL, 20),
('analytics.meta_pixel','analytics','text','Meta Pixel',NULL, 'null', NULL, NULL, NULL, NULL, '^[0-9]{6,20}$', 20, true, 'brand', NULL, NULL, 30),
('analytics.tiktok_pixel','analytics','text','TikTok Pixel',NULL, 'null', NULL, NULL, NULL, NULL, '^[A-Z0-9]{10,30}$', 30, true, 'brand', NULL, NULL, 40),
-- Home-screen app
('pwa.short_name','pwa','text','App name','Under the home-screen icon.', 'null', NULL, NULL, NULL, NULL, NULL, 12, true, 'brand', NULL, NULL, 10),
('pwa.icon_url','pwa','url','App icon','Square PNG, 512×512.', 'null', NULL, NULL, NULL, NULL, NULL, 500, true, 'brand', NULL, NULL, 20);

-- ── 4. resolution ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._brand_inherit(p_src text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_src LIKE 'setting:%' THEN (SELECT value FROM system_settings WHERE key = substr(p_src, 9))
    WHEN p_src = 'bonus:welcome_enabled'  THEN (SELECT to_jsonb(enabled AND welcome_enabled) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:welcome_amount'   THEN (SELECT to_jsonb(welcome_amount_cents / 100.0) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:welcome_wager_x'  THEN (SELECT to_jsonb(welcome_wagering_x) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:deposit_enabled'  THEN (SELECT to_jsonb(enabled AND first_deposit_enabled) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:deposit_pct'      THEN (SELECT to_jsonb(first_deposit_match_pct) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:deposit_cap'      THEN (SELECT to_jsonb(first_deposit_cap_cents / 100.0) FROM bonus_config WHERE id = 1)
    WHEN p_src = 'bonus:deposit_wager_x'  THEN (SELECT to_jsonb(first_deposit_wagering_x) FROM bonus_config WHERE id = 1)
  END;
$$;

-- One effective value (hot paths: place_bet, cash-out settle, deposits).
CREATE OR REPLACE FUNCTION public._brand_value(p_site uuid, p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT nullif(s.config -> p_key, 'null'::jsonb) FROM sites s WHERE s.id = p_site),
    (SELECT nullif(public._brand_inherit(d.inherit), 'null'::jsonb) FROM brand_setting_defs d WHERE d.key = p_key AND d.inherit IS NOT NULL),
    (SELECT d.default_value FROM brand_setting_defs d WHERE d.key = p_key));
$$;
CREATE OR REPLACE FUNCTION public._brand_num(p_site uuid, p_key text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (public._brand_value(p_site, p_key) #>> '{}')::numeric;
$$;
CREATE OR REPLACE FUNCTION public._brand_bool(p_site uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((public._brand_value(p_site, p_key) #>> '{}')::boolean, false);
$$;

-- Every effective value of a brand (optionally only the public ones), one query.
CREATE OR REPLACE FUNCTION public.fn_brand_effective(p_site uuid, p_public_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(d.key, coalesce(nullif(c.config -> d.key, 'null'::jsonb),
                                                    nullif(public._brand_inherit(d.inherit), 'null'::jsonb),
                                                    d.default_value, 'null'::jsonb)), '{}'::jsonb)
    FROM brand_setting_defs d
    CROSS JOIN (SELECT coalesce((SELECT config FROM sites WHERE id = p_site), '{}'::jsonb) AS config) c
   WHERE d.is_public OR NOT p_public_only;
$$;

-- ── 5. validation ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._brand_fonts()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['Inter','DM Sans','Manrope','Poppins','Montserrat','Sora','Space Grotesk','Onest','Hanken Grotesk',
    'IBM Plex Sans','Rajdhani','Titillium Web','Work Sans','Archivo','Chivo','Barlow','Red Hat Display','Figtree',
    'Plus Jakarta Sans','Outfit','Exo 2','Rubik','Roboto','Fraunces','Lora','Space Mono','JetBrains Mono',
    'IBM Plex Mono','Roboto Mono','Bebas Neue','Oswald','Russo One','Orbitron','Teko','Saira'];
$$;

-- Normalise one value against its definition, or raise INVALID_SETTING:<key>:<reason>.
-- JSON null means "clear the override" and is always valid.
CREATE OR REPLACE FUNCTION public._brand_validate(p_key text, p_value jsonb, p_owner boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d brand_setting_defs; t text; n numeric; b numeric; arr jsonb; e jsonb;
BEGIN
  SELECT * INTO d FROM brand_setting_defs WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_SETTING:%', p_key; END IF;
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN RETURN 'null'::jsonb; END IF;
  t := p_value #>> '{}';

  IF d.kind = 'bool' THEN
    IF jsonb_typeof(p_value) = 'boolean' THEN RETURN p_value; END IF;
    IF lower(t) IN ('true','false') THEN RETURN to_jsonb(lower(t)::boolean); END IF;
    RAISE EXCEPTION 'INVALID_SETTING:%:must be on or off', p_key;
  END IF;

  IF d.kind IN ('int','number','money') THEN
    BEGIN n := t::numeric; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be a number', p_key; END;
    IF d.kind = 'int' AND n <> trunc(n) THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be a whole number', p_key; END IF;
    IF d.kind = 'money' THEN n := round(n, 2); END IF;
    IF d.min_value IS NOT NULL AND n < d.min_value THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be at least %', p_key, d.min_value; END IF;
    IF d.max_value IS NOT NULL AND n > d.max_value THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be at most %', p_key, d.max_value; END IF;
    IF NOT p_owner AND d.floor_setting IS NOT NULL THEN
      b := (SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = d.floor_setting);
      IF b IS NOT NULL AND n < b THEN RAISE EXCEPTION 'INVALID_SETTING:%:the platform minimum is %', p_key, b; END IF;
    END IF;
    IF NOT p_owner AND d.ceil_setting IS NOT NULL THEN
      b := (SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = d.ceil_setting);
      IF b IS NOT NULL AND n > b THEN RAISE EXCEPTION 'INVALID_SETTING:%:the platform maximum is %', p_key, b; END IF;
    END IF;
    RETURN to_jsonb(trim_scale(n));
  END IF;

  IF d.kind = 'list' THEN
    IF jsonb_typeof(p_value) <> 'array' THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be a list of amounts', p_key; END IF;
    IF jsonb_array_length(p_value) < 1 OR jsonb_array_length(p_value) > 6 THEN RAISE EXCEPTION 'INVALID_SETTING:%:1 to 6 amounts', p_key; END IF;
    arr := '[]'::jsonb;
    FOR e IN SELECT * FROM jsonb_array_elements(p_value) LOOP
      BEGIN n := (e #>> '{}')::numeric; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_SETTING:%:amounts only', p_key; END;
      IF n <> trunc(n) OR n < coalesce(d.min_value, 1) OR n > coalesce(d.max_value, 1e9) THEN
        RAISE EXCEPTION 'INVALID_SETTING:%:each amount must be a whole number from % to %', p_key, coalesce(d.min_value,1), coalesce(d.max_value,1e9);
      END IF;
      arr := arr || to_jsonb(trim_scale(n));
    END LOOP;
    RETURN arr;
  END IF;

  IF jsonb_typeof(p_value) <> 'string' THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be text', p_key; END IF;
  t := trim(t);
  IF t = '' THEN RETURN 'null'::jsonb; END IF;
  IF length(t) > coalesce(d.max_len, CASE WHEN d.kind = 'longtext' THEN 40000 ELSE 200 END) THEN
    RAISE EXCEPTION 'INVALID_SETTING:%:too long (max %)', p_key, coalesce(d.max_len, 200);
  END IF;
  IF d.kind = 'enum' THEN
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.options) o WHERE o ->> 0 = t) THEN
      RAISE EXCEPTION 'INVALID_SETTING:%:not one of the choices', p_key;
    END IF;
  ELSIF d.kind = 'color' THEN
    IF t !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'INVALID_SETTING:%:colour must be #RRGGBB', p_key; END IF;
    t := lower(t);
  ELSIF d.kind = 'url' THEN
    IF t !~ '^https://[^\s<>"'']+$' THEN RAISE EXCEPTION 'INVALID_SETTING:%:must be an https:// link', p_key; END IF;
  ELSIF d.kind = 'email' THEN
    IF t !~* '^[^\s@]+@[^\s@]+\.[a-z]{2,}$' THEN RAISE EXCEPTION 'INVALID_SETTING:%:not an email address', p_key; END IF;
  ELSIF d.kind = 'phone' THEN
    t := regexp_replace(t, '[\s()-]', '', 'g');
    IF t ~ '^0[17][0-9]{8}$' THEN t := '+254' || substr(t, 2); END IF;
    IF t ~ '^254[0-9]{9}$' THEN t := '+' || t; END IF;
    IF t !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'INVALID_SETTING:%:phone in international form, e.g. +254712345678', p_key; END IF;
  END IF;
  IF d.pattern IS NOT NULL AND t !~ d.pattern THEN RAISE EXCEPTION 'INVALID_SETTING:%:wrong format', p_key; END IF;
  RETURN to_jsonb(t);
END $$;

-- Theme tokens: known keys only, hex colours, curated fonts, sane weight/radius.
CREATE OR REPLACE FUNCTION public._brand_validate_tokens(p_tokens jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v text; out jsonb := '{}'::jsonb;
BEGIN
  IF p_tokens IS NULL OR p_tokens = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_tokens) <> 'object' THEN RAISE EXCEPTION 'INVALID_THEME:tokens must be an object'; END IF;
  FOR k, v IN SELECT key, value #>> '{}' FROM jsonb_each(p_tokens) LOOP
    IF k IN ('bg','surface','surface2','border','fg','muted','brand','brandHover','brandText','accent','accentFg','up','down','warn','info') THEN
      IF v !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'INVALID_THEME:% must be #RRGGBB', k; END IF;
      out := out || jsonb_build_object(k, lower(v));
    ELSIF k IN ('fontTitle','fontBody','fontMono') THEN
      IF NOT (v = ANY(public._brand_fonts())) THEN RAISE EXCEPTION 'INVALID_THEME:% is not a supported font', k; END IF;
      out := out || jsonb_build_object(k, v);
    ELSIF k = 'headingWeight' THEN
      IF v NOT IN ('400','500','600','700','800','900') THEN RAISE EXCEPTION 'INVALID_THEME:headingWeight 400-900'; END IF;
      out := out || jsonb_build_object(k, v);
    ELSIF k = 'radius' THEN
      IF v !~ '^([0-9]|1[0-9]|2[0-4])px$' THEN RAISE EXCEPTION 'INVALID_THEME:radius 0px-24px'; END IF;
      out := out || jsonb_build_object(k, v);
    ELSE
      RAISE EXCEPTION 'INVALID_THEME:unknown token %', k;
    END IF;
  END LOOP;
  RETURN out;
END $$;

-- ── 6. who may edit what ─────────────────────────────────────────────────────────────────────
-- 'owner'    : the System owner.
-- 'platform' : the owner, or the platform admin whose platform owns the brand.
-- 'brand'    : additionally the brand's own super_admin (copy, support contacts, legal, SEO…).
CREATE OR REPLACE FUNCTION public._brand_can_edit(p_site uuid, p_tier text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._can_admin_site(p_site) AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (
         p.role = 'platform_superadmin'
      OR (p_tier IN ('platform','brand') AND p.role = 'platform_admin')
      OR (p_tier = 'brand' AND p.role = 'super_admin')));
$$;

-- ── 7. snapshot / read ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._brand_snapshot(p_site uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'identity', jsonb_build_object('name', name, 'status', status, 'wordmark_text', wordmark_text, 'logo_url', logo_url,
       'favicon_url', favicon_url, 'locale', locale, 'support_email', support_email, 'licence_line', licence_line),
    'theme_tokens', coalesce(theme_tokens, '{}'::jsonb),
    'config', config)
  FROM sites WHERE id = p_site;
$$;

CREATE OR REPLACE FUNCTION public.admin_brand_schema()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT jsonb_agg(jsonb_build_object('key', key, 'section', section, 'kind', kind, 'label', label, 'help', help,
        'default', default_value, 'inherit', inherit, 'inherited', public._brand_inherit(inherit),
        'min', min_value, 'max', max_value, 'options', options, 'pattern', pattern, 'max_len', max_len,
        'public', is_public, 'tier', edit_tier, 'floor', floor_setting, 'ceil', ceil_setting) ORDER BY section, sort, key)
      FROM brand_setting_defs),
    'fonts', to_jsonb(public._brand_fonts()));
END $$;

CREATE OR REPLACE FUNCTION public.admin_brand_get(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sites; v_role text;
BEGIN
  IF NOT (public._is_super_admin() AND public._can_admin_site(p_site)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO s FROM sites WHERE id = p_site;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  RETURN jsonb_build_object(
    'site_id', s.id, 'slug', s.slug, 'version', s.config_version, 'created_at', s.created_at, 'updated_at', s.updated_at,
    'platform_id', s.platform_id, 'platform_name', (SELECT name FROM platforms WHERE id = s.platform_id),
    'identity', public._brand_snapshot(p_site) -> 'identity',
    'theme_tokens', coalesce(s.theme_tokens, '{}'::jsonb),
    'config', s.config,
    'effective', public.fn_brand_effective(p_site, false),
    'domains', coalesce((SELECT jsonb_agg(to_jsonb(d) - 'created_by' ORDER BY d.is_primary DESC, d.hostname) FROM site_domains d WHERE d.site_id = p_site), '[]'::jsonb),
    'default_marketer', (SELECT jsonb_build_object('id', p.id, 'username', p.username, 'phone', p.phone_number, 'referral_code', p.referral_code)
                           FROM profiles p WHERE p.id = s.default_marketer_id),
    'marketers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username) ORDER BY p.username)
                             FROM profiles p WHERE p.site_id = p_site AND p.role = 'marketer'), '[]'::jsonb),
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'role', p.role) ORDER BY p.role, p.username)
                         FROM profiles p WHERE p.site_id = p_site AND p.role IN ('super_admin','admin','finance_admin','support')), '[]'::jsonb),
    'players', (SELECT count(*) FROM profiles p WHERE p.site_id = p_site AND p.role = 'player'),
    'can', jsonb_build_object('owner', v_role = 'platform_superadmin',
                              'platform', public._brand_can_edit(p_site, 'platform'),
                              'brand', public._brand_can_edit(p_site, 'brand')));
END $$;

CREATE OR REPLACE FUNCTION public.admin_brand_versions(p_site uuid, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public._is_super_admin() AND public._can_admin_site(p_site)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'version')::int DESC) FROM (
    SELECT jsonb_build_object('version', v.version, 'diff', v.diff, 'note', v.note, 'changed_at', v.changed_at,
                              'changed_by', (SELECT username FROM profiles WHERE id = v.changed_by)) AS x
      FROM site_config_versions v WHERE v.site_id = p_site ORDER BY v.version DESC LIMIT least(greatest(p_limit, 1), 200)) q), '[]'::jsonb);
END $$;

-- ── 8. save ──────────────────────────────────────────────────────────────────────────────────
-- p_identity: {name, status, wordmark_text, logo_url, favicon_url, locale, support_email, licence_line}
-- p_tokens:   the full theme token set (replaces), or NULL = unchanged
-- p_config:   {key: value | null}  (null clears the override -> inherit / default)
CREATE OR REPLACE FUNCTION public.admin_brand_save(
  p_site uuid, p_expected_version int, p_identity jsonb DEFAULT NULL, p_tokens jsonb DEFAULT NULL,
  p_config jsonb DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s sites; v_owner boolean; v_before jsonb; v_after jsonb; v_cfg jsonb; v_tok jsonb; v_diff jsonb := '{}'::jsonb;
  k text; v jsonb; d brand_setting_defs; v_norm jsonb; v_eff jsonb; v_ver int; t text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public._brand_can_edit(p_site, 'brand') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO s FROM sites WHERE id = p_site FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> s.config_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT:%', s.config_version;
  END IF;
  v_owner := public._is_platform_superadmin();
  v_before := public._brand_snapshot(p_site);

  -- identity
  IF p_identity IS NOT NULL THEN
    IF jsonb_typeof(p_identity) <> 'object' THEN RAISE EXCEPTION 'INVALID_IDENTITY'; END IF;
    FOR k, v IN SELECT * FROM jsonb_each(p_identity) LOOP
      t := nullif(trim(coalesce(v #>> '{}', '')), '');
      CASE k
        WHEN 'name' THEN
          IF t IS NULL OR length(t) > 60 THEN RAISE EXCEPTION 'INVALID_SETTING:identity.name:1 to 60 characters'; END IF;
          s.name := t;
        WHEN 'status' THEN
          IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'NOT_AUTHORIZED:identity.status'; END IF;
          IF t NOT IN ('active','suspended','disabled') THEN RAISE EXCEPTION 'INVALID_SETTING:identity.status:active, suspended or disabled'; END IF;
          IF p_site = '00000000-0000-0000-0000-000000000001' AND t <> 'active' THEN RAISE EXCEPTION 'INVALID_SETTING:identity.status:the default brand stays active'; END IF;
          s.status := t;
        WHEN 'wordmark_text' THEN
          IF length(coalesce(t,'')) > 40 THEN RAISE EXCEPTION 'INVALID_SETTING:identity.wordmark_text:max 40'; END IF;
          s.wordmark_text := t;
        WHEN 'logo_url' THEN
          IF t IS NOT NULL AND t !~ '^https://[^\s<>"'']+$' THEN RAISE EXCEPTION 'INVALID_SETTING:identity.logo_url:must be an https:// link'; END IF;
          s.logo_url := t;
        WHEN 'favicon_url' THEN
          IF t IS NOT NULL AND t !~ '^(https://[^\s<>"'']+|data:image/svg\+xml;base64,[A-Za-z0-9+/=]+)$' THEN RAISE EXCEPTION 'INVALID_SETTING:identity.favicon_url:https:// link or generated icon'; END IF;
          IF length(coalesce(t,'')) > 20000 THEN RAISE EXCEPTION 'INVALID_SETTING:identity.favicon_url:too large'; END IF;
          s.favicon_url := t;
        WHEN 'locale' THEN
          IF t NOT IN ('en-KE','en-US','en-GB','sw-KE') THEN RAISE EXCEPTION 'INVALID_SETTING:identity.locale:unsupported'; END IF;
          s.locale := t;
        WHEN 'support_email' THEN
          IF t IS NOT NULL AND t !~* '^[^\s@]+@[^\s@]+\.[a-z]{2,}$' THEN RAISE EXCEPTION 'INVALID_SETTING:identity.support_email:not an email address'; END IF;
          s.support_email := t;
        WHEN 'licence_line' THEN
          IF length(coalesce(t,'')) > 200 THEN RAISE EXCEPTION 'INVALID_SETTING:identity.licence_line:max 200'; END IF;
          s.licence_line := t;
        ELSE RAISE EXCEPTION 'INVALID_SETTING:identity.%:unknown field', k;
      END CASE;
    END LOOP;
  END IF;

  -- theme tokens (platform tier)
  IF p_tokens IS NOT NULL THEN
    IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'NOT_AUTHORIZED:theme'; END IF;
    v_tok := public._brand_validate_tokens(p_tokens);
    s.theme_tokens := v_tok;
    -- legacy colour columns follow the tokens
    s.color_primary := coalesce(v_tok ->> 'brand', s.color_primary);
    s.color_bg      := coalesce(v_tok ->> 'bg', s.color_bg);
    s.color_accent  := coalesce(v_tok ->> 'accent', s.color_accent);
  END IF;

  -- settings
  v_cfg := s.config;
  IF p_config IS NOT NULL THEN
    IF jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'INVALID_CONFIG'; END IF;
    FOR k, v IN SELECT * FROM jsonb_each(p_config) LOOP
      SELECT * INTO d FROM brand_setting_defs WHERE key = k;
      IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_SETTING:%', k; END IF;
      IF NOT public._brand_can_edit(p_site, d.edit_tier) THEN RAISE EXCEPTION 'NOT_AUTHORIZED:%', k; END IF;
      v_norm := public._brand_validate(k, v, v_owner);
      IF v_norm = 'null'::jsonb THEN v_cfg := v_cfg - k; ELSE v_cfg := v_cfg || jsonb_build_object(k, v_norm); END IF;
    END LOOP;
  END IF;

  UPDATE sites SET name = s.name, status = s.status, wordmark_text = s.wordmark_text, logo_url = s.logo_url,
         favicon_url = s.favicon_url, locale = s.locale, support_email = s.support_email, licence_line = s.licence_line,
         theme_tokens = s.theme_tokens, color_primary = s.color_primary, color_bg = s.color_bg, color_accent = s.color_accent,
         config = v_cfg
   WHERE id = p_site;

  -- cross-field rules on the resulting effective values
  v_eff := public.fn_brand_effective(p_site, false);
  IF (v_eff->>'limits.min_bet')::numeric > (v_eff->>'limits.max_bet')::numeric THEN RAISE EXCEPTION 'INVALID_SETTING:limits.min_bet:minimum bet is above the maximum bet'; END IF;
  IF (v_eff->>'limits.min_deposit')::numeric > (v_eff->>'limits.max_deposit')::numeric THEN RAISE EXCEPTION 'INVALID_SETTING:limits.min_deposit:minimum deposit is above the maximum deposit'; END IF;
  IF (v_eff->>'limits.max_withdrawal') IS NOT NULL AND (v_eff->>'limits.min_withdrawal')::numeric > (v_eff->>'limits.max_withdrawal')::numeric THEN RAISE EXCEPTION 'INVALID_SETTING:limits.max_withdrawal:maximum withdrawal is below the minimum'; END IF;
  IF (v_eff->>'limits.daily_withdrawal') IS NOT NULL AND (v_eff->>'limits.max_withdrawal') IS NOT NULL
     AND (v_eff->>'limits.daily_withdrawal')::numeric < (v_eff->>'limits.max_withdrawal')::numeric THEN RAISE EXCEPTION 'INVALID_SETTING:limits.daily_withdrawal:daily cap is below one withdrawal'; END IF;
  IF (v_eff->>'limits.default_bet')::numeric NOT BETWEEN (v_eff->>'limits.min_bet')::numeric AND (v_eff->>'limits.max_bet')::numeric THEN
    RAISE EXCEPTION 'INVALID_SETTING:limits.default_bet:starting bet must be between the minimum and maximum bet';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_eff->'limits.bet_chips') c WHERE (c #>> '{}')::numeric NOT BETWEEN (v_eff->>'limits.min_bet')::numeric AND (v_eff->>'limits.max_bet')::numeric) THEN
    RAISE EXCEPTION 'INVALID_SETTING:limits.bet_chips:every chip must be between the minimum and maximum bet';
  END IF;
  IF jsonb_typeof(v_eff->'limits.deposit_chips') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_eff->'limits.deposit_chips') c WHERE (c #>> '{}')::numeric NOT BETWEEN (v_eff->>'limits.min_deposit')::numeric AND (v_eff->>'limits.max_deposit')::numeric) THEN
    RAISE EXCEPTION 'INVALID_SETTING:limits.deposit_chips:every chip must be between the minimum and maximum deposit';
  END IF;
  IF (v_eff->>'plane.model') = 'custom' AND (v_eff->>'plane.image_url') IS NULL THEN RAISE EXCEPTION 'INVALID_SETTING:plane.image_url:upload an image for the custom plane'; END IF;

  v_after := public._brand_snapshot(p_site);
  -- diff: every changed leaf, {path: [old, new]}
  SELECT coalesce(jsonb_object_agg(path, jsonb_build_array(o, n)), '{}'::jsonb) INTO v_diff FROM (
    SELECT sec || '.' || key AS path, b.value AS o, a.value AS n
      FROM (VALUES ('identity'), ('theme_tokens'), ('config')) x(sec)
      CROSS JOIN LATERAL (SELECT key FROM jsonb_object_keys(coalesce(v_before->sec,'{}')) key UNION SELECT key FROM jsonb_object_keys(coalesce(v_after->sec,'{}')) key) k(key)
      LEFT JOIN LATERAL (SELECT (v_before->sec)->k.key AS value) b ON true
      LEFT JOIN LATERAL (SELECT (v_after->sec)->k.key AS value) a ON true
     WHERE b.value IS DISTINCT FROM a.value) q;

  IF v_diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('site_id', p_site, 'version', s.config_version, 'changed', false);
  END IF;

  v_ver := s.config_version + 1;
  UPDATE sites SET config_version = v_ver, updated_at = now(),
         withdrawals_enabled = coalesce((v_eff->>'features.withdrawals')::boolean, true),
         plane_skin = v_eff->>'stream.bird'
   WHERE id = p_site;
  INSERT INTO site_config_versions(site_id, version, snapshot, diff, note, changed_by)
    VALUES (p_site, v_ver, v_after, v_diff, nullif(trim(coalesce(p_note,'')), ''), auth.uid());
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'brand_saved', 'site', p_site::text,
            jsonb_build_object('version', v_ver, 'changed', (SELECT jsonb_agg(k2) FROM jsonb_object_keys(v_diff) k2)), p_site);
  RETURN jsonb_build_object('site_id', p_site, 'version', v_ver, 'changed', true, 'diff', v_diff);
END $$;

-- Restore an earlier version (as a new version, so history is never rewritten).
CREATE OR REPLACE FUNCTION public.admin_brand_rollback(p_site uuid, p_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_snap jsonb; v_cur jsonb; v_clear jsonb;
BEGIN
  IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT snapshot INTO v_snap FROM site_config_versions WHERE site_id = p_site AND version = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND'; END IF;
  -- keys present now but absent in the snapshot are cleared
  SELECT config INTO v_cur FROM sites WHERE id = p_site;
  SELECT coalesce(jsonb_object_agg(k, 'null'::jsonb), '{}'::jsonb) INTO v_clear
    FROM jsonb_object_keys(v_cur) k WHERE NOT (v_snap->'config') ? k;
  RETURN public.admin_brand_save(p_site, NULL, v_snap->'identity', coalesce(v_snap->'theme_tokens', '{}'::jsonb),
                                 v_clear || (v_snap->'config'), 'Restored version ' || p_version);
END $$;

-- Record the starting point of every existing brand as version 1.
INSERT INTO public.site_config_versions(site_id, version, snapshot, note)
SELECT id, config_version, public._brand_snapshot(id), 'Initial' FROM public.sites
ON CONFLICT (site_id, version) DO NOTHING;

-- Carry the old per-site bird into the new key (plane_skin now means "stream bird").
UPDATE public.sites SET config = config || jsonb_build_object('stream.bird', plane_skin)
 WHERE plane_skin IS NOT NULL AND NOT config ? 'stream.bird'
   AND EXISTS (SELECT 1 FROM brand_setting_defs d, jsonb_array_elements(d.options) o WHERE d.key = 'stream.bird' AND o->>0 = sites.plane_skin);
UPDATE public.sites SET config = config || jsonb_build_object('features.withdrawals', withdrawals_enabled)
 WHERE withdrawals_enabled = false AND NOT config ? 'features.withdrawals';

-- Every brand, however it was created, starts with a version-1 snapshot (rollback target).
CREATE OR REPLACE FUNCTION public._sites_initial_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO site_config_versions(site_id, version, snapshot, note, changed_by)
    VALUES (NEW.id, NEW.config_version, public._brand_snapshot(NEW.id), 'Created', auth.uid())
    ON CONFLICT (site_id, version) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._sites_initial_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sites_initial_version ON public.sites;
CREATE TRIGGER trg_sites_initial_version AFTER INSERT ON public.sites FOR EACH ROW EXECUTE FUNCTION public._sites_initial_version();

-- ── 9. live re-skin: broadcast {site_id, version} when a brand is saved ─────────────────────
CREATE OR REPLACE FUNCTION public._rt_brand_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime, pg_temp AS $$
BEGIN
  IF NEW.config_version IS DISTINCT FROM OLD.config_version OR NEW.status IS DISTINCT FROM OLD.status THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('site_id', NEW.id, 'version', NEW.config_version), 'brand', 'config', false);
    EXCEPTION WHEN OTHERS THEN RAISE LOG '_rt_brand_event: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._rt_brand_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rt_brand_event ON public.sites;
CREATE TRIGGER trg_rt_brand_event AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public._rt_brand_event();

-- ── 10. the public brand payload ─────────────────────────────────────────────────────────────
-- Host -> brand: exact hostname in site_domains (www. stripped too), else ?brand=<slug> preview of
-- an ACTIVE brand, else the default brand. Only public fields; never payment or owner data.
DROP FUNCTION IF EXISTS public.public_site_by_host(text);
CREATE OR REPLACE FUNCTION public.public_site_by_host(p_host text, p_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h text := lower(regexp_replace(coalesce(trim(p_host), ''), ':[0-9]+$', ''));
  v_site uuid; s sites; v_matched text := 'default';
BEGIN
  IF h <> '' THEN
    SELECT site_id INTO v_site FROM site_domains WHERE hostname = h OR hostname = regexp_replace(h, '^www\.', '') LIMIT 1;
    IF v_site IS NOT NULL THEN v_matched := 'domain'; END IF;
  END IF;
  IF v_site IS NULL AND nullif(trim(coalesce(p_slug, '')), '') IS NOT NULL THEN
    SELECT id INTO v_site FROM sites WHERE slug = lower(trim(p_slug)) AND status = 'active';
    IF v_site IS NOT NULL THEN v_matched := 'preview'; END IF;
  END IF;
  IF v_site IS NULL THEN v_site := '00000000-0000-0000-0000-000000000001'; END IF;
  SELECT * INTO s FROM sites WHERE id = v_site;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'site_id', s.id, 'slug', s.slug, 'name', s.name, 'status', s.status, 'matched', v_matched,
    'version', s.config_version, 'theme', s.theme, 'wordmark_text', s.wordmark_text,
    'logo_url', s.logo_url, 'favicon_url', s.favicon_url, 'currency', s.currency, 'locale', s.locale,
    'licence_line', s.licence_line, 'support_email', s.support_email, 'primary_domain', s.primary_domain,
    'theme_tokens', coalesce(s.theme_tokens, '{}'::jsonb),
    'config', public.fn_brand_effective(s.id, true),
    -- legacy fields read by builds before the brand runtime
    'color_primary', s.color_primary, 'color_bg', s.color_bg, 'color_accent', s.color_accent,
    'withdrawals_enabled', s.withdrawals_enabled, 'plane_skin', s.plane_skin);
END $$;

-- ── 11. brand lifecycle (platform tier) ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.platform_create_site(text, text, text, text);
CREATE OR REPLACE FUNCTION public.platform_create_site(
  p_slug text, p_name text, p_currency text DEFAULT 'KES', p_locale text DEFAULT 'en-KE',
  p_platform uuid DEFAULT NULL, p_theme_tokens jsonb DEFAULT NULL, p_config jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_slug text; v_role text; v_plat uuid; v_res jsonb;
BEGIN
  IF NOT public._is_platform_tier() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT role, platform_id INTO v_role, v_plat FROM profiles WHERE id = auth.uid();
  -- a platform admin creates brands inside its own platform only
  IF v_role = 'platform_admin' THEN
    IF p_platform IS NOT NULL AND p_platform <> v_plat THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    p_platform := v_plat;
  ELSIF p_platform IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platforms WHERE id = p_platform) THEN
    RAISE EXCEPTION 'PLATFORM_NOT_FOUND';
  END IF;
  v_slug := lower(trim(coalesce(p_slug, '')));
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN RAISE EXCEPTION 'INVALID_SLUG'; END IF;
  IF coalesce(trim(p_name), '') = '' OR length(trim(p_name)) > 60 THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM sites WHERE slug = v_slug) THEN RAISE EXCEPTION 'SLUG_TAKEN'; END IF;
  IF coalesce(p_currency, 'KES') <> 'KES' THEN RAISE EXCEPTION 'CURRENCY_UNSUPPORTED'; END IF;

  INSERT INTO sites (slug, name, currency, locale, platform_id, wordmark_text)
  VALUES (v_slug, trim(p_name), 'KES', coalesce(nullif(trim(p_locale), ''), 'en-KE'), p_platform, trim(p_name))
  RETURNING id INTO v_id;   -- version 1 is recorded by trg_sites_initial_version
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
  VALUES (auth.uid(), 'site_created', 'site', v_id::text, jsonb_build_object('slug', v_slug, 'name', trim(p_name), 'platform_id', p_platform), v_id);

  IF p_theme_tokens IS NOT NULL OR p_config IS NOT NULL THEN
    v_res := public.admin_brand_save(v_id, 1, NULL, p_theme_tokens, p_config, 'Initial look');
  END IF;
  RETURN jsonb_build_object('site_id', v_id, 'slug', v_slug, 'name', trim(p_name));
END $$;

DROP FUNCTION IF EXISTS public.platform_update_site(uuid, text, text, boolean, uuid, boolean);
CREATE OR REPLACE FUNCTION public.platform_update_site(
   p_site uuid, p_name text DEFAULT NULL, p_status text DEFAULT NULL, p_withdrawals_enabled boolean DEFAULT NULL,
   p_default_marketer_id uuid DEFAULT NULL, p_clear_default_marketer boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cfg jsonb := '{}'::jsonb; v_id jsonb := '{}'::jsonb;
BEGIN
  IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_name IS NOT NULL THEN v_id := v_id || jsonb_build_object('name', p_name); END IF;
  IF p_status IS NOT NULL THEN v_id := v_id || jsonb_build_object('status', p_status); END IF;
  IF p_withdrawals_enabled IS NOT NULL THEN v_cfg := jsonb_build_object('features.withdrawals', p_withdrawals_enabled); END IF;
  IF v_id <> '{}'::jsonb OR v_cfg <> '{}'::jsonb THEN
    PERFORM public.admin_brand_save(p_site, NULL, nullif(v_id, '{}'::jsonb), NULL, nullif(v_cfg, '{}'::jsonb), NULL);
  END IF;
  IF p_clear_default_marketer THEN
    PERFORM public.platform_assign_marketer(p_site, NULL);
  ELSIF p_default_marketer_id IS NOT NULL THEN
    PERFORM public.platform_assign_marketer(p_site, p_default_marketer_id);
  END IF;
  RETURN (SELECT to_jsonb(x) FROM (SELECT id AS site_id, name, slug, status, withdrawals_enabled, default_marketer_id FROM sites WHERE id = p_site) x);
END $$;

-- The marketer who owns a brand's audience (players without a referrer are attributed to them).
-- A marketer owns one brand. A marketer or player from another brand may be moved in only while
-- they have no referred players (their audience belongs to the brand they came from).
CREATE OR REPLACE FUNCTION public.platform_assign_marketer(p_site uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_from uuid; v_old uuid;
BEGIN
  IF NOT public._brand_can_edit(p_site, 'platform') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT default_marketer_id INTO v_old FROM sites WHERE id = p_site FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND'; END IF;
  IF p_user IS NULL THEN
    UPDATE sites SET default_marketer_id = NULL, updated_at = now() WHERE id = p_site;
  ELSE
    SELECT role, site_id INTO v_role, v_from FROM profiles WHERE id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
    IF v_role NOT IN ('marketer','player') THEN RAISE EXCEPTION 'NOT_A_MARKETER'; END IF;
    IF EXISTS (SELECT 1 FROM sites WHERE default_marketer_id = p_user AND id <> p_site) THEN RAISE EXCEPTION 'MARKETER_OWNS_ANOTHER_BRAND'; END IF;
    IF v_from IS DISTINCT FROM p_site THEN
      IF NOT public._can_admin_site(v_from) THEN RAISE EXCEPTION 'FORBIDDEN_SITE'; END IF;
      IF EXISTS (SELECT 1 FROM referrals WHERE marketer_id = p_user) OR EXISTS (SELECT 1 FROM profiles WHERE referred_by = p_user) THEN
        RAISE EXCEPTION 'MARKETER_HAS_PLAYERS';
      END IF;
      UPDATE profiles SET site_id = p_site WHERE id = p_user;
      UPDATE wallets SET site_id = p_site WHERE user_id = p_user;
    END IF;
    IF v_role = 'player' THEN UPDATE profiles SET role = 'marketer' WHERE id = p_user; END IF;
    PERFORM public._ensure_referral_code(p_user);   -- the brand's marketer always has a link to share
    UPDATE sites SET default_marketer_id = p_user, updated_at = now() WHERE id = p_site;
  END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details, site_id)
    VALUES (auth.uid(), 'site_marketer_set', 'site', p_site::text, jsonb_build_object('old', v_old, 'new', p_user), p_site);
  RETURN jsonb_build_object('site_id', p_site, 'default_marketer_id', p_user);
END $$;

-- Owner / platform brand list with KPIs (platform admins see their platform only).
DROP FUNCTION IF EXISTS public.platform_sites_overview();
CREATE OR REPLACE FUNCTION public.platform_sites_overview()
 RETURNS TABLE(site_id uuid, name text, slug text, status text, withdrawals_enabled boolean,
   default_marketer_id uuid, default_marketer_username text, created_at timestamptz,
   player_count bigint, marketer_count bigint, deposit_total numeric, ggr numeric,
   withdrawal_pending_count bigint, withdrawal_pending_total numeric, withdrawal_paid_total numeric, net_cashflow numeric,
   platform_id uuid, primary_domain text, theme_tokens jsonb, config_version int, logo_url text, plane_model text, stream_bird text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_plat uuid;
BEGIN
  SELECT p.role, p.platform_id INTO v_role, v_plat FROM profiles p WHERE p.id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('platform_superadmin','platform_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.status, s.withdrawals_enabled, s.default_marketer_id, dm.username, s.created_at,
    coalesce(pc.players, 0), coalesce(pc.marketers, 0), coalesce(tx.deposit_total, 0),
    coalesce(tx.bet_stakes, 0) - coalesce(tx.win_total, 0),
    coalesce(wr.pending_count, 0), coalesce(wr.pending_total, 0), coalesce(wr.paid_total, 0),
    coalesce(tx.deposit_total, 0) - coalesce(wr.paid_total, 0),
    s.platform_id, s.primary_domain, coalesce(s.theme_tokens, '{}'::jsonb), s.config_version, s.logo_url,
    coalesce(s.config->>'plane.model', 'classic'), coalesce(s.config->>'stream.bird', 'fisheagle')
  FROM sites s
  LEFT JOIN profiles dm ON dm.id = s.default_marketer_id
  LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE p.role = 'player') AS players, count(*) FILTER (WHERE p.role = 'marketer') AS marketers
                       FROM profiles p WHERE p.site_id = s.id) pc ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(t.amount) FILTER (WHERE t.type = 'deposit' AND t.status = 'completed'), 0) AS deposit_total,
                            coalesce(sum(abs(t.amount)) FILTER (WHERE t.type = 'bet'), 0) AS bet_stakes,
                            coalesce(sum(t.amount) FILTER (WHERE t.type = 'win'), 0) AS win_total
                       FROM transactions t WHERE t.site_id = s.id) tx ON true
  LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE w.status = 'pending') AS pending_count,
                            coalesce(sum(w.amount) FILTER (WHERE w.status = 'pending'), 0) AS pending_total,
                            coalesce(sum(w.amount) FILTER (WHERE w.status = 'completed' AND w.amount > 0), 0) AS paid_total
                       FROM withdrawal_requests w WHERE w.site_id = s.id) wr ON true
  WHERE v_role = 'platform_superadmin' OR s.platform_id = v_plat
  ORDER BY s.created_at ASC;
END $$;

-- The legacy single-purpose theme writer now goes through the audited, validated save.
CREATE OR REPLACE FUNCTION public.admin_set_site_theme(p_site_id uuid, p_theme_tokens jsonb DEFAULT NULL, p_plane_skin text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.admin_brand_save(p_site_id, NULL, NULL, p_theme_tokens,
    CASE WHEN p_plane_skin IS NULL THEN NULL ELSE jsonb_build_object('stream.bird', p_plane_skin) END, NULL);
END $$;

-- ── 12. grants ───────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._brand_inherit(text), public._brand_value(uuid,text), public._brand_num(uuid,text),
  public._brand_bool(uuid,text), public._brand_validate(text,jsonb,boolean), public._brand_validate_tokens(jsonb),
  public._brand_can_edit(uuid,text), public._brand_snapshot(uuid), public.fn_brand_effective(uuid,boolean),
  public._site_domains_sync_primary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._brand_value(uuid,text), public._brand_num(uuid,text), public._brand_bool(uuid,text),
  public.fn_brand_effective(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_brand_schema(), public.admin_brand_get(uuid), public.admin_brand_versions(uuid,int),
  public.admin_brand_save(uuid,int,jsonb,jsonb,jsonb,text), public.admin_brand_rollback(uuid,int),
  public.platform_create_site(text,text,text,text,uuid,jsonb,jsonb), public.platform_update_site(uuid,text,text,boolean,uuid,boolean),
  public.platform_assign_marketer(uuid,uuid), public.platform_sites_overview(), public.admin_set_site_theme(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_brand_schema(), public.admin_brand_get(uuid), public.admin_brand_versions(uuid,int),
  public.admin_brand_save(uuid,int,jsonb,jsonb,jsonb,text), public.admin_brand_rollback(uuid,int),
  public.platform_create_site(text,text,text,text,uuid,jsonb,jsonb), public.platform_update_site(uuid,text,text,boolean,uuid,boolean),
  public.platform_assign_marketer(uuid,uuid), public.platform_sites_overview(), public.admin_set_site_theme(uuid,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.public_site_by_host(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_site_by_host(text, text) TO anon, authenticated;

COMMIT;
