// Browser (end-to-end) tests: `npm run test:e2e`. Starts the real
// server.js against a throwaway database (see e2e/server.js) and drives
// it in Chromium.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.js',
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
    env: { PORT: String(PORT) },
    reuseExistingServer: false
  }
});
