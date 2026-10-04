// Browser (end-to-end) tests: `npm run test:e2e`. Starts the real
// server.js against a throwaway database (see e2e/server.js) and drives
// it in Chromium.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;

// The test server's throwaway data folder, chosen once per run. Set here
// (not in e2e/server.js) so the tests can reach it too, e.g. to plant a
// backup log; workers inherit it, so they all see the same folder.
process.env.CRAZYPHONE_E2E_DATA_ROOT ||= fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-e2e-'));

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.js',
  // Traces/screenshots of failed tests: in the temp folder, so a local run
  // leaves nothing in the app folder (the path is printed on failure).
  // CI keeps them in the checkout, where the workflow uploads them.
  outputDir: process.env.CI ? 'test-results' : path.join(os.tmpdir(), 'crazyphone-test-results'),
  // All specs share one server + database, and some tests watch live
  // updates across sessions, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node e2e/server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    env: { PORT: String(PORT), CRAZYPHONE_E2E_DATA_ROOT: process.env.CRAZYPHONE_E2E_DATA_ROOT },
    reuseExistingServer: false
  }
});
