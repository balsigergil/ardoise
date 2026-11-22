// SPDX-License-Identifier: AGPL-3.0-only
import { DexiePersistence, HttpSyncTransport, PokeSocket, SyncStore } from '@ardoise/sync';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/auth/session';
import { rawRequest } from '@/lib/api';
import { SyncContext } from './context';

/** Entity types also shown by REST-backed screens (settings): their queries are refreshed. */
const WORKSPACE_TYPES = new Set(['workspace', 'member', 'teamspace', 'teamspaceMember']);

function socketUrl(workspaceId: string): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/sync/ws?workspace=${workspaceId}`;
}

function createStore(workspaceId: string, userId: string): SyncStore {
  return new SyncStore({
    workspaceId,
    actorId: userId,
    transport: new HttpSyncTransport(workspaceId, rawRequest),
    persistence:
      typeof indexedDB === 'undefined' ? undefined : new DexiePersistence(userId, workspaceId),
  });
}

/** One sync store per open workspace (ARCHITECTURE §8.1): store, poke socket, persistence. */
export function SyncProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  // Construction has no side effects; the effect below starts and stops it.
  const store = useMemo(() => createStore(workspaceId, me.id), [workspaceId, me.id]);
  const [refresh, setRefresh] = useState({ store, token: 0 });
  const refreshToken = refresh.store === store ? refresh.token : 0;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        setRefresh((r) => ({ store, token: r.store === store ? r.token + 1 : 1 }));
      }, 50);
    };
    const offEvents = store.onEvent((event) => {
      if (event.type === 'rejected') toast.error(t(`errors.codes.${event.code}`));
      if (event.type === 'access' || event.type === 'resync') bump();
      if (event.type === 'changed' && [...event.types].some((type) => WORKSPACE_TYPES.has(type)))
        void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    });
    const socket =
      typeof WebSocket === 'undefined'
        ? undefined
        : new PokeSocket({
            url: socketUrl(workspaceId),
            onPoke: (seq) => store.poke(seq),
            onOpen: () => void store.pull(),
          });
    void store.start();
    socket?.start();
    return () => {
      offEvents();
      socket?.stop();
      store.stop();
      if (timer) clearTimeout(timer);
    };
  }, [store, workspaceId, queryClient, t]);

  const value = useMemo(() => ({ store, refreshToken }), [store, refreshToken]);
  return <SyncContext value={value}>{children}</SyncContext>;
}
