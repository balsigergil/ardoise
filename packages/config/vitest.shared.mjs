// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared Vitest settings for unit-test projects. Workspace packages resolve to their
 * TypeScript sources through the `development` export condition.
 */
export const sharedResolve = {
  conditions: ['development', 'module', 'import', 'default'],
};

export const unitTestDefaults = {
  include: ['src/**/*.test.{ts,tsx}'],
  passWithNoTests: true,
  restoreMocks: true,
};
