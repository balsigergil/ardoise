// SPDX-License-Identifier: AGPL-3.0-only
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  pool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, maxConnections = 10): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: maxConnections, application_name: 'ardoise' });
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}
