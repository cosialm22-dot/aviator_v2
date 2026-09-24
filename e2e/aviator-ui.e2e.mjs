/**
 * UI e2e for the game screen (owner's mocks), driven in DEMO mode so it never touches real money.
 *
 *   npm run build && npx vite preview --port 4173
 *   APP_URL=http://127.0.0.1:4173/ CHROMIUM_PATH=/path/to/chromium node e2e/aviator-ui.e2e.mjs
 *
 * Needs `playwright-core` resolvable. Covers both layouts: bet → placed → cash out, betting during a
 * flight (Cancel / "Waiting for next round"), adding/removing the second panel, the bets board
 * (All Bets lists only real players — the demo engine's bots are never shown), Previous/Top tabs,
 * the round-history "…" panel, the ☰ menu (Sound, Game Limits, How To Play, Chat) and the footer.
 */
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !info ? '' : `  -- ${String(info).slice(0, 200)}`}`); };
const until = async (fn, ms = 15000, step = 200) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, step)); } return false; };

const opts = { executablePath: process.env.CHROMIUM_PATH || undefined, args: [] };
if (process.env.HOST_MAP) opts.args.push(`--host-resolver-rules=${process.env.HOST_MAP}`);
if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY, bypass: process.env.PROXY_BYPASS ?? '' };
const browser = await chromium.launch(opts);

async function session(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Demo' }).click();
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

try {
  for (const [w, h, tag] of [[1920, 1000, 'desktop'], [390, 844, 'phone']]) {
    const { ctx, page, errors } = await session(w, h);
    const panels = page.locator('div.rounded-2xl', { has: page.getByRole('tablist', { name: /^Bet \d mode$/ }) });
    const panelCount = await panels.count();
    check(`${tag}: ${tag === 'desktop' ? 'one bet panel (⊕ adds the second)' : 'two bet panels'} by default`, panelCount === (tag === 'desktop' ? 1 : 2), String(panelCount));
    if (tag === 'desktop') {
      await page.getByRole('button', { name: 'Add a second bet' }).click();
      check('desktop: ⊕ adds the second panel', (await panels.count()) === 2);
      await page.getByRole('button', { name: 'Remove this bet panel' }).click();
      check('desktop: ⊖ removes it again', (await panels.count()) === 1);
    }
    check(`${tag}: FUN MODE banner in demo`, await page.getByText('FUN MODE', { exact: true }).isVisible());

    // wait for a betting window, then bet on panel 1
    const bet1 = panels.first().getByRole('button', { name: /^Bet\s/ });
    await until(() => bet1.isEnabled(), 20000);
    await bet1.click();
    const placedOrQueued = await until(async () => {
      const t = await panels.first().innerText();
      return /Bet placed|Waiting for next round|Cash Out/.test(t);
    });
    check(`${tag}: Bet → "Bet placed" (or queued "Waiting for next round")`, placedOrQueued, await panels.first().innerText());
    if (/Waiting for next round/.test(await panels.first().innerText())) {
      check(`${tag}: a bet made during a flight shows Cancel`, await panels.first().getByRole('button', { name: /^Cancel/ }).isVisible());
    }
    const cash = panels.first().getByRole('button', { name: /^Cash Out/ });
    const flying = await until(() => cash.isVisible(), 30000);
    check(`${tag}: in flight the button becomes Cash Out with the live value`, flying);
    if (flying) {
      await cash.click();
      check(`${tag}: cashing out shows the result`, await until(async () => /Cashed out/.test(await panels.first().innerText()), 8000), await panels.first().innerText());
    }

    // bets board: only the player's own bet ("You"), never the demo bots
    const board = page.getByRole('region', { name: 'Bets' }).filter({ visible: true }).first();
    const rows = await board.locator('li').allInnerTexts();
    check(`${tag}: All Bets lists only real players (demo bots hidden)`, rows.length >= 1 && rows.every((r) => /\bYou\b/.test(r)), rows.join(' | '));
    check(`${tag}: footer says Powered by TRIOCODES`, /Powered by\s*TRIOCODES/.test(await board.innerText()) && !/SPRIBE/i.test(await page.locator('body').innerText()));
    await board.getByRole('tab', { name: 'Previous' }).click();
    check(`${tag}: Previous shows the round result`, await board.getByText('Round Result').isVisible());
    await board.getByRole('tab', { name: 'Top' }).click();
    check(`${tag}: Top has X / Win / Rounds and Day / Month / Year`, await board.getByRole('tab', { name: 'Rounds' }).isVisible() && await board.getByRole('tab', { name: 'Year' }).isVisible());
    await board.getByRole('tab', { name: 'All Bets' }).click();

    // round history strip "…"
    await page.getByRole('button', { name: 'Round history' }).click();
    check(`${tag}: "…" opens the round history`, await page.getByText('Round history', { exact: false }).first().isVisible());
    await page.getByRole('button', { name: 'Close round history' }).click();

    // ☰ menu
    await page.getByRole('button', { name: 'Game menu' }).click();
    const menu = page.getByRole('menu', { name: 'Game menu' });
    check(`${tag}: menu has Sound, Game Limits, How To Play, Chat, Home`, /Sound[\s\S]*Game Limits[\s\S]*How To Play[\s\S]*Chat[\s\S]*Home/.test(await menu.innerText()));
    const sw = menu.getByRole('switch', { name: 'Sound' });
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    check(`${tag}: Sound switch toggles and persists`, (await sw.getAttribute('aria-checked')) !== before && await page.evaluate(() => localStorage.getItem('aviator:sound')) === (before === 'true' ? 'off' : 'on'));
    if (before === 'true') await sw.click();
    await menu.getByRole('menuitem', { name: 'How To Play' }).click();
    check(`${tag}: How To Play opens`, await page.getByRole('dialog', { name: 'How To Play' }).isVisible());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Game menu' }).click();
    await page.getByRole('menu', { name: 'Game menu' }).getByRole('menuitem', { name: 'Game Limits' }).click();
    check(`${tag}: Game Limits shows the minimum bet`, /Minimum bet[\s\S]*KES 50\.00/.test(await page.getByRole('dialog', { name: 'Game Limits' }).innerText()));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Game menu' }).click();
    await page.getByRole('menu', { name: 'Game menu' }).getByRole('menuitem', { name: 'Chat' }).click();
    check(`${tag}: Chat opens as a panel`, await page.getByRole('dialog', { name: 'Chat' }).isVisible());
    await page.getByRole('dialog', { name: 'Chat' }).getByRole('button', { name: 'Close chat' }).last().click();

    check(`${tag}: no horizontal scroll`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
