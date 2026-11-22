// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests for critical journeys (ROADMAP). By default `stack.ts` starts a full stack
 * (Testcontainers + built server). Set E2E_BASE_URL to target a running, freshly
 * created stack instead (for example `docker compose up`), with E2E_SETUP_URL set to
 * the setup URL printed in its logs.
 *
 * Files run in name order on one worker: `01-journey` performs the first-run setup
 * that later files rely on.
 */
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3210}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './stack.ts',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
