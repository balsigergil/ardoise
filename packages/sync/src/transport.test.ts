// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncError } from './store.js';
import { HttpSyncTransport, PokeSocket } from './transport.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HttpSyncTransport', () => {
  it('pushes and pulls', async () => {
    const request = vi.fn((method: string, path: string) =>
      Promise.resolve(
        method === 'POST'
          ? json(200, { results: [{ id: 'm', status: 'applied', seq: 3 }] })
          : json(200, { entries: [], cursor: 3, hasMore: false, path }),
      ),
    );
    const transport = new HttpSyncTransport('ws1', request);
    expect(await transport.push([])).toEqual([{ id: 'm', status: 'applied', seq: 3 }]);
    expect(await transport.pull(2, 100)).toMatchObject({ cursor: 3 });
    expect(request).toHaveBeenLastCalledWith('GET', '/sync/pull?workspace=ws1&since=2&limit=100');
  });

  it('maps API error codes, and anything else to a network error', async () => {
    const transport = new HttpSyncTransport('ws1', () =>
      Promise.resolve(json(410, { error: { code: 'resync_required' } })),
    );
    await expect(transport.pull(0, 10)).rejects.toEqual(new SyncError('resync_required'));
    const broken = new HttpSyncTransport('ws1', () =>
      Promise.resolve(new Response('<html>', { status: 502 })),
    );
    await expect(broken.push([])).rejects.toEqual(new SyncError('network'));
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe('PokeSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  const create = (overrides = {}) => {
    const pokes: number[] = [];
    const opens: number[] = [];
    const denied: number[] = [];
    const socket = new PokeSocket({
      url: 'ws://x/sync/ws?workspace=w',
      onPoke: (seq) => pokes.push(seq),
      onOpen: () => opens.push(1),
      onDenied: (code) => denied.push(code),
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
      ...overrides,
    });
    return { socket, pokes, opens, denied };
  };

  it('forwards pokes and ignores malformed messages', () => {
    const { socket, pokes, opens } = create();
    socket.start();
    const ws = FakeSocket.instances[0]!;
    ws.onopen!();
    ws.onmessage!({ data: JSON.stringify({ type: 'poke', workspaceId: 'w', seq: 7 }) });
    ws.onmessage!({ data: 'not json' });
    expect(pokes).toEqual([7]);
    expect(opens).toEqual([1]);
  });

  it('reconnects with exponential backoff and resets it after a successful open', () => {
    const { socket } = create();
    socket.start();
    FakeSocket.instances[0]!.onclose!({ code: 1006 });
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.onclose!({ code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(3);
    FakeSocket.instances[2]!.onopen!();
    FakeSocket.instances[2]!.onclose!({ code: 1006 });
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('stops on denial and on stop()', () => {
    const { socket, denied } = create();
    socket.start();
    FakeSocket.instances[0]!.onclose!({ code: 4403 });
    vi.advanceTimersByTime(60_000);
    expect(denied).toEqual([4403]);
    expect(FakeSocket.instances).toHaveLength(1);
    socket.start();
    socket.stop();
    expect(FakeSocket.instances[1]!.closed).toBe(true);
  });
});
