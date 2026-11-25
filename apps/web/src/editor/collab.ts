// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client side of the collab protocol (ARCHITECTURE §5, ADR 0009): one multiplexed
 * WebSocket per tab (`HocuspocusProviderWebsocket`) and one provider per open document.
 * The session cookie authenticates the socket; reasons sent by the server drive what the
 * editor does next.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { collabDocumentName, COLLAB_PATH, COLLAB_REASONS, type CollabUser } from '@ardoise/shared';
import * as Y from 'yjs';

export type DocStatus =
  | 'connecting'
  | 'synced'
  | 'offline'
  /** No access (any more): the local copy is dropped. */
  | 'denied'
  | 'too_large';

export interface DocSession {
  readonly doc: Y.Doc;
  readonly provider: HocuspocusProvider;
  /** Read-only as decided by the server (view-only access or locked page). */
  readonly readOnly: boolean;
  readonly status: DocStatus;
  subscribe: (listener: () => void) => () => void;
  destroy: () => void;
}

let socket: HocuspocusProviderWebsocket | null = null;

/** `ws(s)://<origin>/collab` for the current page. */
export function collabUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${COLLAB_PATH}`;
}

function sharedSocket(): HocuspocusProviderWebsocket {
  socket ??= new HocuspocusProviderWebsocket({ url: collabUrl() });
  return socket;
}

/** Closes the shared socket (sign-out, tests). */
export function closeCollab(): void {
  socket?.destroy();
  socket = null;
}

/**
 * Opens the body of a page. The session reconnects by itself when the server asks it to
 * (`reconnect`: the access level changed) and stops on `forbidden` / `not_found`.
 */
export function openDocument(
  workspaceId: string,
  pageId: string,
  user: CollabUser,
  options: { websocket?: HocuspocusProviderWebsocket } = {},
): DocSession {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const doc = new Y.Doc();
  let status: DocStatus = 'connecting';
  let destroyed = false;
  let reauthenticating = false;
  let provider: HocuspocusProvider;

  const connect = () => {
    provider = new HocuspocusProvider({
      websocketProvider: options.websocket ?? sharedSocket(),
      name: collabDocumentName(workspaceId, pageId),
      document: doc,
      // Authentication is the session cookie; the token field must be non-empty.
      token: 'session',
      onSynced: () => {
        status = 'synced';
        notify();
      },
      onAuthenticated: () => {
        reauthenticating = false;
        notify();
      },
      onAuthenticationFailed: ({ reason }) => {
        status = reason === COLLAB_REASONS.reconnect ? 'connecting' : 'denied';
        notify();
      },
      onClose: ({ event }) => {
        if (destroyed) return;
        const reason = String(event.reason ?? '');
        if (reason === COLLAB_REASONS.reconnect) {
          // The access level changed: authenticate this document again on the same
          // socket (the provider reports one close message twice, hence the flag).
          if (!reauthenticating) {
            reauthenticating = true;
            void provider.sendToken();
          }
          return;
        }
        if (
          reason === COLLAB_REASONS.forbidden ||
          reason === COLLAB_REASONS.notFound ||
          reason === COLLAB_REASONS.unsupported
        ) {
          status = 'denied';
          provider.destroy();
        } else if (status === 'synced') {
          status = 'offline';
        }
        notify();
      },
      onStateless: ({ payload }) => {
        try {
          if ((JSON.parse(payload) as { type?: string }).type === COLLAB_REASONS.tooLarge) {
            status = 'too_large';
            notify();
          }
        } catch {
          // not ours
        }
      },
    });
    provider.setAwarenessField('user', user);
    provider.attach();
  };
  connect();

  return {
    doc,
    get provider() {
      return provider;
    },
    get readOnly() {
      return provider.authorizedScope === 'readonly';
    },
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      provider.destroy();
      doc.destroy();
      listeners.clear();
    },
  };
}

/** A session opened while subscribed: the shape `useSyncExternalStore` expects. */
export interface SessionHolder {
  readonly session: DocSession | null;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => string;
}

/**
 * Opens the session on subscribe and destroys it once nobody is subscribed any more, so
 * nothing connects during render.
 *
 * The destroy is deferred (`schedule`) and cancelled by a new subscribe: StrictMode
 * unmounts and mounts again right away, and destroying then reopening the document on
 * the shared socket races the server. The close of the first provider is queued behind
 * its pending authentication, the second provider's authentication is queued with it,
 * so the server closes the document after the second provider is synced: the editor
 * shows "offline" and drops edits until the socket times out (about 30 s).
 */
export function sessionHolder(
  open: () => DocSession,
  schedule: (task: () => void) => void = (task) => void setTimeout(task, 0),
): SessionHolder {
  let session: DocSession | null = null;
  let generation = 0;
  let subscribers = 0;
  return {
    get session() {
      return session;
    },
    subscribe(listener) {
      subscribers += 1;
      if (!session) {
        session = open();
        generation += 1;
      }
      const opened = session;
      const off = opened.subscribe(listener);
      listener();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        off();
        subscribers -= 1;
        if (subscribers > 0) return;
        schedule(() => {
          if (subscribers > 0 || session !== opened) return;
          opened.destroy();
          session = null;
          generation += 1;
        });
      };
    },
    snapshot: () =>
      session ? `${generation}:${session.status}:${session.readOnly}` : `${generation}:none`,
  };
}
