// SPDX-License-Identifier: AGPL-3.0-only
import { runMigrations } from '../migrate.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
await runMigrations({ connectionString });
console.log('Migrations applied.');
