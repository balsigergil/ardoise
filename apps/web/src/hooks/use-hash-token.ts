// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';
import { tokenFromHash } from '@/lib/api';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The one-time token in the URL fragment (`#token=…`), updated when the fragment changes. */
export function useHashToken(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => tokenFromHash(window.location.hash),
    () => undefined,
  );
}
