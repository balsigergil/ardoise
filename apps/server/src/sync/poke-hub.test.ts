// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncServerMessage } from '@ardoise/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_FORBIDDEN, PokeHub, type PokeClient } from './poke-hub.js';

function client(workspaceId: string, userId = 'u1') {
  const sent: SyncServerMessage[] = [];
  const closed: number[] = [];
  const c: PokeClient = {
    workspaceId,
    userId,
    send: (m) => sent.push(m),
    close: (code) => closed.push(code),
  };
  return { c, sent, closed };
}

describe('PokeHub', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('forwards pokes to the clients of the workspace only', () => {
    const hub = new PokeHub();
    const a = client('ws1');
    const b = client('ws2');
    hub.add(a.c);
    hub.add(b.c);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 3 });
    expect(a.sent).toEqual([{ type: 'poke', workspaceId: 'ws1', seq: 3 }]);
    expect(b.sent).toEqual([]);
  });

  it('coalesces pokes within the window and sends the latest after it', () => {
    const hub = new PokeHub(100);
    const a = client('ws1');
    hub.add(a.c);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 1 });
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 2 });
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 5 });
    expect(a.sent.map((m) => m.seq)).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(a.sent.map((m) => m.seq)).toEqual([1, 5]);
    vi.advanceTimersByTime(500);
    expect(a.sent.map((m) => m.seq)).toEqual([1, 5]);
  });

  it('ignores stale seqs', () => {
    const hub = new PokeHub(100);
    const a = client('ws1');
    hub.add(a.c);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 4 });
    vi.advanceTimersByTime(200);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 3 });
    expect(a.sent.map((m) => m.seq)).toEqual([4]);
  });

  it('kicks the sockets of a removed user', () => {
    const hub = new PokeHub();
    const a = client('ws1', 'alice');
    const b = client('ws1', 'bob');
    hub.add(a.c);
    hub.add(b.c);
    hub.handle({ type: 'kick', workspaceId: 'ws1', userId: 'bob' });
    expect(b.closed).toEqual([CLOSE_FORBIDDEN]);
    expect(a.closed).toEqual([]);
    expect(hub.size).toBe(1);
  });

  it('stops delivering after removal', () => {
    const hub = new PokeHub();
    const a = client('ws1');
    const remove = hub.add(a.c);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 1 });
    remove();
    vi.advanceTimersByTime(200);
    hub.handle({ type: 'poke', workspaceId: 'ws1', seq: 2 });
    expect(a.sent).toHaveLength(1);
    expect(hub.size).toBe(0);
  });
});
