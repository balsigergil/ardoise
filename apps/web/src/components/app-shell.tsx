// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { LanguageMenu, ThemeMenu } from '@/components/preferences-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

/** App shell: sidebar + main area (ROADMAP M0). */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
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
}
