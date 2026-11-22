// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

/** Unit tests (the default `pnpm test`): every workspace project plus `scripts/`. */
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'scripts'],
  },
});
