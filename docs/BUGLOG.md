# Bug Log (aviator_v2)

Running log of bugs found while working through issues, with what was wrong, the evidence, and the fix or the decision it needs.

---

## #41 — Automatic M-Pesa payouts (Daraja B2C) and a correct withdrawal money path — DONE (branch `payouts/b2c`)
- **What was wrong:**
  - A withdrawal request held nothing: the player could keep betting the money it asked for.
  - "Approve" called the legacy `mpesa-b2c` function, which was never configured, debited a stale wallet column non-atomically, and could not complete a withdrawal.
  - So no withdrawal could ever be paid through the system.
- **Money path** (migration `20260930097000`; invest254 docs/08 §3, docs/33 and docs/43):
  - **Request:** the amount is **held** at once (real balance only, ledger `withdrawal_hold`, with the wallet row locked).
    - Requests at or below the brand's **auto-approve** limit from low-risk players (risk score ≤ 30) are approved on the spot.
    - They are also capped by a new brand **daily automatic budget**; past it, requests wait for review.
    - One open withdrawal per player. The player can **cancel** until it is sent; cancelling returns the money.
  - **Approved:** paid by M-Pesa B2C when the brand's **payment owner** has a tested B2C account. The payout owner is the same brand → platform → System order as deposits, so one owner's deposits are never paid out from another owner's account.
    - The new brand setting "Pay out automatically" can require staff to press **Pay** instead.
    - With no B2C account, staff pay by hand and record the **receipt**, which is checked for format and reuse.
  - **Sending:** the `payouts-worker` edge function is woken immediately through pg_net after commit, with a pg_cron tick every minute as backstop. It claims rows with `FOR UPDATE SKIP LOCKED` and writes one `payout_attempts` row **before** each B2C v3 request. Our OriginatorConversationID is that attempt's id.
  - **Answers** arrive at `payout-result`. The URL carries an HMAC-SHA256 token keyed from Vault. The ids in the body must match the attempt.
    - **Success** with the exact amount → paid; receipt and recipient name are stored; history row; lifetime total; the player is notified.
    - **Recipient cannot receive** (2040) → not paid; the money goes back; the player is told.
    - **Any other failure** (low float, bad initiator, refused request) → **needs attention**, with the money still held.
    - **Queue timeout** → still processing.
  - **No answer:** the attempt is **never resent automatically**. After 3 minutes the worker asks Safaricom (Transaction Status, by our id) every 5 minutes. After 60 minutes or 6 checks it is handed to staff, money still held. A later answer can still settle it.
  - **Staff actions:** retry, mark paid or return money. Each re-checks role, brand and state and is audited.
    - Retrying or refunding an attempt whose outcome is unknown requires ticking "I checked the M-Pesa statement: not paid".
    - If Safaricom later reports such an attempt paid, it raises a red **ALERT** that stays on the withdrawal and is counted on the page.
  - **Kill switch:** Controls → "Automatic payouts" pauses every automatic send; requests keep arriving and staff can still pay by hand.
- **B2C accounts** are a new provider (`mpesa_b2c`) in the integrations catalog at System, platform or brand scope. Fields: shortcode, initiator, payment type, consumer key and secret, security credential; the environment and API address are System-owner-only.
  - "Test connection" signs in to Daraja and asks for the **account balance**. Safaricom's answer (callback) marks the account tested and shows the float.
  - An account is used only after a passed test, and any change needs a new test.
- **Callback names:** they avoid words Safaricom filters (`payouts-worker`, `payout-result`).
- **Legacy removed:** `mpesa-b2c` and `mpesa-b2c-callback` are deleted, from the repo and from Supabase.
- **Console:**
  - The Withdrawals page is rebuilt. It shows how this brand is paid (automatic / on Pay / by hand, with the reason) and the rules.
  - KPIs: review, attention, to pay / sending, paid today, held. Tabs: Needs review, Needs attention, To pay, Sending, Paid, Declined & returned, All.
  - Actions follow the state. A detail view shows every M-Pesa attempt and the history. The sidebar badge counts review + attention.
  - The brand Payments tab shows how withdrawals are paid and holds the brand's B2C account.
- **Player:** the wallet says "On its way" when the payout is automatic. Profile → Payments lists withdrawals with plain status ("Being checked", "Sending to M-Pesa", "Paid", "Declined · money returned") and a Cancel button.
- **Tests:**
  - `supabase/tests/payouts_e2e.py`: **70 checks**.
  - `supabase/functions/_shared/daraja.spec.ts`: **15**. Covers request shapes, token caching, the sent-versus-unknown classification that forbids resending, and callback parsing on Daraja's sample bodies.
  - `e2e/payouts_live_e2e.py`: **28 live checks** against a Daraja stand-in deployed as a throwaway Cloudflare Worker (`e2e/mocks/daraja-mock.js`). Covers every outcome, the Transaction Status backstop, the console and the player. The stand-in is removed afterwards.
  - `bonus_wagering_e2e.sql` now expects the hold.
- **To turn it on for real:** see "Needs the owner's action".

## #40 — Test-fixture accounts removed from production — DONE
- On the owner's instruction ("delete the test fixtures"), the 15 fixed-id accounts committed by #32 were deleted.
- **Rows deleted:** 26 transactions, 36 ledger entries, 19 bonuses, 15 wallets, 3 referrals, 1 pending withdrawal of KES 800, 1 commission payout, 2 marketer expenses, 1 affiliate click, 1 risk score, 1 support conversation with 2 messages, and 4 audit rows.
- **Scope:** everything went in one transaction, after a full JSON backup was taken in the session. No other account referenced them.
- **Why it mattered:** the fake wallets had added about KES 8,100 of player liabilities to the finance totals.
- **Result:** `run_sql_tests.py` is back to **13/13**.

## #39 — Multi-brand: full verification on production, operator guide — DONE (branch `brand/p7-verify`)
- **Guide:** `docs/BRANDS.md` covers who can do what, launching a marketer's brand step by step, how a brand is resolved at the edge, domains (with the registrar step), payment accounts, secrets and rotation, and the reference.
- **Production run after the last deploy:**

  | Suite | Result |
  |---|---|
  | brand_ui (live Worker) | 46/46 |
  | brand_console | 25/25 |
  | domains_live | 27/27 |
  | payments_scope_live | 21/21 |
  | admin_ui | 47/47 |
  | megapay_ui | 59/59 |
  | mobile_ui | 61/61 |
  | game_live_ui | 24/24 |
  | demo UI | 88/88 |
  | engine_live | 29/29 |
  | megapay_functions_live | 21/21 |
  | brand_config | 124/124 |
  | domains_integrations | 71/71 |
  | payment_scopes | 41/41 |
  | admin_tenancy | 47/47 |
  | rls_tuning | 13/13 |
  | megapay_gateway | 35/35 |
  | megapay_admin | 35/35 |
  | push_channels | 7/7 |
  | vitest | 154/154 |

- **Fixed a flaky test:** `push_channels_e2e.py` picked "the latest" maintenance event. In one transaction every event has the same timestamp and a random id, so it sometimes read the `true` event. It now counts the new `false` event.
- **Still blocked:** 7 of `run_sql_tests.py`'s files fail with duplicate keys. Their fixed-id fixture accounts were committed by the #32 incident and are still in production; see "Needs the owner's action".

## #38 — Per-brand payment accounts (payment scopes) — DONE (branch `brand/p6-payments`)
- **Ask:** "for now, all brands share the same gateway, but add config where each brand can have its own gateway." This ports invest254 docs/43 (PAY-1).
- **Model** (migration `20260930096000`): a brand's deposits go to its **payment owner**. That is the brand's own Mega Pay account if it is live; otherwise its platform's account if that is live; otherwise the System's account. The System's account is the one saved on Payment accounts, or, when none is saved, the server settings (today's setup, unchanged).
  - A brand or platform account stays a draft until **Go live**. Go live needs a complete account, a passed connection test since the last change, and the production environment. Going live and stopping are audited.
- **Money-safety invariants** (all tested):
  1. **No mixing.** A live brand or platform whose account is missing closes deposits (`GATEWAY_NOT_CONFIGURED`, and the wallet shows deposits off). It never falls back to the System's account.
  2. **Verification uses the initiating account.** Every deposit records `payment_scope` and `integration_id`. The status check, the webhook and the reconcile sweep verify each deposit with the account it was paid into, even after that account is switched off.
  3. **A platform admin cannot redirect verification.** The environment (sandbox) and the API address are System-owner-only fields.
  4. **A live account can't be switched off or deleted.** Stop using it first.
  5. **Secrets are write-only** (Vault).
