// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fans pokes out to connected clients, coalesced to at most one per client per window
 * (ARCHITECTURE §7: 100 ms), and closes sockets of users removed from a workspace.
 */
import type { SyncServerMessage } from '@ardoise/shared';
import type { SyncEvent } from './pokes.js';

export const POKE_WINDOW_MS = 100;
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;

export interface PokeClient {
  readonly workspaceId: string;
  readonly userId: string;
  send(message: SyncServerMessage): void;
  close(code: number): void;
}

interface ClientState {
  lastSent: number;
  pending: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class PokeHub {
  private readonly byWorkspace = new Map<string, Map<PokeClient, ClientState>>();

  constructor(private readonly windowMs = POKE_WINDOW_MS) {}

  add(client: PokeClient): () => void {
    let clients = this.byWorkspace.get(client.workspaceId);
    if (!clients) {
      clients = new Map();
      this.byWorkspace.set(client.workspaceId, clients);
    }
    clients.set(client, { lastSent: 0, pending: undefined, timer: undefined });
    return () => this.remove(client);
  }

  remove(client: PokeClient): void {
    const clients = this.byWorkspace.get(client.workspaceId);
    const state = clients?.get(client);
    if (state?.timer) clearTimeout(state.timer);
    clients?.delete(client);
    if (clients?.size === 0) this.byWorkspace.delete(client.workspaceId);
  }

  get size(): number {
    let n = 0;
    for (const clients of this.byWorkspace.values()) n += clients.size;
    return n;
  }

  handle(event: SyncEvent): void {
    const clients = this.byWorkspace.get(event.workspaceId);
    if (!clients) return;
    if (event.type === 'kick') {
      for (const client of [...clients.keys()]) {
        if (client.userId === event.userId) {
          this.remove(client);
          client.close(CLOSE_FORBIDDEN);
        }
      }
      return;
    }
    for (const [client, state] of clients) this.poke(client, state, event.seq);
  }

  private poke(client: PokeClient, state: ClientState, seq: number): void {
    if (seq <= state.lastSent) return;
    if (state.timer) {
      state.pending = Math.max(state.pending ?? 0, seq);
      return;
    }
    this.send(client, state, seq);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      const pending = state.pending;
      state.pending = undefined;
      if (pending !== undefined && pending > state.lastSent) this.poke(client, state, pending);
    }, this.windowMs);
  }

  private send(client: PokeClient, state: ClientState, seq: number): void {
    state.lastSent = seq;
    client.send({ type: 'poke', workspaceId: client.workspaceId, seq });
  }
}
