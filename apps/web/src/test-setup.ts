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
