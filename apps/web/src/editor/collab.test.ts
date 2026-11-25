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

/** A schedule run by hand, so the deferred destroy is deterministic. */
function manualSchedule() {
  const tasks: (() => void)[] = [];
  return {
    schedule: (task: () => void) => void tasks.push(task),
    flush: () => tasks.splice(0).forEach((task) => task()),
  };
}

describe('sessionHolder', () => {
  it('opens nothing until subscribed', () => {
    const open = vi.fn(() => fakeSession().session);
    const holder = sessionHolder(open);
    expect(open).not.toHaveBeenCalled();
    expect(holder.session).toBeNull();
  });

  it('opens on subscribe, forwards changes and destroys after the last unsubscribe', () => {
    const fake = fakeSession();
    const timer = manualSchedule();
    const holder = sessionHolder(() => fake.session, timer.schedule);
    const listener = vi.fn();
    const off = holder.subscribe(listener);
    expect(holder.session).toBe(fake.session);
    const before = holder.snapshot();
    fake.setStatus('synced');
    expect(listener).toHaveBeenCalled();
    expect(holder.snapshot()).not.toBe(before);
    off();
    expect(fake.listeners.size).toBe(0);
    expect(fake.session.destroy).not.toHaveBeenCalled();
    timer.flush();
    expect(fake.session.destroy).toHaveBeenCalledOnce();
    expect(holder.session).toBeNull();
  });

  it('keeps the same session across an immediate remount (StrictMode)', () => {
    const open = vi.fn(() => fakeSession().session);
    const timer = manualSchedule();
    const holder = sessionHolder(open, timer.schedule);
    holder.subscribe(() => undefined)();
    const first = holder.session;
    holder.subscribe(() => undefined);
    timer.flush();
    expect(open).toHaveBeenCalledOnce();
    expect(holder.session).toBe(first);
    expect(first!.destroy).not.toHaveBeenCalled();
  });

  it('opens a new session when subscribed again after the destroy', () => {
    const fakes = [fakeSession(), fakeSession()];
    let i = 0;
    const timer = manualSchedule();
    const holder = sessionHolder(() => fakes[i++]!.session, timer.schedule);
    holder.subscribe(() => undefined)();
    const first = holder.snapshot();
    timer.flush();
    holder.subscribe(() => undefined);
    expect(fakes[0]!.session.destroy).toHaveBeenCalledOnce();
    expect(holder.session).toBe(fakes[1]!.session);
    expect(holder.snapshot()).not.toBe(first);
  });

  it('waits for every subscriber and ignores a repeated unsubscribe', () => {
    const fake = fakeSession();
    const timer = manualSchedule();
    const holder = sessionHolder(() => fake.session, timer.schedule);
    const offA = holder.subscribe(() => undefined);
    const offB = holder.subscribe(() => undefined);
    offA();
    offA();
    timer.flush();
    expect(fake.session.destroy).not.toHaveBeenCalled();
    offB();
    timer.flush();
    expect(fake.session.destroy).toHaveBeenCalledOnce();
  });
});
