// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { LanguageMenu, ThemeMenu } from '@/components/preferences-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="ml-auto flex items-center gap-1">
            <LanguageMenu />
            <ThemeMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto" id="main">
          {children}
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
