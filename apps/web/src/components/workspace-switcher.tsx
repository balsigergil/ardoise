// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { workspacesQuery } from '@/lib/queries';

export function WorkspaceIcon({ icon, name }: { icon: string | null; name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
    >
      {icon ?? name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Switch between the workspaces the user belongs to (PRODUCT §4). */
export function WorkspaceSwitcher({ currentId }: { currentId: string | undefined }) {
  const { t } = useTranslation();
  const workspaces = useQuery(workspacesQuery).data ?? [];
  const current = workspaces.find((w) => w.id === currentId);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="workspace-switcher"
              aria-label={t('workspace.switch')}
            >
              {current ? (
                <WorkspaceIcon icon={current.icon} name={current.name} />
              ) : (
                <img src="/favicon.svg" alt="" className="size-6" />
              )}
              <span className="truncate font-semibold">{current?.name ?? t('app.name')}</span>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>{t('workspace.list')}</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem key={w.id} asChild>
                <Link to="/w/$workspaceId" params={{ workspaceId: w.id }}>
                  <WorkspaceIcon icon={w.icon} name={w.name} />
                  <span className="truncate">{w.name}</span>
                  {w.id === currentId && <Check className="ml-auto" />}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/new-workspace">
                <Plus />
                {t('workspace.create')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
