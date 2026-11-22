// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pokes (ARCHITECTURE §7): after commit, the api node publishes `{workspaceId, seq}` on
 * Valkey; every api node forwards it to its `/sync/ws` sockets for that workspace.
 * Kicks close the sockets of a user removed from a workspace.
 */
import type { Redis } from 'ioredis';

export const SYNC_CHANNEL = 'ardoise:sync';

export type SyncEvent =
  | { type: 'poke'; workspaceId: string; seq: number }
  | { type: 'kick'; workspaceId: string; userId: string };

export interface SyncEventBus {
  publish(event: SyncEvent): Promise<void>;
  subscribe(listener: (event: SyncEvent) => void): () => void;
}

export class ValkeySyncEventBus implements SyncEventBus {
  private readonly listeners = new Set<(event: SyncEvent) => void>();
  private subscriber: Redis | undefined;

  constructor(private readonly valkey: Redis) {}

  async publish(event: SyncEvent): Promise<void> {
    await this.valkey.publish(SYNC_CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    if (!this.subscriber) {
      this.subscriber = this.valkey.duplicate({ connectionName: 'ardoise-sync-sub' });
      this.subscriber.on('error', () => undefined);
      void this.subscriber.subscribe(SYNC_CHANNEL);
      this.subscriber.on('message', (_channel: string, message: string) => {
        let event: SyncEvent;
        try {
          event = JSON.parse(message) as SyncEvent;
        } catch {
          return;
        }
        for (const l of this.listeners) l(event);
      });
    }
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.subscriber?.disconnect();
    this.subscriber = undefined;
  }
}

/** In-process bus (unit tests). */
export class MemorySyncEventBus implements SyncEventBus {
  readonly published: SyncEvent[] = [];
  private readonly listeners = new Set<(event: SyncEvent) => void>();
  publish(event: SyncEvent): Promise<void> {
    this.published.push(event);
    for (const l of this.listeners) l(event);
    return Promise.resolve();
  }
  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
