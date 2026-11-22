// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import { sharedResolve, unitTestDefaults } from '@ardoise/config/vitest';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  resolve: {
    ...sharedResolve,
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    ...unitTestDefaults,
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
