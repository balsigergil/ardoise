// SPDX-License-Identifier: AGPL-3.0-only
import { sharedResolve } from '@ardoise/config/vitest';
import { defineConfig } from 'vitest/config';

/** Integration tests: Testcontainers (Postgres, Valkey, RustFS) + the Nest app in-process. */
export default defineConfig({
  resolve: sharedResolve,
  test: {
    name: 'integration',
    include: ['apps/*/test/integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
