// ui-shots.mjs — open every secondary window in a real browser and screenshot it. The
// companion to ui-smoke.mjs: that one proves a page loads clean, this one shows what each
// dialog actually looks like, which is the only way to check a visual refactor (Phase 15,
// docs/UI_STYLE_GUIDE.md). Dev-only (Playwright is a devDependency, ARCHITECTURE §18); not
// part of `verify` — it needs a running Vite dev server.
//
//   npm run ui:shots -- <base-url> <out-dir> [name...] [--width N] [--height N] [--theme dark]
//
// Same Windows + git-bash path-rewriting gotcha as ui-smoke.mjs — wrap the docker call in
// `sh -c "..."` so MSYS doesn't rewrite the POSIX out-dir argument.
/* global localStorage, document */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

/** Each scene: how to reach it from the loaded grid.
 *
 *  READ-ONLY, WITHOUT EXCEPTION. The dev server proxies /api to the real backend, so a scene
 *  that clicks a confirm/delete/save button writes to live data — one earlier version of this
 *  file did exactly that and removed a booking. Every scene here may only open things; the
 *  confirm dialog is reached through the machine form's delete (which asks first) and is left
 *  unanswered. */
const SCENES = {
  main: async () => undefined,
  assistant: (p) => p.click('#btnAssist'),
  async settings(p) {
    await p.click('#btnMore');
    await p.click('#btnSettings');
  },
  async help(p) {
    await p.click('#btnMore');
    await p.click('#btnHelp');
  },
  mybookings: (p) => p.click('#btnBookings'),
  async bookingeditor(p) {
    await p.click('#btnBookings');
    await p.waitForSelector('#modal button[aria-haspopup="menu"]');
    const actionButtons = p.locator('#modal button[aria-haspopup="menu"]');
    for (let index = 0; index < (await actionButtons.count()); index++) {
      await actionButtons.nth(index).click();
      const edit = p.getByRole('menuitem', { name: 'Bearbeiten' });
      if ((await edit.isVisible()) && (await edit.isEnabled())) {
        await edit.click();
        await p.getByRole('heading', { name: 'Belegung bearbeiten' }).waitFor();
        return;
      }
      await p.keyboard.press('Escape');
    }
    throw new Error('No editable booking campaign found for the screenshot user');
  },
  async bookingeditormenu(p) {
    await SCENES.bookingeditor(p);
    await p.locator('#modal .booking-editor button[aria-label^="Aktionen für"]').first().click();
    await p.getByRole('menuitem', { name: /Auf Gruppenzeitraum setzen/ }).waitFor();
  },
  async favorites(p) {
    const machineId = await p.evaluate(() => {
      const visibleFavoriteToggle = document.querySelector('[data-fav]');
      const selectedId = visibleFavoriteToggle?.getAttribute('data-fav');
      if (!selectedId) throw new Error('No visible machine available for favorites verification');
      localStorage.setItem('mb_favs', JSON.stringify([selectedId, 'stale-machine-id']));
      localStorage.setItem('mb_collapsed', '[]');
      return selectedId;
    });
    await p.reload({ waitUntil: 'networkidle' });
    const header = p.locator('tr.grouprow').filter({ hasText: 'Favoriten' });
    await header.waitFor();
    if ((await header.locator('.gcount').textContent())?.trim() !== '1') {
      throw new Error('Favorites count did not ignore the stale machine ID');
    }
    if ((await p.locator(`[data-fav="${machineId}"]`).count()) !== 1) {
      throw new Error('Favorite machine was duplicated in its original group');
    }
  },
  async allbookings(p) {
    await p.click('#btnBookings');
    await p.getByRole('button', { name: 'Alle', exact: true }).click();
  },
  async stats(p) {
    await p.click('#btnMore');
    await p.click('#btnStats');
  },
  async admin(p) {
    await p.click('#btnMore');
    await p.click('#btnAdmin');
  },
  machinefilter: (p) => p.click('#machBtn'),
  async machineform(p) {
    await p.click('#btnMore');
    await p.click('#btnAdmin');
    await p.waitForTimeout(600);
    await p.click('#modal button:has-text("Bearbeiten")');
  },
  async statsdrilldown(p) {
    await p.click('#btnMore');
    await p.click('#btnStats');
    await p.waitForTimeout(900);
    await p.click('#stOut .statrow.click');
  },
  async bookingform(p) {
    await p.dblclick('#grid td.cell.free');
  },
  async bookingdetail(p) {
    await p.dblclick('#grid td.cell.booked');
  },
  /** The machine form's "Löschen" only opens the confirm dialog; nothing is answered here. */
  async confirm(p) {
    await p.click('#btnMore');
    await p.click('#btnAdmin');
    await p.waitForTimeout(600);
    await p.click('#modal button:has-text("Bearbeiten")');
    await p.waitForTimeout(600);
    await p.click('#modal button:has-text("Löschen")');
  },
  /** The menu opens on the mouseup that ends a drag — the same gesture a user makes. */
  async ctxmenu(p) {
    const cells = p.locator('#grid td.cell.free');
    const from = await cells.nth(0).boundingBox();
    const to = await cells.nth(2).boundingBox();
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await p.mouse.down();
    await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await p.mouse.up();
  },
  async emptybookings(p) {
    await p.evaluate(() => localStorage.setItem('mb_user', 'Niemand Ohne Buchung'));
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('#grid tbody tr');
    await p.click('#btnBookings');
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const flagIndex = argv.findIndex((a) => a.startsWith('--'));
  const positional = flagIndex >= 0 ? argv.slice(0, flagIndex) : argv;
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? Number(argv[i + 1]) : fallback;
  };
  const width = flag('--width', 1400);
  const height = flag('--height', 950);
  const themeIndex = argv.indexOf('--theme');
  const theme = themeIndex >= 0 ? argv[themeIndex + 1] : 'light';
  const [url, outDir, ...rest] = positional;
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('mb_user', 'Kolmanovskyi');
    localStorage.setItem('mb_theme', t);
  }, theme);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#grid tbody tr', { timeout: 15000 });

  const names = rest.length ? rest : Object.keys(SCENES);
  for (const name of names) {
    await page.evaluate(() => {
      document.getElementById('overlay')?.classList.remove('open');
      document.getElementById('confirm2')?.classList.remove('open');
      document.getElementById('machDrop')?.classList.remove('open');
      document.getElementById('groupDrop')?.classList.remove('open');
    });
    await SCENES[name](page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  console.log(JSON.stringify({ outDir, width, height, theme, names, errors }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
