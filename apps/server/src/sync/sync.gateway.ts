// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/sync/ws` (ADR 0006 item 8): authenticated by the session cookie and an `Origin`
 * check at upgrade time; server → client pokes only. Sessions are re-checked
 * periodically, and kicks close the sockets of removed members.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthService } from '../auth/auth.service.js';
import { parseCookies, SESSION_COOKIE } from '../common/cookies.js';
import { isSameOriginRequest } from '../common/origin.js';
import type { Config } from '../config/config.js';
import type { Store } from '../store/store.js';
import { CONFIG, STORE, SYNC_BUS } from '../tokens.js';
import { CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED, PokeHub, type PokeClient } from './poke-hub.js';
import type { SyncEventBus } from './pokes.js';

export const SYNC_WS_PATH = '/sync/ws';
const REVALIDATE_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SyncGateway implements OnApplicationShutdown {
  private readonly logger = new Logger('sync');
  private readonly hub = new PokeHub();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(STORE) private readonly store: Store,
    @Inject(SYNC_BUS) private readonly bus: SyncEventBus,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Handles upgrades on `/sync/ws`; other paths are left to their own handlers. */
  attach(server: Server): void {
    this.unsubscribe = this.bus.subscribe((event) => this.hub.handle(event));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== SYNC_WS_PATH) return;
      void this.upgrade(req, socket, head, url).catch((error: unknown) => {
        this.logger.warn(`sync upgrade failed: ${String(error)}`);
        socket.destroy();
      });
    });
    const heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        const alive = ws as WebSocket & { alive?: boolean };
        if (alive.alive === false) {
          ws.terminate();
          continue;
        }
        alive.alive = false;
        ws.ping();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    this.timers.push(heartbeat);
  }

  private reject(socket: Duplex, status: number): void {
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
  }

  private async upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
  ): Promise<void> {
    const origin = req.headers.origin;
    if (!isSameOriginRequest({ origin, secFetchSite: undefined }, this.config.publicUrl)) {
      this.reject(socket, 403);
      return;
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const auth = token ? await this.auth.authenticate(token) : undefined;
    if (!auth || !token) {
      this.reject(socket, 401);
      return;
    }
    const workspaceId = url.searchParams.get('workspace') ?? '';
    const member = UUID.test(workspaceId)
      ? await this.store.workspaces.membership(workspaceId, auth.user.id)
      : undefined;
    if (!member) {
      this.reject(socket, 403);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) =>
      this.connected(ws, token, workspaceId, auth.user.id),
    );
  }

  private connected(ws: WebSocket, token: string, workspaceId: string, userId: string): void {
    const alive = ws as WebSocket & { alive?: boolean };
    alive.alive = true;
    ws.on('pong', () => {
      alive.alive = true;
    });
    const client: PokeClient = {
      workspaceId,
      userId,
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      close: (code) => ws.close(code),
    };
    const remove = this.hub.add(client);
    const revalidate = setInterval(() => {
      void (async () => {
        const auth = await this.auth.authenticate(token);
        if (!auth) return ws.close(CLOSE_UNAUTHENTICATED);
        if (!(await this.store.workspaces.membership(workspaceId, userId)))
          ws.close(CLOSE_FORBIDDEN);
      })().catch(() => undefined);
    }, REVALIDATE_MS);
    revalidate.unref();
    ws.on('close', () => {
      clearInterval(revalidate);
      remove();
    });
    // Clients only listen; anything they send is ignored.
    ws.on('message', () => undefined);
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
