// TEMPORARY dev driver (Phase 15 visual verification) — opens each secondary window in a real
// browser and screenshots it. Not part of any gate; delete when the phase is done.
//
//   node scripts/ui-shots.mjs <base-url> <out-dir> [name...]
/* global localStorage, document */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OPENERS = {
  assistant: '#btnAssist',
  settings: '#btnSettings',
  help: '#btnHelp',
  mybookings: '#btnMine',
  allbookings: '#btnAll',
  stats: '#btnStats',
  admin: '#btnAdmin',
};

async function main() {
  const [url, outDir, ...only] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('mb_user', 'Kolmanovskyi'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#grid tbody tr', { timeout: 15000 });

  const names = only.length ? only : Object.keys(OPENERS);
  for (const name of names) {
    await page.evaluate(() => document.getElementById('overlay')?.classList.remove('open'));
    await page.click(OPENERS[name]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
  console.log(JSON.stringify({ outDir, names, errors }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
