import { defineConfig, devices } from '@playwright/test';

// Drives the real dev server rather than a stripped-down harness, so the tests
// run against the same cross-origin isolation headers the app needs in anger.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  // The meter opens audio devices; running specs on top of each other makes
  // the failures unreadable and occasionally invents its own.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // A microphone that is always there and always says the same thing.
            // Without this the meter could only ever be tested against silence,
            // which is the half that already worked.
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // The meter creates an AudioContext without a click behind it.
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
