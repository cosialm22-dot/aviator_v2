# Brands, skins, domains and payment accounts

This is the operator guide and technical reference for running many branded Aviator sites from one deployment. Each marketer gets their own brand: its own address, look, plane, words, limits and, if wanted, its own payment account. All brands share the same live game round. The design follows invest254 (docs 21, 35, 37, 41, 42 and 43), adapted to this stack: Supabase, a Cloudflare Worker and Vite/React.

## 1. Who can do what

There are five tiers of operator. The System owner (`platform_superadmin`) sees every brand, the shared game engine and the System's accounts. A platform admin (`platform_admin`) runs a platform, which is a group of brands. It can create and edit those brands, their domains, their payment accounts and their staff, but it never touches the shared engine. It works on one brand at a time; its current pick is stored on the server in `profiles.acting_site_id`. A brand owner (`super_admin`) runs one brand's staff, players and money, and edits the brand's own words, contacts, SEO, analytics and legal pages. Brand staff (`admin`, `finance_admin`, `support`) work inside one brand. Marketers and players never enter the back office.

The single source of truth for the UI is `src/admin/capabilities.ts` (`can(role, capability)`). The database enforces the same rules in every RPC and RLS policy. Every brand setting carries its own edit tier (`owner`, `platform` or `brand`) in `brand_setting_defs.edit_tier`.

| Action | Owner | Platform admin | Brand owner | Brand staff |
|---|---|---|---|---|
| Create a brand, pick its look / plane / bird / features / limits / bonuses | ✓ | own platform | — | — |
| Brand words, support contacts, social, SEO, analytics, legal pages | ✓ | own platform | own brand | — |
| Domains (add, options, remove) | ✓ | own platform | sees them | — |
| Payment accounts and go-live | ✓ | own platform and its brands | sees them | finance staff see them |
| Platforms and platform admins; Integrations (Cloudflare) | ✓ | — | — | — |
| Game control (live round, crash queue, rain) | ✓ | — | — | — |

## 2. Launching a marketer's brand, step by step

