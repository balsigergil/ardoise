// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { FileStack, Import, Settings, Trash2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarTree } from '@/components/page-tree/sidebar-tree';
import { TrashDialog } from '@/components/trash-dialog';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

const comingSoon: { key: 'templates' | 'import'; icon: LucideIcon }[] = [
  { key: 'templates', icon: FileStack },
  { key: 'import', icon: Import },
];

export function AppSidebar({ workspaceId }: { workspaceId?: string | undefined }) {
  const { t } = useTranslation();
  const [trashOpen, setTrashOpen] = useState(false);
  return (
    <Sidebar aria-label={t('ui.sidebarTitle')}>
      <SidebarHeader>
        <WorkspaceSwitcher currentId={workspaceId} />
      </SidebarHeader>
      {workspaceId && <SidebarTree workspaceId={workspaceId} />}
      <SidebarFooter className={workspaceId ? undefined : 'mt-auto'}>
        <SidebarMenu>
          {workspaceId &&
            comingSoon.map(({ key, icon: Icon }) => (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  aria-disabled="true"
                  title={t('status.comingSoon')}
                  className="opacity-60"
                >
                  <Icon />
                  <span>{t(`sidebar.footer.${key}`)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          {workspaceId && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setTrashOpen(true)} data-testid="trash-button">
                <Trash2 />
                <span>{t('sidebar.footer.trash')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {workspaceId && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link
                  to="/w/$workspaceId/settings"
                  params={{ workspaceId }}
                  data-testid="workspace-settings-link"
                >
                  <Settings />
                  <span>{t('sidebar.footer.settings')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      {workspaceId && trashOpen && <TrashDialog open onOpenChange={setTrashOpen} />}
      <SidebarRail />
    </Sidebar>
  );
}
