// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';

/** Opens quick find on Ctrl+K / Cmd+K. */
export function useQuickFindShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
