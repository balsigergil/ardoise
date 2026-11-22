// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pnpm db:seed [-- --owner <email>]` and `pnpm db:seed:large [-- --owner <email>]`.
 * The workspace is owned by an existing user (default: the first super-admin).
 */
import pg from 'pg';
import { seedDemo, seedLarge } from '../seed/seed.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const args = process.argv.slice(2);
const large = args.includes('--large');
const ownerIndex = args.indexOf('--owner');
const owner = ownerIndex >= 0 ? args[ownerIndex + 1] : undefined;

const pool = new pg.Pool({ connectionString, max: 2, application_name: 'ardoise-seed' });
try {
  const report = large
    ? await seedLarge(pool, owner, { log: (line) => console.log(line) })
    : await seedDemo(pool, owner);
  console.log(
    `Seeded workspace ${report.workspaceId}: ${report.pages} pages, ${report.grants} grants in ${(report.ms / 1000).toFixed(1)} s.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
