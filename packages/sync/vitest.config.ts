// SPDX-License-Identifier: AGPL-3.0-only
import { sharedResolve, unitTestDefaults } from '@ardoise/config/vitest';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: sharedResolve,
  test: { ...unitTestDefaults, name: 'sync' },
});
