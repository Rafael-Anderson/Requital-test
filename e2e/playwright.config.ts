import { defineConfig, devices } from '@playwright/test';

// Critical-path foundation only (see tests/README below) — not full
// coverage. Serial, not parallel: the kanban spec advances the one seeded
// order's status, so letting specs race each other over shared fixture
// state would be a self-inflicted flake, not a real bug worth chasing.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: require.resolve('./global-setup.ts'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
