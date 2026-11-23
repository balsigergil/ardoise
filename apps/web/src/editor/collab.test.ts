// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { sessionHolder, type DocSession, type DocStatus } from './collab';

function fakeSession() {
  const listeners = new Set<() => void>();
  let status: DocStatus = 'connecting';
  const session = {
    doc: new Y.Doc(),
    provider: {} as DocSession['provider'],
    readOnly: false,
    get status() {
      return status;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: vi.fn(),
  } satisfies DocSession;
  const setStatus = (next: DocStatus) => {
    status = next;
    listeners.forEach((l) => l());
  };
  return { session, setStatus, listeners };
}

describe('sessionHolder', () => {
  it('opens nothing until subscribed', () => {
    const open = vi.fn(() => fakeSession().session);
    const holder = sessionHolder(open);
    expect(open).not.toHaveBeenCalled();
    expect(holder.session).toBeNull();
  });

  it('opens on subscribe, forwards changes and destroys on unsubscribe', () => {
    const fake = fakeSession();
    const holder = sessionHolder(() => fake.session);
    const listener = vi.fn();
    const off = holder.subscribe(listener);
    expect(holder.session).toBe(fake.session);
    const before = holder.snapshot();
    fake.setStatus('synced');
    expect(listener).toHaveBeenCalled();
    expect(holder.snapshot()).not.toBe(before);
    off();
    expect(fake.session.destroy).toHaveBeenCalledOnce();
    expect(fake.listeners.size).toBe(0);
    expect(holder.session).toBeNull();
  });

  it('gives a live session again after a remount (StrictMode)', () => {
    const fakes = [fakeSession(), fakeSession()];
    let i = 0;
    const holder = sessionHolder(() => fakes[i++]!.session);
    holder.subscribe(() => undefined)();
    const first = holder.snapshot();
    holder.subscribe(() => undefined);
    expect(fakes[0]!.session.destroy).toHaveBeenCalledOnce();
    expect(holder.session).toBe(fakes[1]!.session);
    expect(fakes[1]!.session.destroy).not.toHaveBeenCalled();
    expect(holder.snapshot()).not.toBe(first);
  });
});
