// ui-smoke.mjs — drive the running app with a real headless browser and report what it
// found. Dev-only (Playwright is a devDependency, ARCHITECTURE §18); not part of `verify` —
// it needs a running Vite dev server (and usually a throwaway backend behind it), so it's a
// manual step in the per-slice loop, the same role the project's browser smokes have always
// played (CLAUDE.md's "quick browser smoke of the touched behavior").
//
// Usage:
//   node scripts/ui-smoke.mjs <url> <screenshot-path> [--wait-for <css-selector>]
//
// Prints the console/page errors it saw (empty array = clean) and the screenshot path, then
// exits 0. A thrown error (e.g. the selector never appeared) exits non-zero.
//
// Windows + git-bash host gotcha: invoking this through `docker exec <container> npm run
// ui:smoke -- /tmp/...` directly rewrites the POSIX-looking /tmp/... path argument to a
// Windows path before Docker ever sees it (MSYS's automatic path conversion). Wrap the
// whole thing in `sh -c "..."` instead: `docker exec <container> sh -c "npm run ui:smoke
// -- http://localhost:5173 /tmp/shot.png --wait-for '#grid'"`.
import { chromium } from 'playwright';

function parseArgs(argv) {
  const [url, screenshotPath, ...rest] = argv;
  if (!url || !screenshotPath) {
    throw new Error(
      'Usage: node scripts/ui-smoke.mjs <url> <screenshot-path> [--wait-for <selector>]',
    );
  }
  const waitForFlagIndex = rest.indexOf('--wait-for');
  const waitForSelector = waitForFlagIndex >= 0 ? rest[waitForFlagIndex + 1] : null;
  return { url, screenshotPath, waitForSelector };
}

async function main() {
  const { url, screenshotPath, waitForSelector } = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10000 });
  }
  await page.screenshot({ path: screenshotPath });

  console.log(JSON.stringify({ screenshotPath, consoleErrors }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
