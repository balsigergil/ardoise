// SPDX-License-Identifier: AGPL-3.0-only
/** Tiny external store shared by editor plugins and the React popups they drive. */
import { useSyncExternalStore } from 'react';
export interface Store<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

/** Subscribes a React component to a store. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** State of a suggestion popup (slash menu, mentions). */
export interface SuggestionState<T> {
  open: boolean;
  items: T[];
  index: number;
  query: string;
  rect: DOMRect | null;
  select: ((item: T) => void) | null;
}

export function closedSuggestion<T>(): SuggestionState<T> {
  return { open: false, items: [], index: 0, query: '', rect: null, select: null };
}

/** Arrow keys, Enter and Escape for a suggestion popup. Returns true when handled. */
export function handleSuggestionKey<T>(
  store: Store<SuggestionState<T>>,
  event: KeyboardEvent,
): boolean {
  const state = store.get();
  if (!state.open) return false;
  if (event.key === 'Escape') {
    store.set(closedSuggestion());
    return true;
  }
  if (state.items.length === 0) return false;
  if (event.key === 'ArrowDown') {
    store.set({ ...state, index: (state.index + 1) % state.items.length });
    return true;
  }
  if (event.key === 'ArrowUp') {
    store.set({ ...state, index: (state.index - 1 + state.items.length) % state.items.length });
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    const item = state.items[state.index];
    if (item) state.select?.(item);
    return true;
  }
  return false;
}