- **Edge functions:**
  - `megapay-stk-push` begins first (the database picks the account), then prompts with that account.
  - `megapay-status`, `megapay-callback` and `megapay-reconcile` resolve the account per deposit.
  - `megapay-admin` shows and tests the account a brand uses, or the account saved at a scope.
  - Platform admins are now recognised by these functions (they were refused before) and see only their platform's brands.
- **Console:**
  - The brand **Payments** tab shows where this brand's deposits go (with the order spelled out), the brand's own Mega Pay account, a go-live checklist and the switch, plus the prompt account name. Brand owners and finance staff see it read-only.
  - **Payment accounts** (`/admin/payment-accounts`): the owner sees the System's account and each platform's; a platform admin sees its own platform's, with every brand and where its money goes.
  - The **Deposits** page says which account the chosen brand uses.
  - **Integrations** now holds infrastructure only (Cloudflare).
- **Not in the catalog on purpose:** Daraja (STK or B2C). No live code path reads it, and a setting that is shown must be enforced. Payouts are approved in the back office and paid by the brand's finance staff. The legacy `mpesa-b2c` function is unconfigured in production and unsafe to enable as written (non-atomic debit of a stale column). See "Needs the owner's decision".
- **Tests:**
  - `supabase/tests/payment_scopes_e2e.py`: 41 checks.
  - `e2e/payments_scope_live_e2e.py`: 21 checks. It runs live in the browser; the only calls to Mega Pay are read-only credential checks with a wrong key, and no prompt is ever sent.
  - `megapay_functions_live_e2e.py` (21), `megapay_gateway_e2e.py` (35), `megapay_admin_e2e.py` (35) and `domains_integrations_e2e.py` (71) still pass.

## #37 — Brand domains, automated (Cloudflare), and a Vault-backed integrations store — DONE (branch `brand/p5-domains`)
- **Ask:** every marketer's brand on its own domain, with the domain set up from the admin (owner's choice: "Automate in admin"; Namecheap stays a guided step).
- **Integrations** (`integrations` table, migration `20260930095000`): one provider account per scope (System, a platform, or a brand).
  - Settings sit in the row. Secret values go only to Supabase Vault; the row keeps the Vault id and a hint (`••••a334`).
  - No console RPC ever returns a secret. Only the service role can resolve one (`svc_integration_resolve`: brand → platform → System).
  - Changing an account marks it untested. Saves are audited with the names of the fields that changed, never their values.
  - Cloudflare is System-only, because Worker custom domains must be in the Worker's own account. Step 6 adds the payment gateways to the same catalog.
- **Domains** (`site_domains` gains a provisioning state machine; edge function `brand-domains`, ported from invest254 `domains.ts` and moved from Pages to Worker Custom Domains). The steps:
  1. Find or create the Cloudflare zone for the registrable domain (`.co.ke` and similar suffixes are handled).
  2. While the zone is pending, read the domain's live nameservers over DNS-over-HTTPS and show them next to the two Cloudflare assigned. When they match, ask Cloudflare to re-check at once.
  3. Attach `<domain>` (and `www.<domain>`) to the app's Worker. Cloudflare creates the DNS records and the certificate.
  4. If a DNS record is in the way, stop and list it; nothing is deleted silently. "Replace these records" deletes only the listed A/AAAA/CNAME records on those exact names.
  5. Wait for HTTPS, then go live only when `https://<domain>/__brand` answers with *this* brand.
  - Every step is idempotent. "Check now", the add itself and a pg_cron sweep every 5 minutes all run the same `advance()`.
  - The sweep backs off (2 min doubling, to 1 h) and re-verifies live domains every 6 h. It authenticates with a Vault secret, so there is no environment secret to manage.
- **Rules (SQL, tested):**
  - What was typed is cleaned: scheme, path, port and `www.` are stripped. IPs, `workers.dev`, `pages.dev`, `supabase.co` and made-up TLDs are refused.
  - Up to 10 domains per brand. The first domain is primary. Removing the primary promotes another.
  - A domain, or a subdomain of it, can't be taken by a brand outside your scope, since it would share the Cloudflare zone. The refusal never names the other brand.
  - Owner and platform admin manage domains; the brand owner sees them read-only.
- **Edge:**
  - `/__brand` is the health probe.
  - `www.<domain>` redirects to `<domain>` (301, path and query kept). It can be switched to serving www instead.
  - A secondary domain can send visitors to the primary.
  - Redirecting also means one login session per brand, since browser storage is per origin.
