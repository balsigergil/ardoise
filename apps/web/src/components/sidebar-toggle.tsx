// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sidebar collapse button lives in the sidebar header while the sidebar is visible,
 * and in the main area otherwise: to the left of the breadcrumb on a page, or at the
 * top-left corner of views without one.
 */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type Claim = (update: (n: number) => number) => void;
const ClaimContext = createContext<Claim | null>(null);

/** True when the sidebar is not on screen, so the main area must offer the button. */
function useSidebarHidden() {
  const { isMobile, open, openMobile } = useSidebar();
  return isMobile ? !openMobile : !open;
}

/** Renders the button inline (e.g. before the breadcrumb) when the sidebar is hidden. */
export function InlineSidebarTrigger({ className }: { className?: string }) {
  const claim = useContext(ClaimContext);
  const hidden = useSidebarHidden();
  useLayoutEffect(() => {
    if (!claim) return;
    claim((n) => n + 1);
    return () => claim((n) => n - 1);
  }, [claim]);
  return hidden ? <SidebarTrigger className={cn('shrink-0', className)} /> : null;
}

/** Wraps the main area; shows a corner button unless a view rendered an inline one. */
export function SidebarTriggerSlot({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const hidden = useSidebarHidden();
  return (
    <ClaimContext.Provider value={setClaims}>
      {hidden && claims === 0 && (
        <SidebarTrigger className="absolute left-2 top-2 z-10" data-testid="sidebar-open" />
      )}
      {children}
    </ClaimContext.Provider>
  );
}
