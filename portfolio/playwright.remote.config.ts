import { defineConfig, devices } from '@playwright/test'

import { resolveChromiumPath } from './scripts/chromium'

/**
 * Remote smoke configuration: the suite that runs against a DEPLOYED site.
 *
 * WHY THIS IS A SEPARATE CONFIG
 * -----------------------------
 * `playwright.config.ts` starts a local production server through `webServer` and
 * points the suite at `127.0.0.1`. That is right for the accessibility,
 * navigation and design-system suites — they test the application. It is wrong for
 * the questions this config exists to ask, which are all about the DEPLOYMENT:
 *
 *   - are the canonical URLs, the sitemap and the Open Graph tags on the Railway
 *     domain, rather than on `localhost`?
 *   - do the security headers survive the platform's router?
 *   - is the case study still locked on the thing that is actually served?
 *
 * None of those can be answered against a local server, because a local server is
 * exactly the environment where a `localhost` origin would look correct.
 *
 * There is deliberately no `webServer` here. If `ARPI_REMOTE_BASE_URL` is not set,
 * the suite skips rather than silently testing something else.
 *
 *   ARPI_REMOTE_BASE_URL=https://arpi-portfolio-staging.up.railway.app \
 *     npx playwright test --config playwright.remote.config.ts
 */
const chromiumExecutable = resolveChromiumPath()
const baseURL = process.env.ARPI_REMOTE_BASE_URL?.replace(/\/+$/, '')

export default defineConfig({
  testDir: './tests/remote',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A deployed site is reached over the internet, so one retry absorbs a dropped
  // connection without hiding a real failure: a genuine defect fails twice.
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report-remote' }],
        ['list'],
      ]
    : [['list']],
  // Longer than the local suite's 45s. A cold start on a shared platform is not a
  // defect, and a flake here would be read as a broken deployment.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    ...(baseURL !== undefined ? { baseURL } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The deployment is served over HTTPS with a platform-issued certificate. A
    // certificate error is a real finding, so verification stays on.
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: 'remote-chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    {
      // A real mobile viewport, because two of the required checks — mobile
      // navigation and horizontal overflow — are meaningless at desktop width.
      name: 'remote-mobile',
      use: {
        ...devices['Pixel 7'],
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
  ],
})
