import { test as base, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P5_PATH = require.resolve('p5/lib/p5.js');
const THREE_PATH = require.resolve('three/build/three.min.js');

// Every test gets a page with the app loaded and a list of the errors it
// logged. CDN scripts are answered from node_modules (same versions as
// index.html); the phone-remote libraries and web fonts are stubbed out —
// the app already guards against those being missing.
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure
  errors: async ({}, use) => { await use([]); },

  page: async ({ page, errors }, use) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.route(/^https?:\/\/(?!localhost)/, (route) => {
      const url = route.request().url();
      if (/cdnjs\.cloudflare\.com\/.*\/p5\.js$/.test(url)) return route.fulfill({ path: P5_PATH });
      if (/cdnjs\.cloudflare\.com\/.*three\.min\.js$/.test(url)) return route.fulfill({ path: THREE_PATH });
      if (/cdnjs\.cloudflare\.com\//.test(url)) return route.fulfill({ body: '', contentType: 'text/javascript' });
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.fulfill({ body: '', contentType: 'text/css' });
      return route.abort();
    });
    await use(page);
  },
});

export { expect };

// Loads the app and waits for p5's setup() — the point at which every
// control listener is wired and saved settings have been restored.
export async function openApp(page) {
  await page.goto('/index.html');
  // setup() is synchronous, so once its canvas exists it has finished.
  await page.waitForSelector('canvas');
  // Let the first frames and any restore-triggered re-renders settle.
  await page.waitForTimeout(300);
}

// Sets a control the way a user would (value + the event its handler
// listens for), including controls tucked away in closed modals.
export function setControl(page, id, value, event = 'change') {
  return page.evaluate(([id, value, event]) => {
    const el = document.getElementById(id);
    if (typeof value === 'boolean') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  }, [id, value, event]);
}

export function controlValues(page, ids) {
  return page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const el = document.getElementById(id);
    return [id, el.type === 'checkbox' ? el.checked : el.value];
  })), ids);
}