- **Console:**
  - **Domains tab:** add with a live preview of what will be connected; five-step progress; guided nameserver step with copy buttons (Namecheap / GoDaddy / other, the DNSSEC warning, and the domain's current nameservers).
  - **Domain actions:** conflict review; options; Check now; Make primary; Remove (which detaches from Cloudflare). The tab refreshes itself while a domain is pending.
  - **Owner only:** "Domains on the app without a brand" lists Worker domains no brand claims (today `printpesa.com`) with "Assign to this brand"; a domain connected by hand can be recorded.
  - **Integrations page:** secrets are write-only and "Test connection" verifies the token and the Worker.
- **Tests:**
  - `supabase/tests/domains_integrations_e2e.py`: 71 checks.
  - `domains.spec.ts`: 20 checks: the state machine against a fake Cloudflare, request shapes, error words, and the suffix list kept equal to the SQL one.
  - `worker.test.ts`: 7 checks for redirects and the probe.
  - `domainRules.test.ts`: 8 checks.
  - `admin_ui_e2e.py`: owner Integrations checks.
  - `e2e/domains_live_e2e.py`: a real subdomain goes live and redirects, then is removed.
  - `brand_config_e2e.py`: its www check now uses an apex domain, because www applies only to a registrable domain.

## #36 — Brand console in the back office — DONE (branch `brand/p4-console`)
- **Brands page** (`/admin/brands`): one card per brand, drawn in its own colours, plane and bird, with its domain, marketer, status and config version.
  - A platform admin sees only its platform's brands; a brand owner goes straight to its own brand.
  - **New-brand wizard:** name and address → a look from the gallery → the marketer (searched by name or phone, scoped to the caller's platform). It creates the brand, assigns the marketer and lands on the Domains tab.
- **Brand page** (`/admin/brands/:id`), with tabs: Overview, Look, Plane & bird, Content, Features, Limits & bonuses, Payments, Domains, Legal, People, History. Status (active / suspended / disabled) is set on Overview.
  - Every form is drawn from `admin_brand_schema()`, so a new setting in the database appears in the console with its bounds, options and help text.
  - Fields the caller's tier cannot edit are shown read-only with the reason. Inherited values show where they come from and can be reset to inherit.
  - **Look:** 24 looks, 16 one-colour seeds, every token with a contrast hint, fonts, heading weight, radius, logo and wordmark.
  - **Plane & bird:** the 10-model library plus an uploaded image (brand-scoped storage), plane colours, the streamer bird and its flight line.
  - **Live preview:** a phone mock-up redraws as you type, switchable between the player's view (plane) and the marketer's streaming view (bird).
  - **Sticky save bar:** lists the unsaved changes and takes an optional note.
    - All edits go out as one versioned save.
    - A stale save is refused with a Reload offer.
    - Errors come back in plain words, named by the setting ("Minimum bet: …").
  - **History:** every version with who, when, note and a field-by-field diff; restore any version as a new one.
- **Platforms page** (`/admin/platforms`, owner only): create or suspend platforms and add or remove platform admins. A brand is moved between platforms from its People tab (owner only).
- **Navigation** now comes from the capability map. The Platform group holds Brands, Platforms and Controls (the old Platform page).
  - A platform admin sees Brands only.
  - A brand owner sees Brands and its own brand.
  - Neither sees Controls, Platforms or Game control.
- **Scope fixes:**
  - A platform admin starts on its first brand, and the pick is stored on the server.
  - The layout waits for the scope before rendering, so dialogs no longer close when the scope settles.
  - "All brands" is offered only to the owner.
- **Settings → Theme** now points to the brand console. The old theme panel is removed, and theme writes go through the same versioned save.
- **Tests:**
  - `e2e/brand_console_e2e.py`: 25 checks, live, as a real platform admin and a brand owner. It tears down its own fixtures.
    - Covers the list scope, a one-version save of look + plane + bird + words + switch + limit, the public payload, the history diff, plain-word validation, the stale-save refusal, restore, plane upload to the brand's folder, the wizard, and the brand owner's read-only look.
  - `admin_ui_e2e.py` 43/43; vitest 119/119 (nav and capabilities pinned).

## #35 — Brand skins in the player app, a plane library, and an edge renderer — DONE (branch `brand/p2-theming`)
- **One token contract, the whole UI themed:** a brand's `theme_tokens` (invest254's keys) become CSS variables (`src/brand/tokens.ts`).
  - Every colour on the game screen and on the sheets reads a brand variable: 36 hard-coded hexes are gone.
  - The `:root` defaults are today's exact values, so the classic brand does not change by a pixel.
  - Action colours stay recognisable on every brand: Cancel is red, Cash out amber, money won green.
  - Text on the call-to-action takes the readable ink for the brand colour (dark on gold, white on blue).
- **Type and shape:** each brand has title, body and number faces (35 curated Google fonts, the same list the server accepts), a heading weight and a corner radius.
- **24 complete looks** (`src/brand/themes.ts`, original identities, not copies of real sites):
  - Each look sets the palette, fonts, sky style (sunburst, soft rays, radar grid, stars or plain) and the flight-line, countdown, multiplier and fly-away colours.
  - It also sets the plane and its colours, and the streamer bird.
  - 16 seed presets derive a whole palette from one colour (ported `derivePalette`).
- **Plane library:** 10 drawn aircraft plus the original sprite and an uploaded image, tinted from the brand, with animated propellers and engine flames.
  - Models: jet, propeller, biplane, fighter, stealth, rocket, cargo, glider, seaplane, supersonic.
  - One set of SVG paths feeds the canvas (cached `Path2D` and gradients), the header mark and the generated favicon.
  - Players see the brand's plane. Marketers in streamer mode see the brand's bird (`stream.bird`), and can have their own flight-line colour.
- **Settings the app now honours:**
  - Features: second bet, auto play, live bets, history, chat, demo, free bets, rain, promo codes, sign-ups, deposits/withdrawals, sound default, maintenance message.
  - Bet chips and starting bet; deposit chips; withdrawal caps.
  - Copy: fly-away line, announcement, tagline, sign-up title.
  - Support: WhatsApp, Telegram, phone, email.
  - Social links, legal pages (`/legal/terms|privacy|responsible`, rendered as text only), the operator/licence line and minimum age.
  - SEO: title, description, share image, indexing.
  - Analytics: GA4, GTM, Meta and TikTok pixels.
  - Home-screen app name and icon.
  - A suspended brand shows only an "unavailable" notice on its own domain.
- **Edge renderer:** the Cloudflare Worker now runs `worker/index.ts` in front of the static app, for HTML and three generated files only.
  - It resolves the host's brand, cached 60 s at the edge.
  - It writes the brand's variables, fonts, title, description, theme colour, icon and canonical link into the HTML, and hands the brand over as `window.__BRAND__`: no flash of the default look, and correct link previews.
  - It also serves a per-brand `manifest.webmanifest`, `robots.txt` and `sitemap.xml`.
- **Live re-skin:** the page listens on the shared "config" channel (one subscription for the page) and re-applies a brand the moment it is saved.
- **Brand assets:**
  - Storage bucket `brand-assets`: public read, raster only (no SVG), 2 MB.
  - Writes are allowed only under the folder of a brand the caller may edit.
  - `features.referrals` now decides whether `?ref=` sign-ups are credited to that marketer.
  - The brand's marketer always gets a referral code.
- **Tests:**
  - `e2e/brand_ui_e2e.py`: 38 checks in the browser across looks, switches, limits, wallet, the unavailable screen and the untouched classic brand; with `BRAND_LIVE=1` it also covers the Worker pipeline.
  - `src/brand/brand.test.ts`: 14 checks. Every theme variable is covered; every look passes the server rules; CTA ink contrast is at least 4.3:1; web and server fonts match; every server plane model has a renderer.
  - `brand_config_e2e.py`: 124 checks, adding storage scope and the referral switch.
  - `scripts/sync_brand_settings.py --check`: the typed settings file matches the database.

## #34 — Multi-brand foundation: operator tiers, one brand-config contract, server-enforced brand limits — DONE (branch `brand/p1-foundation`)
- **Ask:** every marketer gets their own site with its own look (different planes; marketers stream a bird), every setting configurable per brand, roles and scope borrowed from invest254.
- **Tiers (from invest254 docs/41):** new `platform_admin` tier and `platforms` table. A platform admin runs a group of brands and works on one brand at a time. Its pick is stored on the server (`profiles.acting_site_id`, re-checked on every read), so every existing brand-scoped RPC and RLS policy serves it without being rewritten. `src/admin/capabilities.ts` is the capability map with `can()`, ported from invest254; `capabilities.test.ts` pins it.
- **One contract for brand settings:** `brand_setting_defs` holds 87 settings in 14 sections: look, plane, stream, copy, SEO, support, social, features, limits, bonuses, payments, legal, analytics and PWA. Each row carries its type, bounds, default, the platform value it inherits, whether players can see it, and who may edit it (`owner`, `platform` or `brand`). A brand stores only its overrides (`sites.config`). The console renders its forms from `admin_brand_schema()`, and `admin_brand_save` validates against the same rows.
- **Saves are versioned:** each save is checked against the version the editor loaded, so a stale save is refused. It writes a snapshot and a field-by-field diff (`site_config_versions`) and an audit row, and broadcasts `{site_id, version}` so open pages re-skin. `admin_brand_rollback` restores an old version as a new one.
- **Enforced by the database:**
  - Bets: `features.play`, `features.maintenance`, `features.two_bets` and `features.free_bets`, plus the minimum and maximum bet.
  - Payout cap: stored on the bet itself (`bets.max_payout`), so cash-out and the engine's auto cash-out pay under the cap that applied when the bet was placed.
  - Deposits: one guard, `fn_deposit_guard`, used by every rail.
  - Withdrawals: minimum, per-request cap, daily cap (Nairobi day) and auto-approve threshold.
  - Also: sign-ups, welcome and first-deposit bonuses, promo codes, rain and chat.
- **Public payload:** `public_site_by_host(host, slug)` matches the host in `site_domains` (ignoring `www.` and the port). `?brand=` previews active brands only. It returns only public settings, never payment or owner data.
- **Tests:** `supabase/tests/brand_config_e2e.py` has 115 checks across every tier, validation rule, bound, version, broadcast and enforcement path, and passes 115/115. `capabilities.test.ts` passes.

## #33 — Cross-brand holes in the back office — FIXED (same branch)
Found while auditing every role guard for the new tier:
- **Shared engine:** any brand's staff could read the crash queue (RLS `staff_read`) and the live crash point (`admin_current_round`), force a crash, recover rounds and start rain. The engine runs one round for every brand, so this is now owner-only.
- **Brand not checked:** `admin_adjust_balance_kind`, `admin_add_marketer_expense`, `fn_marketer_funnel`, `fn_marketer_ledger`, `fn_support_send` and `fn_support_escalate` checked the role but not the brand. A brand admin could move money for, or read, another brand's player or marketer.
- **RLS:** any brand's admin could read every brand's `affiliate_clicks`, `marketer_expenses`, `support_conversations` and `support_messages`.
- **Global writes:** any brand's owner could edit the global notification templates, commission rate and qualifying deposit. These are now owner-only.
- **Not assignable:** `finance_admin` and `support` could not be given to anyone (`admin_set_role` rejected them). They can now, within scope; only the owner or the platform admin can appoint a brand owner.
- **Also fixed:** `platform_update_site` accepted status `archived`, which the table's CHECK rejects. The vocabulary is now `active | suspended | disabled`.

## #32 — Test fixtures committed to production; the live game stalled for ~5 minutes — FIXED (process), cleanup pending the owner
- **What:** while running regressions I sent each `supabase/tests/*.sql` file on its own through the Management API.
  - Seven files end with `RAISE NOTICE … PASSED` and expect the caller to roll back. Sent alone, they committed.
  - One of them left a synthetic round (number 900101, betting open for 1 hour). The engine waited behind it from 13:06 to 13:11 UTC.
- **Fix now:** I deleted the synthetic rounds (900001–900003, 900101 and 996001) and the engine resumed at round 118839. No real bets were open during that window. The kill switches ended where they were, though with extra history rows.
- **Fix for good:** `supabase/tests/run_sql_tests.py` is now the only way to run those files. It wraps every file in `BEGIN … ROLLBACK` and refuses a file that contains `COMMIT`.
- **Stale tests also fixed:** phase 1 and 3 set the legacy `balance` column; the crash-queue test hit a foreign key on cleanup; the marketer-isolation test was flaky when the crash point landed between 1.5x and 2x. The three old Python e2e files re-applied their own migrations on top of newer ones; they now test the live schema, and `REAPPLY_MIGRATION=1` brings back the old mode.
- **Still to do (needs the owner's OK):** delete the 15 fixture accounts and their rows: player_t, admin_t, tester_p1–p3, accr_mktr, accr_player, mktr_one, admin_one, ref_a, ref_b, player_pc, promo_target, support_u, support_v. Until then, the test files that use those fixed ids cannot run.

## #31 — Admin back office and marketer hub on Apple's dark design language — DONE (branch `ui/apple-grade-admin`)
- **Tokens:** the admin colours were remapped to Apple system colours, with the same names so every page follows.
  - Black window and `#1c1c1e` cards; `#2c2c2e` controls; `#38383a` separators.
  - systemBlue for selection and primary buttons.
  - Green / red / orange / yellow for money in, money out, attention and platform-owner accents.
  - Text is `#f5f5f7` / `#a1a1a6` / `#86868b`, all AA on cards.
- **Kit (`admin/ui/kit.tsx`, same API):**
  - Cards have no borders. Page titles are 28 pt bold, section titles 15 pt semibold in sentence case, and stat labels 13 pt with 28 pt figures. No micro uppercase labels and no text under 11 pt.
  - Buttons are filled gray / blue / tinted red and orange; the ghost variant is blue text.
  - Tabs and pills became segmented controls; switches are the macOS 38×22 style.
  - Inputs are filled with a blue focus ring. Badges are pills. Tables have hairline rows and a quiet hover.
  - Modals are rounded, open with a spring, and close on Escape. Focus now goes to the first field instead of the × button, and it no longer jumps back when the page re-renders (a bug found during the rework).
- **Layout:**
  - The sidebar is macOS style: tinted icons, a blue filled selection, sentence-case group headings, a "Search ⌘K" field and a red pending-withdrawals badge.
  - The header is translucent and blurred. The scope banners are quieter.
  - The ⌘K palette looks like Spotlight.
- **Every page was converted to the kit**, with one `PageHeader` pattern. Hand-rolled headers, buttons, badges, modals and off-palette colours (amber / sky / slate / violet) were removed:
  - Overview, Deposits, Withdrawals, Finance, Players, player detail, Risk, Game control, Marketing and its tabs, Commissions, Promo codes, Notifications, Audit, Settings and its tabs, Platform console.
  - Game control now uses the full-width two-column layout: live round beside the queue.
  - Marketing tab actions (Refresh, New promotion) sit at the right end of the tab bar, and the embedded Commissions tab no longer repeats a page title.
  - Chart colours are Apple system colours.
- **Marketer hub** is on the player iOS kit, on the same page frame as Profile:
  - Nav bar "‹ Game" with Refresh.
  - A large available-balance figure with one Withdraw button.
  - Grouped rows for earnings, the referral link (Copy + share), referrals and payouts.
  - Withdraw as a sheet.
  - It never shows a `?ref=null` link: a missing code shows "Your link is being set up".
- **Tests:** `admin_ui_e2e.py` 43/43 (brand admin, support, finance, owner flows), `megapay_ui_e2e.py` 59/59 (includes the operator Deposits screen), unit tests 99/99. Screenshots of every admin page on desktop and phone were checked.

## #30 — Player UI rebuilt to Apple's dark design system; deposits return straight to the game — DONE (branch `ui/apple-grade`)
- **Deposit flow:** a confirmed deposit no longer stops on a "Deposit Confirmed" page, and the wallet doesn't stay open.
  - The sheet closes, the player lands on the game (from any page, e.g. Profile), and "+500.00" flies from the Deposit button into the header balance, which counts up as it lands.
  - A deposit M-Pesa hasn't confirmed yet also closes the wallet. A spinner stays on the balance until it rises, for at most 3 minutes.
  - A failed or refused payment still returns to the form with the reason.
- **Design system (the owner chose "Apple-grade dark"):** every player screen except the game now uses one kit, `components/ui/ios.tsx` plus the Tailwind `ios.*` colours and iOS text styles. That covers the wallet, register and log in, the ☰ menu, rules, free bets, my bets, notifications, chat and profile.
  - **Sources:** Apple Human Interface Guidelines. System dark colours (`#000` / `#1c1c1e` / `#2c2c2e`, label 60% / 30%, hairline separators). Default Dynamic Type sizes (Headline 17 semibold, Body 17, Subhead 15, Footnote 13, Title 2 22 bold, Large Title 34 bold).
  - **Controls:**
    - 44 pt rows and 50 pt primary buttons.
    - 32 pt segmented controls and 51×31 switches.
    - Filled text fields, and inset grouped lists with separators inset to the text.
    - Settings-style coloured icon squares.
  - **Sheets:**
    - Slide up from the bottom, with a grabber, a centred title and a round × button.
    - Can be dragged down to dismiss, and animate both in and out.
    - Become centred cards on tablets and desktop.
    - Lock the page scroll behind them.
  - **Menu:** an iOS material menu with a blurred card. Labels sit left and symbols right, groups are split by thick gaps, Real / Demo is a segmented control on top, and Log out is red.
  - **Chat:** iMessage-style bubbles, with the player's own messages on the right in green.
  - **Profile:** an iOS Settings layout. The nav bar has "‹ Game". Below it: a large avatar and name, a Wallet row (opens the wallet), a Stats | Payments switch, stats as grouped rows, and payments grouped by day with type icons. Bets and wins are left out of Payments (they're in My bets).
  - My bets are grouped by day, showing +win / −stake, the cash-out multiplier and where the round flew.
  - Browser spinners on number fields are hidden.
- **Tests:**
  - `megapay_ui_e2e.py` 59/59: a deposit started from Profile closes the wallet, lands on the game, and the amount flies into the balance.
  - `mobile_ui_e2e.py` 61/61, `aviator-ui.e2e.mjs` 88/88, `game_live_ui_e2e.py` 19/19, `admin_ui_e2e.py` 43/43, unit tests 99/99.

## #29 — Game froze when switching All Bets / Previous / Top; win shown on the plane; Real/Demo on the plane — FIXED (branch `fix/canvas-ui-wins`)
- **Root cause of the freeze:** during every flight the engines pushed the multiplier into React state about 15 times a second. That re-rendered the whole game screen each time: both bet panels, the history strip, and both bets boards (one was only hidden with CSS).
  - With the Top or Previous list open the tree was larger.
  - On a low-end phone, emulated with a 20x CPU throttle, the frame rate in flight fell to 7–9 fps with Top/Rounds/Year open, and each tab tap took 0.5–1.9 s. That reads as a frozen game.
  - It could not be seen on a desktop at full speed.
- **Fix:**
  - The multiplier now lives only in a ref. The canvas reads it every frame. Only the Cash Out value and the screen-reader status sample it on their own clock (`useLiveMultiplier`, 12 and 4 per second). React commits during a flight dropped from 15+/s to 4/s, and those remaining are a single hidden leaf.
  - The bets board and the history strip are memoised, and only one bets board is mounted (a media query instead of CSS `hidden`), so there is one set of queries instead of two.
  - On phones the board is part of the page scroll, with no nested scroller to trap touches.
  - The screen-reader status no longer announces every multiplier during the flight.
  - **Canvas:**
    - It skips the ~54 of 72 sunburst wedges that are off screen.
    - The trail glow is two translucent strokes instead of a Gaussian `shadowBlur` on a 96-point path.
    - If a frame costs over 9 ms on average (a slow phone), it switches for the session to 1x pixels and no blurs.
  - Same 20x-throttled test: in flight with Top/Previous open, 18–23 fps instead of 7–13, and taps respond immediately.
- **Real / Demo** moved from the plane into the ☰ menu (top, as a two-way switch). Picking one closes the menu.
- **Wins fly into the balance:** the "+KES · x" pill over the plane is gone. On a cash-out, the amount leaves that bet's button as a chip with a short trail of coins, arcs into the header balance, and the balance pulses and counts up as it lands, with a short haptic tick on Android.
  - It uses the Web Animations API on transform and opacity only, so it runs on the compositor and stays smooth even if the main thread is busy.
  - It respects reduced motion (no flight, the balance just updates).
  - The header holds a balance increase until the chip lands, so the number grows as the coins arrive.
- **Tests:**
  - `aviator-ui.e2e.mjs` 88/88 on 3 sizes: the chip starts at the button, shows only the amount, travels toward the balance, is cleaned up, and the balance counts to the exact new total. The Cash Out value climbs during the flight, and Real / Demo is in the menu.
  - `mobile_ui_e2e.py` 61/61: React commits during a flight with Top open, tab switches respond, Real / Demo in the menu.
  - `game_live_ui_e2e.py` 19/19, `megapay_ui_e2e.py` 57/57, unit tests 99/99.

## #28 — Jet roar when the plane flies away — DONE (branch `feat/flyaway-sound`)
- **Source:** "Jet Plane Flyby" by qubodup on Freesound (https://freesound.org/people/qubodup/sounds/189446/). It is CC0 public domain, taken from a U.S. Government video, so no licence fee and no attribution are required. The link is kept in `public/sounds/LICENSE.txt`.
- **Edit:** 3.0–9.0 s of the recording, sped up 2.2x so the pitch rises and it sounds like a fast climb. The roar hits within 0.3 s, then a 0.85 s fade. 2.7 s long, mono MP3, 22 KB.
- **Behaviour:**
  - Plays every round on the live flying → crashed change, in Real and Demo.
  - Does not play when a page opens on an already-crashed round.
  - Does not play in a background tab, or when Sound is off.
  - Replaces the old "loss" chime, which played only when a bet was riding.
  - Its volume is set to 0.3 so the sustained roar sits at the same loudness as the interface chimes.
- **Mobile audio unlock:** phones (iOS especially) block audio that no tap has started, so the fly-away sound would have stayed silent for anyone who hadn't bet yet. The first tap anywhere now loads every sound and plays each one muted for an instant, which unlocks them.
- **Tests:** `mobile_ui_e2e.py` checks four things: the first tap unlocks the sounds silently, the roar plays exactly once per crash, the file is served as audio (under 40 KB), and nothing plays with Sound off.

## #27 — Mobile-first player UI, fewer words, no pressure pop-ups — DONE (branch `ux/mobile-first`)
- **Target:** Kenya's phones. StatCounter, Aug 2026: 360x800 17.6%, 360x806 10.7%, 385x854 9.4%, 412x915 9.1%.
- **Before:**
  - On a 360 px phone the second Bet button was below the fold.
  - Stake −/+ were 19x24 px, and quick amounts and tabs were 24–28 px.
  - The countdown text was 8 px.
  - The Redeem button was cut off in the wallet.
- **Now:**
  - The first screen is history, the plane and both bet panels. The plane takes whatever height is left, and the bets list sits below.
  - Controls are 36–48 px.
  - No visible text is under 11 px.
  - There is no sideways scroll at 360, 385, 412, 768 or 1440 px.
- **Removed:**
  - Low-balance "Deposit now" pop-ups, including the invented "87% win on their comeback bet".
  - Demo "Play for Real" toasts every 3 rounds.
  - The random "players online" counter.
  - The rotating chat line under the plane.
  - "CASH OUT NOW!" and "Bet in - ready!" overlays, which repeated the button's own state.
  - The floating "Waiting for M-Pesa…" toast. A spinner now shows on the balance instead.
  - The bell dropdown. Notifications are now a dot on ☰ plus an inbox sheet.
  - Home, "Change Avatar" (no avatar editing exists) and the duplicate Game Limits / How To Play pages. They are merged into "Rules", with live limits.
  - The profile's Account and My Bets tabs (duplicates), the joined-date query, the M-Pesa method card, the long help lines, and the bolt.new og:image.
- **Notification model:** follows NN/g "Indicators, Validations, and Notifications" and Material snackbar guidance.
  - Passive events light an indicator (a menu dot).
  - Validation happens in context: a refused bet or cash-out shows in the button for 2.5 s, for example "Outside limits" or "Too late".
  - Action-required steps (the M-Pesa PIN) stay in the wallet sheet.
  - Nothing interrupts play.
- **Bug fixed:** a refused bet or cash-out failed silently (the promise was rejected and never handled). It now shows in the button.
- **Copy fixed:** the sign-up banner promised "KSh 500 free to start", but the server grants 200. The banner and wallet offer now come from `bonus_config` through `fn_public_payment_config` (migration `20260929090000`, which also returns the min/max bet and max win for Rules).
- **Single dialog system:** every dialog is a bottom sheet on phones and a centred card on larger screens, with Escape, backdrop tap and focus trapping. Chat is English throughout. Inputs are 16 px so iOS doesn't zoom. `touch-action: manipulation` is set, safe-area insets are respected, and reduced motion is honoured.
- **Efficiency:**
  - The chat stream (history query, realtime channel, bot timer) runs only while chat is open.
  - Inter now loads through `<link>` with preconnect instead of a render-blocking CSS `@import`, and one unused weight was dropped.
  - The app's own JS is 38.7 KB gzip, down from 42.3.
- **Tests:**
  - New `e2e/mobile_ui_e2e.py` (53/53): fit on 6 sizes, target sizes, text ≥ 11 px, the notification dot and inbox, sheets, wallet and register copy against the live offer, refused-bet feedback, and no pop-ups in demo.
  - `aviator-ui.e2e.mjs` 67/67 (now also 360x740).
  - `megapay_ui_e2e.py` 57/57.
  - `game_live_ui_e2e.py`, `admin_ui_e2e.py` 43/43.
  - Unit tests 99/99.

## #26 — Database after the Micro upgrade — MEASURED
- Compute moved from Nano to Micro on 2026-09-25 at the owner's instruction (1 GB RAM, `shared_buffers` 256 MB). The resize restarted Postgres once. The only errors in that window were the expected "shutting down" and "server restarted" messages, and one driver run cut short. Rounds resumed by themselves.
- **Same 5-minute method as #16:**

  | Measure | Original (Nano) | After indexes (Nano) | Micro + all of #18–#25 |
  |---|---|---|---|
  | Swap-in (pages a second) | 158 | 56 | 0 |
  | Major page faults a second | 335 | 127 | 29 |
  | Disk reads | 4.3 MiB/s | 2.3 MiB/s | 0.8 MiB/s |
  | CPU busy | 7.5% | 4.1% | 3.3% |
  | Free memory | 123 MB | — | 500 MB |
  | Buffer cache hit rate | — | — | 99.91% |

- **Database errors, last 2 hours, read clinically:** nothing is left unexplained.
  - Restart messages from the resize.
  - Expected rejections from the test suites: BETTING_CLOSED, BELOW_MIN, OPERATOR_CANNOT_DEPOSIT, the permission-denied checks.
  - 200 "permission denied for table game_rounds" in one 78-second burst at 00:13, from a browser tab still running the old bundle when the crash-time column was hidden. That bundle asked for the column. Pages load network-first through the service worker, so a reload fixes it, and none have occurred since.
  - About 90 seconds of timeouts at 00:23, while an early version of the RLS test held table locks. The test was rewritten so it no longer does that.

## #25 — Client delivery: bundle split, caching, pushes instead of polling — DONE (branch `perf/client-delivery`)
- **First load:**
  - The profile page, marketer hub, sign-in and wallet modals are loaded on demand. The two modals are prefetched when the browser is idle, so they still open instantly.
  - Vendor code is split into `vendor-react` (53 KB gzip), `vendor-supabase` (34 KB) and icons.
  - The app's own entry chunk is 42 KB gzip.
- **Repeat visits:** hashed files under `/assets/` were served `max-age=0, must-revalidate`, so every visit re-checked every file. `public/_headers` now makes them `immutable` for a year. Sounds and images are cached for a week. `index.html` and `sw.js` are never cached, so a deploy is picked up on the next load. Verified live with `curl -I`.
- **Maintenance flag:** it was polled from every open page. It is now fetched once and pushed on the broadcast topic `config` by a trigger on `system_settings` (migration `20260928120000`). A 5-minute safety poll remains.
- **Chat:** chat went through postgres_changes, so every message was WAL-decoded and RLS-checked once per open page. It now goes out on the broadcast topic `chat` (migration `20260928130000`), and `chat_messages` was dropped from the publication (migration `20260928140000`).
- **Notifications:** still postgres_changes, but now filtered to the player's own `user_id`, so the server doesn't evaluate other players' rows for every page.
- **Test:** `supabase/tests/push_channels_e2e.py` (7/7) checks both triggers on production inside a transaction that is rolled back, so no player sees a maintenance flash or a test chat line.
- **Note for multi-brand:** the `game` and `chat` topics are global. That is correct today: there is one brand, and `bets`, `game_rounds` and `chat_messages` are readable by everyone under RLS. A second brand with its own rounds would need per-brand topics (e.g. `game:<site_id>`).

## #24 — RLS and indexes (Supabase performance advisor) — FIXED (migration `20260928110000`)
- **Per-row policy calls:** 15 policies called `auth.uid()` or `_is_admin()` once per row. They are now wrapped in `(SELECT …)`, so Postgres evaluates them once per query.
- **Staff checks:** brand-staff checks compare `site_id` to a single `_staff_site()` value instead of calling `_can_admin_site(site_id)` for every row. Overlapping SELECT policies on withdrawals and STK requests were merged into one each.
- **Indexes added:** `crash_queue(round_id)` and `free_bets(used_round_id)`. Without them, the retention job scanned all of `crash_queue` for each round it deleted. A tiny partial index covers the live round.
- **Indexes dropped:** 7 duplicate or unused indexes on hot tables, including a DESC copy of the unique round-number index and the full status index. This means less write work on every round.
- **Proof:** `supabase/tests/rls_tuning_e2e.py` (12/12) seeds two brands and 8 callers, records every row each caller can see under the old policies, applies the new ones and compares. The results are identical.

## #23 — Server clock sync — DONE
- The multiplier is drawn from `now − started_at`. A phone whose clock ran 1.5 s fast showed 1.14x while the server was still at 1.00x.
- The client now estimates its offset from the server as NTP does, using `server_time()`: 4 samples, keeping the one with the fastest round trip, repeated every 5 minutes (`src/lib/serverClock.ts`, with unit tests).

## #22 — Engine timing — FIXED (full engine authorisation given 2026-09-25)
- **Before:** `game_drive` woke on a fixed interval, so a crash or take-off could be processed up to one interval late (250 ms or more).
- **Now:** `game_tick` returns when the next thing happens: close of betting, the crash instant, or the next auto cash-out. The driver sleeps exactly until then, clamped to 3 ms–1 s. It commits after waking, so `now()` is fresh.
- **Measured on production:** crashes are processed 3–4 ms after their secret instant, and take-off is stamped 3–4 ms after betting closes. `engine_live_e2e.py` checks both stay under 60 ms.

## #21 — Bot bets — REMOVED from the database ("keep, but make them free")
- About 80% of all row changes, and of the WAL behind them, were bot rows: 15–30 inserted, updated and deleted every round. They are no longer written, and the old rows were deleted.
- **Visible change: none.** Since #4, the bet list shows real players only, so nobody ever saw the bot rows.

## #20 — Realtime moved to Broadcast — DONE (migrations `20260928090000`, `20260928100000`)
- **Before:** rounds and bets went through postgres_changes, which decodes the WAL and runs RLS for every subscriber. Measured delivery was p50 about 500 ms and p90 750–870 ms.
- **Now:** triggers send exactly the public fields on the topic `game` (events `round` and `bet`), and the tables left the publication. Measured delivery is 27–43 ms, the same for 1 or 1,000 viewers.
- The client uses one channel and re-syncs over REST when it (re)connects. It no longer polls REST for every round; the UI test asserts this.

## #19 — P0: internal functions callable by anyone — FIXED (migration `20260928080000`)
- **What:** Supabase grants EXECUTE on every new public function to `anon` and `authenticated`. 241 SECURITY DEFINER functions were callable by anyone, including `crash_round`, `start_round`, `_wallet_move` and `_settle_flight`. With just the public key, anyone could end a round or move money.
- **Fix:** EXECUTE revoked from PUBLIC, anon and authenticated on every internal function; they are granted to `service_role` only. `ALTER DEFAULT PRIVILEGES` stops new functions from being exposed. Client RPCs now need an explicit GRANT.
- **Verified:**
  - anon calling `crash_round` gets 401.
  - anon calling `_wallet_move` gets 404.
  - The public config RPC still works.
  - Every UI suite passes.

## #18 — (was #17) crash time readable by players — FIXED
- `start_round` no longer writes `game_rounds.crashes_at`. The time lives only in `round_secrets`.
- Players and the public get column-level SELECT without `crashes_at` or the override fields.
- Broadcast events carry the crash point and seed only once the round has crashed.
- **Tests:**
  - `engine_live_e2e.py` asserts that reading the column is refused.
  - Every round event before the crash is checked for leaks.
  - The UI test confirms the stored row never carries the time.

## #17 — CRITICAL: the crash time of the live round is public — FIXED, see #18
- **What:** `start_round` writes `game_rounds.crashes_at` (when the plane will crash) at take-off.
  - `game_rounds` is readable by anyone (RLS `true` for anon and authenticated).
  - It is in the realtime publication, so every client also receives it at take-off.
- **Evidence:** round 116233 took off at 23:13:13.38. Anyone could read `crashes_at = 23:13:28.36` straight away, and the round crashed at 23:13:28.23 at 3.85x. A script can therefore cash out a tick before every crash and win every round.
- **Why it matters:** no real players have bet yet. The first player who notices can drain the house.
- **Proposed fix (engine, not yet made):**
  - stop publishing `crashes_at` and the override fields (`is_override`, `override_reason`, `source`, `queue_id`) to clients;
  - let the client learn about the crash from the crash event only;
  - keep `crashes_at` in `round_secrets`, where `game_tick` already reads it.

## #16 — Database kept running out of memory — FIXED (migration `20260927090000_db_memory_pressure`)
- **Symptoms, measured over 5 minutes:**
  - About 158 pages a second swapped in and 335 major page faults a second.
  - Disk was read at 4.3 MiB/s around the clock, about 6.8 TB since boot.
  - About 500 MB of the 1 GB swap was in use, with 123 MB of RAM free on a 426 MB machine.
- **Root cause:** two engine lookups had no index and read whole tables many times a minute.
  - `SELECT max(crashed_at) FROM game_rounds WHERE status='crashed'` runs on every tick of the 3-second pause after each crash: 1.35 million full scans, 76.7 billion rows read, 5,357 pages each time.
  - `max(position)` on `crash_queue` runs every round: 214,000 full scans.
  - Both tables grow by about 4,400 rows a day, so the load grew every day whatever else was tuned.
- **Fix:**
  - Partial and descending indexes were built concurrently, with no downtime and no engine code changed. Each lookup now reads 5 pages instead of 5,357.
  - The player "Top" tab got an index too.
  - Full scans of both tables dropped to zero.
- **Measured after, same 5-minute method:**

  | Measure | Before | After |
  |---|---|---|
  | Swap-in (pages a second) | 158 | 56 |
  | Major page faults a second | 335 | 127 |
  | Disk reads (MiB a second) | 4.3 | 2.3 |
  | CPU busy | 7.5% | 4.1% |

- **Errors fixed at the same time:**
  - `game_drive` looped for 3,600 s but was killed by the 120 s statement timeout. That produced about 720 "canceling statement due to statement timeout" errors a day, each cancelling a tick in flight. `game.driver_max_seconds` is now 110, so the loop ends cleanly; runs now finish as "succeeded" at 1:50.
  - The Deposits screen's gateway card sorted the whole cron history table. Under memory pressure it hit the 120 s timeout, which caused the only two 500 errors in the API logs. It now reads the newest run by primary key.
  - `prune_cron_logs` never removed runs that had no end time. It now falls back to the start time.
- **Still costing memory (owner's decisions):**
  - **The machine:** it is Nano (0.5 GB RAM), which is too small for Postgres plus the Supabase services on the same box. In a paid (Pro) organisation Nano is billed at the Micro price (1 GB), so upgrading to Micro doubles the RAM at no extra cost. It needs a restart of a few minutes.
  - **Bot bets:** 15–30 bot rows are inserted, updated and deleted every round. That is 7.85 million of the 9.7 million row changes since stats were reset, and each change goes through the WAL (7.8 GB so far) and realtime decoding. The top statement in `pg_stat_statements` is realtime's WAL reader (2,830 s, 280,000 calls). Turning bots off, or keeping them out of the realtime publication, would remove most of the remaining write load.
- **Other log findings (harmless):**
  - PostgREST's "Warp server error: Thread killed by timeout manager" (about 160 a day) is PostgREST closing idle keep-alive connections.
  - Every other error in the last 24 hours came from test runs and was expected.

## #15 — Admin dashboard, phase 1: shell, brand scope, Overview, Players, Audit, platform switches — DONE (branch `feat/admin-tenancy`)
- **Layout, modelled on the invest254 console:**
  - grouped navigation: Money / Players / Game / Growth / Administration / Platform;
  - a workspace header that always names the brand or "all brands";
  - ⌘K jump menu (same list as the sidebar), a collapsible icon rail (⌘/Ctrl+B), and a phone drawer;
  - one UI kit (`src/admin/ui/kit.tsx`): page header, stat cards that never cut figures, tables, pagination, empty, error and loading states, modal, two-step confirm, switch, tabs.
- **Brand scope:**
  - The platform owner picks "All brands" or one brand in the header; the choice is remembered.
  - A gold banner shows while looking at one brand.
  - Pages that don't follow the scope yet say so rather than silently mixing brands.
  - Everyone else is pinned to their own brand, and the server enforces it (`_admin_scope`).
- **Overview (rebuilt):**
  - Figures are computed on the server by `admin_overview`: Nairobi days, bots excluded, no 1,000-row cap. The old page added up capped client queries across every brand.
  - Contents: today's KPIs with change against yesterday, charts of money in and out and of players over 7, 14 or 30 days, a "Needs attention" queue with links, and balances owed to players.
- **Players (rebuilt):**
  - `admin_list_players` does the search (username, phone or id), status filters, account types and sorting on the server, with pagination and the full total.
  - Filters are kept in the URL; there is a CSV export.
  - The old page read `profiles` directly, so every brand saw every brand's players.
- **Audit log (new page):**
  - filters by action, staff member, date range and brand;
  - plain-language action names with the raw code;
  - a "Full record" view of each entry;
  - the log is read-only.
- **Brands & controls:**
  - the 5 platform switches (deposits, withdrawals, real-money betting, sign-ups, new marketers), each confirmed, versioned and audited; all 5 are enforced server-side;
  - "Open" on a brand scopes the back office to it;
  - the invalid "Archived" status is replaced by "Disabled".
- **Tests:**

  | Test | Result |
  |---|---|
  | `admin_tenancy_e2e.py` (rolled back) | 47/47 |
  | `e2e/admin_ui_e2e.py` (live brand tiers + mocked platform owner) | 42/42 |
  | `megapay_ui_e2e.py` re-run | 56/56 |
  | vitest | 90/90 |

## #14 — Multi-tenant security gaps (from #7) — FIXED (migration `20260926090000_admin_tenancy`)
- **Global controls belong to the platform owner:** `admin_set_setting` (game, finance, maintenance) and the crash-queue RPCs were allowed for any `super_admin`. They are now platform owner only.
  - **Effect today:** the aviator brand's `super_admin` can no longer change platform-wide game settings or queue crash points. The platform owner can.
- **Staff tables are read-only:**
  - Direct writes are gone on `admin_audit_log`, `withdrawal_requests`, `player_risk_scores`, `crash_queue` and `system_settings`. The catch-all `admin_full_access` policies are dropped and INSERT/UPDATE/DELETE are revoked from API roles.
  - The audit trail can no longer be edited or deleted by staff.
- **M-Pesa paybill:**
  - `mpesa_config` is no longer readable through the API. The old Payments tab downloaded the passkey, consumer secret and security credential into the browser.
  - `admin_get_mpesa_config` returns only "saved" flags.
  - `admin_save_mpesa_config` is platform owner only, validated, and audited with secret names only.
- **Missing brand checks added:**
  - promotions (create now tags the brand; edit, switch and delete check it);
  - `admin_get_mpesa_detail`;
  - `admin_set_site_theme` (a brand owner themes only their own brand).
- **Support role fixed:** support can read players, risk alerts and the live round, and the player page is view-only for them. Before, the UI showed support pages that the server refused.
- **One owner per brand:** `uniq_one_super_admin` (one in total) is now `uniq_one_super_admin_per_site`.
- **Audit rows land on the right brand:** rows written without a brand went to the default brand. A trigger now attributes them to the target player's brand, or else to the acting staff member's brand.
- **Settings:**
  - the General, Game, Finance and paybill tabs show only for the platform owner; brand owners keep Theme and Staff;
  - Game control hides the queue controls from everyone except the platform owner.
- **Applying it:** production takes every lock up front, in one statement with a timeout, because the game driver's long transaction caused a deadlock on the first test run. The game kept running throughout.
- **Still open (phase 2):**
  - Withdrawals, Finance, Risk, Marketing, Promo codes, Notifications and Game control do not follow the brand picker yet. The page says so.
  - Role lists in Staff and player detail are stale: finance_admin and support can't be assigned, because `admin_set_role` rejects them.

## Observation — game driver "fails" every 2 minutes — RESOLVED (#16: runs now end cleanly at 110 s; #22: event-driven)
- `cron.job_run_details` shows `game_driver` ending with "canceling statement due to statement timeout" about 720 times a day. `game_drive()` sleeps in a loop until the 2-minute statement timeout stops it, and the next run picks up. Rounds keep flowing.
- This looks like the intended design, but it fills the cron history with failures and holds locks for long stretches. It is in the engine, so I left it alone.

## #13 — Deposits screen for operators — DONE
- **Sections:**
  - gateway health: a live connection test and the automatic-check status (booleans only);
  - deposit limits: editable by the platform owner only, because they apply to every brand; read-only for everyone else;
  - brand KPIs: credited today, 7-day success rate, waiting, unconfirmed, needs attention. The platform owner sees all brands or picks one.
- **The list:**
  - filters: All / Needs attention / Waiting / Unconfirmed / Credited / Failed;
  - search by phone, receipt or id;
  - phones are masked, and each row has details and "Check now".
- **"Confirm payment":** for unconfirmed deposits, or prompts that never got a Mega Pay answer.
  - It needs the M-Pesa receipt, a reason and a confirmation tick.
  - It is allowed for finance_admin and above, on their own brand only.
  - It works once per deposit and once per receipt, is audited, and is refused for amount mismatches.
- **Access:** support can view but not confirm; players can't open the screen.

## #12 — Staff could write deposit rows directly — FIXED (branch `feat/megapay-gateway`)
- **What:** `mpesa_stk_requests` had policy `admin_full_access` (ALL) for any staff on the brand, including support. A staff member could insert or edit a deposit row (amount, Mega Pay id), and the reconcile job would credit the row's amount once Mega Pay reported that id as paid.
- **Fix:** staff now have read-only access to their own brand's rows (`admin_read_site`), and INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated`. Rows are written only by the edge functions (service role). Staff changes go through the audited `fn_admin_megapay_manual_credit`.
- **Also:** when Mega Pay reports a paid amount that differs from the row, nothing is credited. The row is flagged `AMOUNT_MISMATCH` and listed under Needs attention.
- **Verification:** `megapay_admin_e2e.py` (grants and policy checks) and `megapayRuntime.test.ts`.

## #11 — A brand admin's "check now" swept every brand — FIXED
- **What:** `megapay-reconcile` called by any staff member settled every brand's waiting deposits and returned platform-wide counts.
- **Fix:** the cron job and the platform owner still sweep everything. A brand's staff sweep only their brand, and the platform housekeeping counts are hidden from them.
- **Verification:** live e2e "another brand's admin sweep skips this brand's deposit and hides platform totals".

## #10 — Daraja deposits never worked in production — REPLACED by Mega Pay
- **Evidence:**
  - no Daraja secrets are set;
  - `mpesa-stk-callback` is deployed with verify_jwt on, so Safaricom would get 401;
  - it writes `result_desc` and `callback_payload`, which don't exist (the live column is `result_description`);
  - `mpesa-stk-push` trusts a `user_id` sent in the request body.
- **Decision:** player deposits now go through Mega Pay (`payments.deposit_provider = megapay`). The Daraja functions are left deployed but unused. Withdrawals still use `mpesa-b2c`, and that is untouched here.

## #9 — The cashier's minimum was KES 50 in the app — FIXED
- **What:** `WalletModal` hard-coded `MIN_DEPOSIT = 50`, so the app's rule could differ from the server's.
- **Fix:** limits come from `fn_public_payment_config()` (KES 100 – 150,000 today), and the quick amounts follow them. The platform owner sets them in Deposits → Deposit limits.
- **Also fixed:** typing or pasting `07…`, `254…` or `+254 …` into the phone field used to cut the number short. It now keeps the 9 local digits.

## #8 — Mega Pay integrated as the deposit gateway — DONE (branch `feat/megapay-gateway`)
- **Credentials:** the same Mega Pay account as invest254 (production `/backend/v1`). They are held as function secrets; the key is never sent to the browser and the email is masked in the admin view.
- **Flow:**
  1. `megapay-stk-push` takes `{amount, phone}`. The player comes from the session.
  2. `fn_megapay_begin` validates and records the deposit before Mega Pay is called.
  3. The prompt goes out.
  4. The app polls `megapay-status`. The server asks Mega Pay and `fn_megapay_settle` credits exactly once: row lock, final-state check, and a unique receipt.
- **Why polling:** Mega Pay's webhook is set per account and points to invest254, so aviator settles by polling instead:
  - the `megapay_reconcile` cron job runs every minute;
  - a deposit is shown as "Unconfirmed" after 15 minutes and still checked for 3 days;
  - `megapay-callback` exists, but it only re-queries Mega Pay and never trusts the body.
- **Player app:**
  - a "Check your phone" screen with the number, the amount and a live timer;
  - "Close — I'll keep playing";
  - clear messages for a cancelled payment or a server refusal;
  - "Waiting for M-Pesa" when Mega Pay hasn't confirmed yet.
- **Operators:** a new Deposits screen (`/admin/deposits`). Details: see #13.
- **Tests, all passing:**

  | Test | Result |
  |---|---|
  | `megapay.test.ts` + `megapayRuntime.test.ts` | 16/16 |
  | `megapayClient.test.ts`, `deposits.test.ts`, phone | unit tests pass |
  | `megapay_gateway_e2e.py` | 35/35, rolled back |
  | `megapay_concurrency_e2e.py` (8 simultaneous settles × 5 → one credit each) | 5/5 |
  | `megapay_admin_e2e.py` | 35/35, rolled back |
  | `megapay_functions_live_e2e.py` (live HTTPS, throwaway users, read-only Mega Pay calls) | 21/21 |
  | `e2e/megapay_ui_e2e.py` (browser: cashier on desktop and phone, Deposits for admin, support and player) | 56/56 |

- **Not yet done:**
  - **Automatic checks:** they need two vault secrets (see "Needs the owner's action"). Until then, deposits settle while the player waits in the app, and when staff press "Check waiting deposits now".
  - **No real payment made yet:** no real payment has gone through end to end. The first KES 100 deposit should be made by the owner.

## #7 — Found while building the admin tools (multi-tenant) — OPEN, for the admin dashboard work
- **One super_admin in total:** `uniq_one_super_admin` allows a single `super_admin` across all brands, so a second brand cannot have its own owner.
- **Global settings writable by a brand's super_admin:** `_is_super_admin()` includes a brand's `super_admin`, which gates `admin_set_setting`, `system_settings` (policy ALL) and `mpesa_config`. A brand owner can change settings that apply to every brand. The new payment settings RPC is limited to the platform owner.
- **Audit log is editable by staff:** `admin_audit_log` has policy `admin_full_access` (ALL), so staff can edit or delete audit rows for their brand.
- **Staff can edit withdrawal rows directly:** `withdrawal_requests` has policy ALL for brand staff, not just through RPCs.
- **Crash queue:** `crash_queue` has policy ALL for brand staff. This ties to the owner's decision on queued results.

---

## #6 — Only one Bet button on desktop — FIXED (branch `ui/two-bet-panels`)
- **Reported:** the mock has two bet panels (two Bet buttons) everywhere; desktop showed one, with ⊕ to add the second.
- **Fix:** both panels are shown by default on every screen size. ⊖ on the second removes it and ⊕ on the first brings it back.
- **Verification:** `e2e/aviator-ui.e2e.mjs` passes 38/38.

## #5 — Game screen rebuilt to the owner's mocks (UI) — FIXED (branch `ui/aviator-mock`)
- **Bet panels:**
  - Bet / Auto tabs, a stepper, 2×2 quick amounts and one big button that goes Bet → Cancel ("Waiting for next round") → Cash Out (live value) → Bet.
  - Auto adds Auto Play (with its limits) and an Auto Cash Out switch.
  - ⊕ adds and ⊖ removes the second panel. By default there are two on phones and one on desktop, as in the mocks.
- **Bets board:** the All Bets / Previous / Top tabs.
  - **All Bets:** a header with the bet count, total win and cashed-out bar, and pill rows (green when won).
  - **Previous:** the "Round Result" card.
  - **Top:** X / Win / Rounds × Day / Month / Year, with a card for each winning bet (bet, win, result, round max).
  - **Layout:** a left rail on desktop; on phones it sits under the bet panels as one scrolling page.
  - **Footer:** "Powered by TRIOCODES".
- **Round history strip:** multipliers are coloured blue under 2x, purple from 2x to 10x and pink from 10x. A "…" button opens the full history.
- **☰ game menu:** player card with Change Avatar, a Sound switch, Free Bets (with a count), My Bet History, Game Limits, How To Play, Chat, the account links and Home.
- **Sounds:** CC0 Kenney sounds (`public/sounds/LICENSE.txt`) for bet placed, cash out and flew away.
- **Tests:**
  - `e2e/aviator-ui.e2e.mjs`: 36/36 at 1920 px and 390 px, run in demo mode.
  - Unit tests 56/56, including the new `betBoard.test.ts`.
  - `npm run typecheck` is clean.

## #4 — Bet lists showed bot bets as players — FIXED (display)
- **What:** at every round start the server inserts bot bets (`_seed_bots(round, crash_point)`, `is_bot = true`). The All Bets and Previous lists showed them as players; the demo engine does the same with simulated players.
- **Evidence:** the public API currently returns 24 bot bets and 0 real bets.
- **Fix:** the board lists and counts only rows with `is_bot = false`. Other players' names are masked ("d***8"); your own rows show "You".
- **Effect:** until real players bet, All Bets is empty. The bots are still created server-side, and that is the owner's call.

## #3 — The waiting screen claimed "UFC × Aviator official partners" and "SPRIBE official game" — FIXED
- **What:** `GameCanvas` drew `partners-ufc-aviator.png` between rounds.
- **Why it matters:** the game is not a Spribe game or a UFC partner, and the owner asked for no Spribe branding.
- **Fix:** the artwork and its drawing code are removed. The waiting screen now shows only the label, the loader and the countdown.

## #2 — The Bet / Cash Out button was missing; typecheck failed — FIXED
- **What:** commit `cc32801` removed the primary button from both panels. Live production (`index-lxQlAr9E.js`) had no way to bet or cash out, and `npm run typecheck` failed on the props it left unused.
- **Fix:** the button is back in the mock's design.

## #1 — `npm ci` failed (lock file out of sync); one unit test red — FIXED
- **Lock file:** `react-router-dom` was missing from `package-lock.json`. It was refreshed with `npm install`.
- **Unit test:** the canvas glow started at deep purple, but the mock is blue under 2x ("flew away 1.91x") and purple at 2.37x. The blue → purple → red stops are restored, and `canvasMotion.test.ts` passes again.

---

## Needs the owner's action
- **After rotating credentials:** paste the new Cloudflare API token into Admin → Integrations → Cloudflare and press Test connection. Domain automation uses the token saved there (in Vault), not the environment. Domains already live keep working without it. A least-privilege token is listed in `docs/BRANDS.md` §6.
- **`printpesa.com`** is attached to the app but no brand claims it, so it shows the default brand. Assign it from any brand's Domains tab ("Domains on the app without a brand") if it belongs to a marketer.
- **Delete the 15 committed test-fixture accounts (#32):** DONE (#40).
- **Turn on automatic payouts (#41):** you need a Safaricom Daraja app with the B2C product on a bulk payment (B2C) shortcode. In Admin → Payment accounts → The System → M-Pesa payouts (Daraja B2C), enter the shortcode, the initiator name, the consumer key and secret, and the security credential (the initiator password encrypted in the Daraja portal). Then press Test connection. When the balance shows, approved withdrawals are paid automatically. Until then staff pay by hand and record the receipt. Keep the B2C float topped up: a low float sends payouts to Needs attention.
- **Automatic deposit checks:** DONE on 2026-09-25. Both vault secrets were created at the owner's instruction, and a test call through pg_net to `megapay-reconcile` returned HTTP 200.
- **Authorise the fix for #17:** DONE. Authorised on 2026-09-25 and fixed (#18).
- **Upgrade the compute from Nano to Micro:** DONE on 2026-09-25 (#26).
- **Rotate the credentials used in this session**, as planned.
- **Make one real KES 100 deposit** from a player account to confirm the whole path with real money.

## Needs the owner's decision (not changed)
- **Demo is rigged:** `useDemoGame` / `riggedCrashPoint` set the demo win rate to about 80% (`DEMO_WIN_RATE`), with near-misses on losses, "to drive conversion to real play". Real rounds use an 18% house edge (`game.house_edge_percent`).
- **Results can be set by operators:** when `game.queue_enabled` is on, operators can queue crash points (`crash_queue`). Those rounds still get a committed seed hash, so a player cannot tell them apart. The menu and footer therefore carry no "Provably Fair" claim.
- **Bot chat:** the chat panel still mixes scripted bot messages in with real ones (owner chose to keep them, 2026-09-25). They no longer appear on the game screen.
- **Name and logo:** the game is called "Aviator", and the header wordmark imitates Spribe's logo.
