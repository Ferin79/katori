import { defineConfig, devices } from '@playwright/test';

// Regression suite for the "Testing before delivery" checklist (PLAN.md). Runs against a fresh
// test instance: KATORI_DB=test.db with seeded fixtures and KATORI_AI=fake. Build first.
const PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'iPhone 15', use: { ...devices['iPhone 15'], browserName: 'chromium' } }],
  webServer: {
    command: `node scripts/test-server.mjs --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { KATORI_DATA_DIR: 'data/e2e', KATORI_FAKE_DELAY_MS: '600', KATORI_RETRY_BASE_MS: '300', KATORI_LOG_LEVEL: 'warn' },
  },
});
