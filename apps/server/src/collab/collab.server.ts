// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `collab` role (ARCHITECTURE §5, ADR 0009): Hocuspocus attached to the process's
 * HTTP server at `/collab`. One WebSocket per browser carries every open document.
 *
 * - Upgrade: `Origin` must match `ARDOISE_PUBLIC_URL` and the session cookie must be
 *   valid; the session is re-checked every minute.
 * - Each document is authorized in `onAuthenticate` (`CollabAccess`); read-only is
 *   enforced by Hocuspocus (updates from read-only connections are dropped).
 * - `collab:recheck` events close connections that lost access and reconnect those
 *   whose read-only state changed.
 * - Awareness `user` fields are rewritten with the authenticated identity.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { hostname } from 'node:os';
import type { Duplex } from 'node:stream';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { Hocuspocus, type Connection, type Extension } from '@hocuspocus/server';
import {
  COLLAB_PATH,
  COLLAB_REASONS,
  parseCollabDocumentName,
  presenceColor,
} from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { parseCookies, SESSION_COOKIE } from '../common/cookies.js';
import { isSameOriginRequest } from '../common/origin.js';
import type { SyncEvent, SyncEventBus } from '../sync/pokes.js';
import { CollabDenied, type CollabAccess, type CollabIdentity } from './collab-access.js';
import type { CollabPersistence } from './collab-persistence.js';

/** Per-connection context (identity at upgrade, grant after `onAuthenticate`). */
export interface CollabContext extends CollabIdentity {
  token: string;
  pageId?: string;
}

export interface CollabServerOptions {
  publicUrl: string;
  /** Valkey for multi-node fan-out (`@hocuspocus/extension-redis`); omitted in tests. */
  valkeyUrl?: string;
  /** onStoreDocument debounce (ARCHITECTURE §4.4: 2 s, at most 10 s). */
  debounceMs?: number;
  maxDebounceMs?: number;
  revalidateMs?: number;
  heartbeatMs?: number;
}

/** Close codes on the socket (the per-document reasons are in `COLLAB_REASONS`). */
export const COLLAB_CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_RECONNECT = 4409;
/** Largest message accepted from a client (a big paste); documents are capped separately. */
const MAX_PAYLOAD = 16 * 1024 * 1024;

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** ioredis options from a `redis://user:pass@host:port/db` URL. */
export function redisOptions(url: string) {
  const parsed = new URL(url);
  const db = Number.parseInt(parsed.pathname.slice(1) || '0', 10);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    options: {
      ...(parsed.username && { username: decodeURIComponent(parsed.username) }),
      ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
      ...(Number.isFinite(db) && db > 0 && { db }),
      ...(parsed.protocol === 'rediss:' && { tls: {} }),
      connectionName: 'ardoise-collab',
    },
  };
}

export class CollabServer {
  readonly hocuspocus: Hocuspocus<CollabContext>;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private unsubscribe: (() => void) | undefined;
  private readonly redis: RedisExtension | undefined;

  constructor(
    private readonly access: CollabAccess,
    private readonly persistence: CollabPersistence,
    private readonly bus: SyncEventBus,
    private readonly options: CollabServerOptions,
    private readonly logger: Pick<Logger, 'log' | 'warn' | 'error'>,
  ) {
    const extensions: Extension[] = [];
    if (options.valkeyUrl) {
      this.redis = new RedisExtension({
        ...redisOptions(options.valkeyUrl),
        prefix: 'ardoise:collab',
        identifier: `${hostname()}-${process.pid}-${randomUUID()}`,
      });
      extensions.push(this.redis);
    }
    this.hocuspocus = new Hocuspocus<CollabContext>({
      name: 'ardoise',
      quiet: true,
      extensions,
      debounce: options.debounceMs ?? 2_000,
      maxDebounce: options.maxDebounceMs ?? 10_000,
      onAuthenticate: async ({ context, documentName, connectionConfig }) => {
        try {
          const grant = await this.access.authorize(context, documentName);
          connectionConfig.readOnly = grant.readOnly;
          return { pageId: grant.pageId };
        } catch (error) {
          // Hocuspocus sends `reason` to the client (`onAuthenticationFailed`).
          if (error instanceof CollabDenied) throw error;
          this.logger.error({ err: error, documentName }, 'collab authorization failed');
          throw new CollabDenied(COLLAB_REASONS.forbidden);
        }
      },
      onLoadDocument: async ({ documentName, document }) => {
        const ref = parseCollabDocumentName(documentName);
        if (ref) await this.persistence.load(ref, document);
        return document;
      },
      onStoreDocument: async ({ documentName, document }) => {
        const ref = parseCollabDocumentName(documentName);
        if (!ref) return;
        const result = await this.persistence.save(ref, ref.id, document);
        if (result === 'too_large') {
          document.broadcastStateless(JSON.stringify({ type: COLLAB_REASONS.tooLarge }));
        }
      },
      beforeHandleAwareness: ({ states, context }) => {
        if (!context) return Promise.resolve();
        for (const state of states.values()) {
          if (!state['user'] || typeof state['user'] !== 'object') continue;
          // Presence shows who people really are: identity comes from the session.
          state['user'] = {
            ...(state['user'] as Record<string, unknown>),
            id: context.userId,
            name: context.name,
            color: presenceColor(context.userId),
          };
        }
        return Promise.resolve();
      },
    });
  }

