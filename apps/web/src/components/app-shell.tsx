// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarTriggerSlot } from '@/components/sidebar-toggle';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { SyncProvider } from '@/sync/sync-provider';

/** App shell: sidebar + main area, inside the workspace's sync store when there is one. */
export function AppShell({
  workspaceId,
  children,
}: {
  workspaceId?: string | undefined;
  children: ReactNode;
}) {
  const shell = (
    <SidebarProvider>
      <AppSidebar workspaceId={workspaceId} />
      <SidebarInset>
        <main className="relative flex-1 overflow-auto" id="main">
          <SidebarTriggerSlot>{children}</SidebarTriggerSlot>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
  return workspaceId ? <SyncProvider workspaceId={workspaceId}>{shell}</SyncProvider> : shell;
}

/** Standard page body with a title. */
export function PageContainer({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
