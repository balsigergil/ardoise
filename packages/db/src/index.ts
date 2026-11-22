// SPDX-License-Identifier: AGPL-3.0-only
export * from './schema/index.js';
export { createDatabase, type Database, type DatabaseHandle } from './client.js';
export {
  MIGRATION_LOCK_KEY,
  migrationsFolder,
  runMigrations,
  withMigrationLock,
  type LockClient,
  type RunMigrationsOptions,
} from './migrate.js';
export {
  seedDemo,
  seedLarge,
  LARGE_DEFAULTS,
  type LargeSeedOptions,
  type SeedReport,
} from './seed/seed.js';
