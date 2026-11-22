// SPDX-License-Identifier: AGPL-3.0-only
/** IndexedDB persistence through Dexie (ARCHITECTURE §8.1), one database per user and workspace. */
import { Dexie, type Table } from 'dexie';
import type { PersistedState, SyncPersistence } from './store.js';

interface Row {
  key: string;
  value: unknown;
}

class SyncDatabase extends Dexie {
  state!: Table<Row, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ state: 'key' });
  }
}

export class DexiePersistence implements SyncPersistence {
  private readonly db: SyncDatabase;

  constructor(userId: string, workspaceId: string) {
    this.db = new SyncDatabase(`ardoise-sync-${userId}-${workspaceId}`);
  }

  async load(): Promise<PersistedState | undefined> {
    const row = await this.db.state.get('snapshot');
    return row?.value as PersistedState | undefined;
  }

  async save(state: PersistedState): Promise<void> {
    await this.db.state.put({ key: 'snapshot', value: state });
  }

  async clear(): Promise<void> {
    await this.db.state.clear();
  }

  close(): void {
    this.db.close();
  }

  /** Removes every local database of a user (sign-out). */
  static async deleteAll(): Promise<void> {
    const names = await Dexie.getDatabaseNames();
    await Promise.all(
      names.filter((n) => n.startsWith('ardoise-sync-')).map((n) => Dexie.delete(n)),
    );
  }
}
