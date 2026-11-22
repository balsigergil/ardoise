// SPDX-License-Identifier: AGPL-3.0-only
/** HTTP transport for `/sync/mutations` and `/sync/pull`, and the `/sync/ws` poke socket. */
import type {
  AnyMutation,
  MutationResult,
  PullResponse,
  PushResponse,
  SyncServerMessage,
} from '@ardoise/shared';
import { isErrorCode } from '@ardoise/shared';
import { SyncError, type SyncTransport } from './store.js';

export type JsonRequest = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => Promise<Response>;

async function errorCode(res: Response): Promise<SyncError> {
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    const code = body.error?.code;
    if (code && isErrorCode(code)) return new SyncError(code);
  } catch {
    // fall through
  }
  return new SyncError('network');
}

export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly workspaceId: string,
    private readonly request: JsonRequest,
  ) {}

  async push(mutations: AnyMutation[]): Promise<MutationResult[]> {
    const res = await this.request('POST', '/sync/mutations', { mutations });
    if (!res.ok) throw await errorCode(res);
    return ((await res.json()) as PushResponse).results;
  }

  async pull(since: number, limit: number): Promise<PullResponse> {
    const res = await this.request(
      'GET',
      `/sync/pull?workspace=${this.workspaceId}&since=${since}&limit=${limit}`,
    );
    if (!res.ok) throw await errorCode(res);
    return (await res.json()) as PullResponse;
  }
}

export interface PokeSocketOptions {
  url: string;
  onPoke: (seq: number) => void;
  /** Called after (re)connecting, so the client can catch up. */
  onOpen?: () => void;
  /** Called when the server refuses the session or the membership (4401/4403). */
  onDenied?: (code: number) => void;
  createSocket?: (url: string) => WebSocket;
  maxDelayMs?: number;
}

/** Keeps a `/sync/ws` connection open with exponential backoff. */
export class PokeSocket {
  private socket: WebSocket | undefined;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly options: PokeSocketOptions) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = (this.options.createSocket ?? ((u) => new WebSocket(u)))(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.options.onOpen?.();
    };
    socket.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data)) as SyncServerMessage;
        if (message.type === 'poke') this.options.onPoke(message.seq);
      } catch {
        // ignore malformed messages
      }
    };
    socket.onclose = (event: CloseEvent) => {
      this.socket = undefined;
      if (this.closed) return;
      if (event.code === 4401 || event.code === 4403) {
        this.options.onDenied?.(event.code);
        return;
      }
      const delay = Math.min(this.options.maxDelayMs ?? 30_000, 500 * 2 ** this.attempts++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
  }
}
