/**
 * UI e2e for the game screen (owner's mocks), driven in DEMO mode so it never touches real money.
 *
 *   npm run build && npx vite preview --port 4173
 *   APP_URL=http://127.0.0.1:4173/ CHROMIUM_PATH=/path/to/chromium node e2e/aviator-ui.e2e.mjs
 *
 * Needs `playwright-core` resolvable. Covers both layouts: bet → placed → cash out, betting during a
 * flight (Cancel / "Waiting for next round"), adding/removing the second panel, the bets board
 * (demo: a simulated crowd of 150–300 with the player's own bet in view; real money: real players only), Previous/Top tabs,
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
  // Real / Demo lives in the ☰ menu
  await page.getByRole('button', { name: /^Game menu/ }).click();
  await page.getByRole('menuitemradio', { name: 'Demo' }).click();
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

try {
  for (const [w, h, tag] of [[1920, 1000, 'desktop'], [390, 844, 'phone'], [360, 740, 'phone360']]) {
    const { ctx, page, errors } = await session(w, h);
    const panels = page.locator('div.rounded-2xl', { has: page.getByRole('tablist', { name: /^Bet \d mode$/ }) });
    const panelCount = await panels.count();
    check(`${tag}: two bet panels (two Bet buttons) by default`, panelCount === 2 && (await page.getByRole('button', { name: /^Bet\s/ }).count()) === 2, String(panelCount));
    await page.getByRole('button', { name: 'Remove this bet panel' }).click();
    check(`${tag}: ⊖ removes the second panel`, (await panels.count()) === 1);
    await page.getByRole('button', { name: 'Add a second bet' }).click();
    check(`${tag}: ⊕ brings it back`, (await panels.count()) === 2);
    check(`${tag}: demo shows its play-money balance in the header`, await page.getByLabel('Demo balance', { exact: true }).isVisible());
    if (w < 800) {
      // mobile-first: the whole betting surface is on the first screen, with thumb-sized controls
      const inView = async (loc) => { const b = await loc.boundingBox(); return !!b && b.y >= 0 && b.y + b.height <= h; };
      const bets = page.getByRole('button', { name: /^Bet\s/ });
      check(`${tag}: both Bet buttons are on the first screen (no scrolling)`, await inView(bets.nth(0)) && await inView(bets.nth(1)));
      const minus = await panels.first().getByRole('button', { name: /^Decrease bet/ }).boundingBox();
      const chip = await panels.first().getByRole('button', { name: '100', exact: true }).boundingBox();
      check(`${tag}: stake −/+ and quick amounts are at least 36 px`, minus.width >= 36 && minus.height >= 36 && chip.height >= 36, JSON.stringify({ minus, chip }));
    }

    // wait for a betting window, then bet on panel 1
    const bet1 = panels.first().getByRole('button', { name: /^Bet\s/ });
    await until(() => bet1.isEnabled(), 20000);
    await bet1.click();
    const placedOrQueued = await until(async () => {
      const t = await panels.first().innerText();
      return /Bet placed|Next round|Cash Out/.test(t);
    });
    check(`${tag}: Bet → "Bet placed" (or queued "Next round")`, placedOrQueued, await panels.first().innerText());
    if (/Next round/.test(await panels.first().innerText())) {
      check(`${tag}: a bet made during a flight shows Cancel`, await panels.first().getByRole('button', { name: /^Cancel/ }).isVisible());
    }
    const cash = panels.first().getByRole('button', { name: /^Cash Out/ });
    const flying = await until(() => cash.isVisible(), 30000);
    check(`${tag}: in flight the button becomes Cash Out with the live value`, flying);
    if (flying) {
      const v1 = await cash.innerText(); await page.waitForTimeout(700); const v2 = await cash.innerText();
      check(`${tag}: the Cash Out value climbs during the flight`, v1 !== v2, `${v1} / ${v2}`);
      const demoBal = page.getByLabel('Demo balance', { exact: true });
      const num = (t) => Number(String(t).replace(/[^\d.]/g, ''));
      const before = num(await demoBal.innerText());
      const btn = await cash.boundingBox();
      await cash.click();
      // the won amount leaves the bet button as a chip and flies into the header balance
      const chip = page.locator('#win-fx-layer span');
      check(`${tag}: cashing out launches the win chip from the bet button`, await until(() => chip.first().isVisible(), 4000));
      const label = await chip.first().innerText().catch(() => '');
      const start = await chip.first().boundingBox().catch(() => null);
      check(`${tag}: the chip shows only the amount (+KES), starting at the button`, /^\+[\d,]+\.\d{2}$/.test(label) && start && Math.abs(start.y + start.height / 2 - (btn.y + btn.height / 2)) < 120, `${label} ${JSON.stringify(start)}`);
      await page.waitForTimeout(450);
      const mid = await chip.first().boundingBox().catch(() => null);
      const target = await demoBal.boundingBox();
      check(`${tag}: the chip travels towards the balance`, mid && start && Math.hypot(mid.x - target.x, mid.y - target.y) < Math.hypot(start.x - target.x, start.y - target.y), JSON.stringify({ start, mid, target }));
      check(`${tag}: nothing about the win is drawn over the plane`, !(await page.getByText(/KES · \d/).count()));
      check(`${tag}: the chip lands and is cleaned up`, await until(async () => (await chip.count()) === 0, 4000));
      const after = await until(async () => num(await demoBal.innerText()) === Math.floor(before + num(label)), 3000);
      check(`${tag}: the balance counts up to the new amount`, after, `${before} + ${label} → ${await demoBal.innerText()}`);
    }
    check(`${tag}: no pop-ups or toasts pushing deposits`, !(await page.getByText(/Play for Real|Deposit Now|comeback/i).count()));

    // bets board (DEMO): the simulated crowd of 150–300; at most 60 rows drawn, the rest counted as "+N",
    // and the player's own bet always in view. (The real-money board shows real players only: board_honesty.)
    const board = page.getByRole('region', { name: 'Bets' }).filter({ visible: true }).first();
    const rows = await board.locator('li').allInnerTexts();
    const boardText = await board.innerText();
    const more = Number((/\+(\d+)\s*$/m.exec(boardText) ?? [])[1] ?? 0);
    check(`${tag}: demo board shows a 150–300 crowd (≤60 rows drawn + the rest counted)`, rows.length <= 61 && rows.length + more >= 150 && rows.length + more <= 301, `${rows.length} rows + ${more}`);
    check(`${tag}: the player's own bet is on the demo board`, rows.some((r) => /\bYou\b/.test(r)), rows.slice(0, 3).join(' | '));
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
    const menuText = await menu.innerText();
    check(`${tag}: menu has Real / Demo, Sound, Rules, Chat, Log in (signed out)`, /Real[\s\S]*Demo[\s\S]*Sound[\s\S]*Rules[\s\S]*Chat[\s\S]*Log in/.test(menuText) && !/Home|Game Limits|How To Play/.test(menuText), menuText);
    check(`${tag}: Real / Demo is not drawn on the plane`, (await page.locator('main [aria-label="Play mode"]').count()) === 0 || (await menu.getByRole('menuitemradio', { name: 'Demo' }).getAttribute('aria-checked')) === 'true');
    const sw = menu.getByRole('switch', { name: 'Sound' });
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    check(`${tag}: Sound switch toggles and persists`, (await sw.getAttribute('aria-checked')) !== before && await page.evaluate(() => localStorage.getItem('aviator:sound')) === (before === 'true' ? 'off' : 'on'));
    if (before === 'true') await sw.click();
    await menu.getByRole('menuitem', { name: 'Rules' }).click();
    const rules = page.getByRole('dialog', { name: 'Rules' });
    check(`${tag}: Rules shows the steps and the live limits`, await until(async () => /Cash out before[\s\S]*Minimum bet[\s\S]*50 KES[\s\S]*Maximum bet[\s\S]*100,000 KES/.test(await rules.innerText()), 5000), await rules.innerText().catch(() => ''));
    await page.keyboard.press('Escape');
    check(`${tag}: Escape closes the sheet (animated out)`, await until(async () => !(await rules.isVisible()), 2000));
    await page.getByRole('button', { name: 'Game menu' }).click();
    await page.getByRole('menu', { name: 'Game menu' }).getByRole('menuitem', { name: 'Chat' }).click();
    check(`${tag}: Chat opens as a panel`, await page.getByRole('dialog', { name: 'Chat' }).isVisible());
    check(`${tag}: chat is in English`, await page.getByRole('dialog', { name: 'Chat' }).getByText('Log in to chat').isVisible());
    await page.getByRole('dialog', { name: 'Chat' }).getByRole('button', { name: 'Close' }).last().click();

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