  /** Handles upgrades on `/collab`; other paths are left to their own handlers. */
  attach(server: Server): void {
    this.unsubscribe = this.bus.subscribe((event) => void this.onEvent(event));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== COLLAB_PATH) return;
      void this.upgrade(req, socket, head).catch((error: unknown) => {
        this.logger.warn(`collab upgrade failed: ${String(error)}`);
        socket.destroy();
      });
    });
    const heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.readyState === ws.OPEN) ws.ping();
      }
    }, this.options.heartbeatMs ?? 15_000);
    heartbeat.unref();
    this.timers.push(heartbeat);
  }

  private reject(socket: Duplex, status: 401 | 403): void {
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (
      !isSameOriginRequest(
        { origin: req.headers.origin, secFetchSite: undefined },
        this.options.publicUrl,
      )
    ) {
      this.reject(socket, 403);
      return;
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const identity = await this.access.identify(token);
    if (!identity || !token) {
      this.reject(socket, 401);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) =>
      this.connected(ws, req, { ...identity, token }),
    );
  }

  private connected(ws: WebSocket, req: IncomingMessage, context: CollabContext): void {
    const headers = new Headers();
    if (req.headers['user-agent']) headers.set('user-agent', req.headers['user-agent']);
    const request = new Request(new URL(req.url ?? COLLAB_PATH, this.options.publicUrl), {
      headers,
    });
    const client = this.hocuspocus.handleConnection(ws, request, context);
    ws.on('message', (data) => client.handleMessage(toUint8(data)));
    ws.on('pong', () => client.touch());
    ws.on('error', () => undefined);
    const revalidate = setInterval(() => {
      void this.access
        .identify(context.token)
        .then((identity) => {
          if (!identity) ws.close(COLLAB_CLOSE_UNAUTHENTICATED, COLLAB_REASONS.unauthenticated);
        })
        .catch(() => undefined);
    }, this.options.revalidateMs ?? 60_000);
    revalidate.unref();
    ws.on('close', (code, reason) => {
      clearInterval(revalidate);
      client.handleClose({ code, reason: reason.toString() });
    });
  }

  private async onEvent(event: SyncEvent): Promise<void> {
    if (event.type === 'collab:recheck') await this.recheck(event.workspaceId, event.pageIds);
    if (event.type === 'kick') await this.recheck(event.workspaceId, null, event.userId);
  }

  /** Re-authorizes open connections of a workspace (optionally some pages or one user). */
  async recheck(workspaceId: string, pageIds: string[] | null, userId?: string): Promise<void> {
    const pages = pageIds ? new Set(pageIds) : null;
    for (const [name, document] of this.hocuspocus.documents) {
      const ref = parseCollabDocumentName(name);
      if (!ref || ref.workspaceId !== workspaceId) continue;
      if (pages && !pages.has(ref.id)) continue;
      for (const connection of [...document.connections.keys()] as Connection<CollabContext>[]) {
        const context = connection.context;
        if (userId && context.userId !== userId) continue;
        try {
          const grant = await this.access.authorize(context, name);
          if (grant.readOnly !== connection.readOnly) {
            connection.close({ code: CLOSE_RECONNECT, reason: COLLAB_REASONS.reconnect });
          }
        } catch (error) {
          const reason = error instanceof CollabDenied ? error.reason : COLLAB_REASONS.forbidden;
          connection.close({ code: CLOSE_FORBIDDEN, reason });
        }
      }
    }
  }

  /** Stores pending documents and closes every connection. */
  async close(): Promise<void> {
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    this.hocuspocus.flushPendingStores();
    // Let pending stores run before the sockets go.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    await this.redis?.onDestroy();
  }
}
