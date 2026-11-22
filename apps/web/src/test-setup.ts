// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom lacks matchMedia; components (sidebar, theme) read it.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// jsdom does not implement scrolling; the router calls it on navigation.
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
});

// jsdom has no layout, so a real virtualizer renders nothing: render every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    getItemKey,
  }: {
    count: number;
    estimateSize: (i: number) => number;
    getItemKey?: (i: number) => string | number;
  }) => ({
    getTotalSize: () =>
      Array.from({ length: count }, (_, i) => estimateSize(i)).reduce((a, b) => a + b, 0),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey ? getItemKey(index) : index,
        start: index * estimateSize(index),
        size: estimateSize(index),
      })),
  }),
}));

// No server in unit tests: the poke socket never connects.
class OfflineWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close() {
    this.readyState = 3;
  }
  send() {}
}
vi.stubGlobal('WebSocket', OfflineWebSocket);
