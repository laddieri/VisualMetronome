import { defineConfig, devices } from '@playwright/test';

// Smoke tests drive the real app in Chromium against `npm start`.
// CDN libraries are served from node_modules (see tests/e2e/fixtures.mjs),
// so the suite runs offline and doesn't depend on the CDN being up.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:9090',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:9090/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
