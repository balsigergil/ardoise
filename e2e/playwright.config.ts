// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests for critical journeys (ROADMAP). By default they run against the built web
 * app served by `vite preview`; set E2E_BASE_URL to target a running stack instead
 * (for example `docker compose up`).
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const previewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalBaseUrl ?? previewUrl,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          'pnpm --dir .. exec turbo run build --filter=@ardoise/web && pnpm --dir ../apps/web preview',
        url: previewUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
