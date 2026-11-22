// SPDX-License-Identifier: AGPL-3.0-only
import { parentKey, type PageParent } from '@ardoise/shared';
import type { SyncStore } from '@ardoise/sync';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadChildren } from '@/lib/pages';
import { readJson, writeJson } from '@/lib/storage';
import { expansionKey, type LoadState } from './tree-model';

const storageKey = (workspaceId: string) => `ardoise.tree.${workspaceId}`;
const MAX_REMEMBERED = 500;

/** Expanded nodes, remembered per workspace on this device (bounded). */
export function useExpanded(workspaceId: string) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(readJson<string[]>(storageKey(workspaceId)) ?? []),
  );
  useEffect(() => {
    writeJson(storageKey(workspaceId), [...expanded].slice(-MAX_REMEMBERED));
  }, [expanded, workspaceId]);
  const toggle = useCallback((scope: string, id: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      const k = expansionKey(scope, id);
      const shouldOpen = open ?? !next.has(k);
      if (shouldOpen) next.add(k);
      else next.delete(k);
      return next;
    });
  }, []);
  return { expanded, toggle };
}

/** Lazily loads children lists (one level at a time, paginated) into the store. */
const EMPTY: ReadonlyMap<string, LoadState> = new Map();

export function useChildLoads(store: SyncStore, refreshToken: number) {
  // Load states belong to one store and refresh token: access changes and resyncs
  // start from scratch, which refetches every list shown.
  const generation = `${store.workspaceId}:${refreshToken}`;
  const [state, setState] = useState<{ generation: string; map: Map<string, LoadState> }>({
    generation,
    map: new Map(),
  });
  const loads = state.generation === generation ? state.map : EMPTY;
  const inflight = useRef(new Set<string>());
  const setLoads = useCallback(
    (gen: string, update: (map: Map<string, LoadState>) => Map<string, LoadState>) =>
      setState((current) => {
        if (current.generation === gen) return { generation: gen, map: update(current.map) };
        // A late answer from an older generation of the same workspace is dropped.
        const [ws, token] = gen.split(':');
        const [currentWs, currentToken] = current.generation.split(':');
        if (ws === currentWs && Number(token) < Number(currentToken)) return current;
        return { generation: gen, map: update(new Map()) };
      }),
    [],
  );

  const run = useCallback(
    (parent: PageParent, cursor: string | null) => {
      const pk = parentKey(parent);
      const flight = `${generation}|${pk}`;
      if (inflight.current.has(flight)) return;
      inflight.current.add(flight);
      setLoads(generation, (m) =>
        new Map(m).set(pk, { status: 'loading', next: m.get(pk)?.next ?? null }),
      );
      loadChildren(store, parent, cursor)
        .then((next) => setLoads(generation, (m) => new Map(m).set(pk, { status: 'done', next })))
        .catch(() =>
          setLoads(generation, (m) => new Map(m).set(pk, { status: 'error', next: null })),
        )
        .finally(() => inflight.current.delete(flight));
    },
    [store, generation, setLoads],
  );

  const ensure = useCallback(
    (parents: readonly PageParent[]) => {
      for (const parent of parents) {
        const state = loads.get(parentKey(parent));
        if (!state) run(parent, null);
      }
    },
    [loads, run],
  );

  const more = useCallback(
    (parent: PageParent) => {
      const state = loads.get(parentKey(parent));
      if (state?.next) run(parent, state.next);
    },
    [loads, run],
  );

  const retry = useCallback((parent: PageParent) => run(parent, null), [run]);

  /** Loads a parent's children before computing a drop position inside it. */
  const loadAll = useCallback(
    async (parent: PageParent) => {
      let cursor: string | null = null;
      do cursor = await loadChildren(store, parent, cursor);
      while (cursor);
    },
    [store],
  );

  return { loads, ensure, more, retry, loadAll };
}
