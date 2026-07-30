import { defineConfig, devices } from '@playwright/test'

import { resolveChromiumPath } from './scripts/chromium'

/**
 * End-to-end, accessibility and content-integrity test configuration.
 *
 * BROWSER COVERAGE
 * ----------------
 * Chromium is the default project and is the only one enabled by default.
 * Firefox and WebKit are defined and are enabled by setting
 * `ARPI_E2E_ALL_BROWSERS=true`, which is how CI runs them when capacity allows.
 * Running three engines on every push would triple the slowest job in the
 * pipeline to catch defects that, for a static document site with no vendor-
 * prefixed CSS and no browser-specific JavaScript, are rare. The cost/benefit is
 * documented rather than assumed - portfolio/docs/ACCESSIBILITY.md section 7.
 *
 * SERVER
 * ------
 * The suite runs against a PRODUCTION build, started by `webServer` below. Not
 * the dev server: dev-mode React adds development-only DOM attributes and
 * warnings, the bundle differs, and an accessibility result from a dev build does
 * not describe what a visitor receives.
 */
const chromiumExecutable = resolveChromiumPath()
const allBrowsers = process.env.ARPI_E2E_ALL_BROWSERS === 'true'
const PORT = Number(process.env.ARPI_E2E_PORT ?? 3210)
const BASE_URL = `http://127.0.0.1:${String(PORT)}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list']],
  timeout: 45_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],

  webServer: {
    command: `npx next start -p ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      // The case-study gate is exercised with the flag OFF, which is its real
      // configuration. A test that only ever ran with the flag on would not be
      // testing the gate.
      NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED: 'false',
    },
  },
})