1. **Brands → New brand.** Give it a name. The address name (slug) is derived from the name and can be edited. Pick a look from the gallery. Find the marketer by name or phone and pick them. The brand is created with that look, the marketer becomes its owner-marketer (their referral code is created if missing), and you land on the Domains tab.
2. **Look.** Choose one of the 24 looks, or start from one of the 16 one-colour seeds. Fine-tune any colour; each colour shows a contrast hint. Set the fonts (35 curated Google fonts), heading weight, corner radius, logo and wordmark. The phone preview on the right redraws as you type.
3. **Plane & bird.** Pick one of the 10 aircraft (jet, propeller, biplane, fighter, stealth, rocket, cargo, glider, seaplane, supersonic), the original plane, or upload an image (PNG/JPEG/WebP, up to 2 MB, stored in the brand's own folder). Set the plane colours. Players always see the plane.
   - **Bird:** pick the streamer bird and its flight-line colour. A marketer who switches on streamer mode (for TikTok lives) sees the bird instead, so their stream never shows the plane. Use the preview's "Marketer live" toggle to see it.
4. **Content and Legal.** Set the tagline, sign-up title, fly-away line, announcement, support contacts, social links, SEO title, description and share image, and analytics IDs (GA4, GTM, Meta pixel, TikTok pixel). Write the terms, privacy and responsible-gambling pages, the operator/licence line and the minimum age.
5. **Features and Limits & bonuses.** These switches are enforced by the database, not just hidden in the app:
   - second bet, auto play, live bets, history, chat, demo, free bets, rain, promo codes, sign-ups, referrals, deposits, withdrawals, and a maintenance message;
   - bet chips and starting bet;
   - minimum and maximum bet, and the payout cap;
   - deposit and withdrawal limits, including a daily withdrawal cap and an auto-approve threshold;
   - welcome and first-deposit bonuses.
6. **Save.** All edits go out together as one versioned save with an optional note. Players' open pages re-skin within seconds. History shows every version with a field-by-field diff, and any version can be restored as a new one.
7. **Domains.** Add the domain (see §4). Follow the nameserver guide at the registrar. The rest is automatic.
8. **Payments.** By default the brand uses the System's Mega Pay account and nothing needs doing. For the brand's own account, see §5.
9. **Staff.** On People, appoint the brand owner and staff.

## 3. How a brand is resolved and drawn

Every request to the app goes through the Cloudflare Worker (`worker/index.ts`). It looks up the host with `public_site_by_host(host)`, and the result is cached at the edge for 60 seconds. The lookup order is an exact domain in `site_domains` (or `www.` on an apex that has www switched on), then an active brand named in `?brand=<slug>` (a preview link), then the default brand. For HTML pages the Worker writes the brand's CSS variables, fonts, title, description, theme colour, favicon, canonical link and `window.__BRAND__` into the page, so there is no flash of the wrong look and link previews are correct. It also serves a per-brand `manifest.webmanifest`, `robots.txt` and `sitemap.xml`, and answers `/__brand` with which brand the host serves, which is the health probe for domain automation. It redirects `www.<domain>` to `<domain>`, and a secondary domain to the primary when that option is on (301, keeping the path and query).

In the browser, `src/brand/runtime.ts` applies the brand and listens on the shared realtime topic `config` for `brand` events, so a save re-skins open pages. Theme tokens (invest254's keys) become CSS variables through `src/brand/tokens.ts`. The `:root` defaults are the classic look, so the default brand is pixel-identical to before.

Brand settings live in `brand_setting_defs`: 87 settings across 14 sections (look, plane, stream, copy, SEO, support, social, features, limits, bonuses, payments, legal, analytics, PWA). A brand stores only its overrides in `sites.config`. The effective value is the override, else the inherited platform value, else the default (`fn_brand_effective`). The console draws its forms from `admin_brand_schema()`, and `admin_brand_save` validates against the same rows, including bounds, patterns, options, cross-field floors and ceilings, and the edit tier. `scripts/sync_brand_settings.py` generates `src/brand/settings.generated.ts` from the database; a test fails if they drift.

## 4. Domains

Adding a domain runs the `brand-domains` edge function against Cloudflare (the account that runs the app's Worker). Each domain walks five steps, shown as a stepper on its card:

| Step | What happens | What you do |
|---|---|---|
| Added | The Cloudflare zone for the registrable domain is found or created (`lucky.co.ke` for `play.lucky.co.ke`) | Nothing |
| Nameservers | Until the zone is active, the card shows the two Cloudflare nameservers and the domain's current ones (read from public DNS) | At the registrar, set the two nameservers (Namecheap: Domain List → Manage → Nameservers → Custom DNS). Turn DNSSEC off first. If the domain receives email, add its MX records in Cloudflare before switching. |
| Connected | `<domain>` (and `www.<domain>` if chosen) is attached to the Worker as a Custom Domain; Cloudflare creates the DNS records and the certificate | If DNS records already sit on the name, the card lists them. "Replace these records" deletes only those A/AAAA/CNAME records. |
| HTTPS | Waiting for the certificate, usually 2–15 minutes | Nothing |
| Live | `https://<domain>/__brand` answers with this brand | Nothing |

"Check now" advances a domain immediately. Otherwise a pg_cron job (`brand_domains`, every 5 minutes) advances every pending domain, backing off from 2 minutes to an hour, and re-verifies live domains every 6 hours. When the nameservers match, the function asks Cloudflare to re-check at once. Namecheap's API needs a fixed, whitelisted IP address, which Supabase functions don't have, so the registrar step is guided rather than automatic.

Rules: a brand can have up to 10 domains, and the first one is primary. Removing a domain disconnects it from the Worker; its Cloudflare zone and any email records are left in place. A domain, or a subdomain of it, cannot be taken by a brand outside your scope, and the refusal never names the other brand. The owner can record a domain connected by hand, which is never touched in Cloudflare. The owner also sees "Domains on the app without a brand": Worker custom domains no brand claims yet, such as `printpesa.com` today. They can be assigned to a brand in one click.

Do not add `routes` or custom domains to `wrangler.jsonc`. With routes present, `wrangler deploy` manages the Worker's domain list itself and could detach the domains the console attached.

## 5. Payment accounts (payment scopes)

A brand's deposits go to its **payment owner**:

1. its own Mega Pay account, if live;
2. otherwise its platform's account, if live;
3. otherwise the System's account.

The System's account is the one saved on Payment accounts, or, when none is saved, the Mega Pay key in the server settings (the original setup). Brand and platform accounts are drafts until **Go live**. Go live requires a complete account, a passed connection test since the last change, and the production environment.

These rules are enforced in the database (migration `20260930096000_payment_scopes.sql`) and tested:

- **No mixing.** If a live brand or platform account goes missing, that brand's deposits close. They never fall back to someone else's account.
- **Verification uses the initiating account.** Each deposit records `payment_scope` and `integration_id`. The status check, the webhook and the minute-by-minute reconcile sweep verify each deposit with the account it was paid into.
- **Platform admins can't redirect verification.** The sandbox environment and the API address are System-owner-only.
- **A live account can't be switched off or deleted.** Stop using it first. Going live and stopping are audited.

Where to manage accounts: a brand's own account is on its Payments tab, and a platform's account and the System's are on Payment accounts. Brand owners and finance staff can see whose account their brand uses but cannot change it. The M-Pesa prompt reads "pay Kshs X to `<BUSINESS>` Account no. `<REFERENCE>`". The reference is the brand's "M-Pesa account name" setting (the brand name by default). The business name is set in the Mega Pay merchant account and cannot be changed through the API.

Payouts are approved in the back office and paid by the brand's finance staff. Automatic M-Pesa (B2C) payouts are not enabled; see BUGLOG "Needs the owner's decision".

## 6. Secrets

Provider credentials (Cloudflare API token, Mega Pay API keys) are stored only in Supabase Vault through `admin_integration_save`. The `integrations` row keeps the Vault id and a hint such as `••••a334`. No console RPC ever returns a secret; only the service role inside edge functions can read one. The inputs are write-only: leaving one empty keeps the stored value, and "Clear" removes it from Vault. Audit rows record which fields changed, never their values.

**After rotating the Cloudflare token**, paste the new one into Integrations → Cloudflare and press Test connection; until then, domain automation stops (domains already live keep working). Recommended least-privilege token: Account · Workers Scripts · Edit, plus Zone · Zone · Edit, Zone · DNS · Edit and Zone · Workers Routes · Edit for all zones in the account. The same applies to any Mega Pay key saved on Payment accounts. The server-settings key (`MEGAPAY_API_KEY` secret) is rotated in Supabase → Edge Functions → Secrets.

## 7. Reference

**Tables:**

| Table | Holds |
|---|---|
| `platforms` | Platforms |
| `sites` | Brands, with `config` overrides, `config_version` and `theme_tokens` |
| `site_config_versions` | Snapshots and diffs of each brand save |
| `brand_setting_defs` | The brand settings registry |
| `site_domains` | Domains and their provisioning state |
| `integrations` | Provider accounts (secrets live in Vault) |
| `payment_scopes` | Go-live switches |
| `mpesa_stk_requests` | Deposits, with `payment_scope` and `integration_id` |

**Edge functions:**

- `brand-domains`: add, check, replace, remove, unassigned, adopt, test, and the cron sweep.
- `megapay-stk-push`, `megapay-status`, `megapay-callback` and `megapay-reconcile`: scoped accounts.
- `megapay-admin`: status and test of the account a brand or scope uses.

The functions that authenticate themselves have `verify_jwt = false` in `supabase/config.toml`. Every caller action runs its RPCs as the caller's JWT, so the database decides.

**Tests** (all rolled back or cleaned up; safe on production):

| Area | Suites |
|---|---|
| SQL | `brand_config_e2e.py` (124), `domains_integrations_e2e.py` (71), `payment_scopes_e2e.py` (41), `admin_tenancy_e2e.py`, `megapay_gateway_e2e.py`, `megapay_admin_e2e.py` |
| Live | `e2e/brand_ui_e2e.py`, `e2e/brand_console_e2e.py`, `e2e/domains_live_e2e.py` (a real subdomain goes live and is removed), `e2e/payments_scope_live_e2e.py`, `e2e/admin_ui_e2e.py`, `megapay_functions_live_e2e.py` |
| Unit | vitest: capabilities, nav, brand tokens/looks/fonts/planes, the Worker's routing, the domain state machine against a fake Cloudflare, domain rules |
