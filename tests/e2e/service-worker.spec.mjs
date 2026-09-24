import { test, expect, openApp, routeExternal } from './fixtures.mjs';

// These tests run with the service worker on (the others block it).
test.use({ serviceWorkers: 'allow' });

const MODULE = '**/js/modules/state.js';

// Serves state.js with a marker line appended, standing in for a new deploy
// of that module. `delayMs` simulates a slow network.
function deployModule(context, marker, delayMs = 0) {
  return context.route(MODULE, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + `\nwindow.__deployMarker = ${JSON.stringify(marker)};\n`;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ response: res, body });
  });
}

const marker = (page) => page.evaluate(() => window.__deployMarker ?? null);

async function loadControlled(page) {
  await openApp(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test('a new deploy of a module is picked up on the next load', async ({ page, context, errors }) => {
  await routeExternal(context);
  await loadControlled(page);            // installs the worker and caches the modules
  expect(await marker(page)).toBeNull();

  await deployModule(context, 'v2');
  await page.reload();
  await openApp(page);
  // Stale-while-revalidate would serve the cached (pre-deploy) module here.
  expect(await marker(page)).toBe('v2');
  expect(errors).toEqual([]);
});

test('falls back to the cache when the network is slow', async ({ page, context }) => {
  await routeExternal(context);
  await deployModule(context, 'v2');
  await loadControlled(page);
  await page.reload();                   // now controlled: v2 is in the cache
  await openApp(page);
  expect(await marker(page)).toBe('v2');

  await context.unroute(MODULE);
  await deployModule(context, 'v3', 10_000);
  const started = Date.now();
  await page.reload();
  await openApp(page);
  expect(await marker(page)).toBe('v2'); // cached copy, not the slow v3
  expect(Date.now() - started).toBeLessThan(9_000);
});

test('boots offline from the cache', async ({ page, context, errors }) => {
  await routeExternal(context);
  await loadControlled(page);
  await page.reload();                   // let the worker cache everything it serves
  await openApp(page);

  await context.setOffline(true);
  await page.reload();
  await openApp(page);
  await expect(page.locator('canvas')).toBeVisible();
  expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e))).toEqual([]);
});
