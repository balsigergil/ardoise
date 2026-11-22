// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileStack, Import, Settings, Trash2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceIcon, WorkspaceSwitcher } from '@/components/workspace-switcher';
import { myTeamspacesQuery } from '@/lib/queries';

/** Sidebar sections, in the order of PRODUCT §4. Page trees arrive in M2. */
type PageSection = 'favorites' | 'shared' | 'private';

const comingSoon: { key: 'templates' | 'import' | 'trash'; icon: LucideIcon }[] = [
  { key: 'templates', icon: FileStack },
  { key: 'import', icon: Import },
  { key: 'trash', icon: Trash2 },
];

function EmptySection({ section }: { section: PageSection | 'teamspaces' }) {
  const { t } = useTranslation();
  return <p className="px-2 text-xs text-muted-foreground">{t(`sidebar.empty.${section}`)}</p>;
}

function TeamspacesSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const teamspaces = useQuery(myTeamspacesQuery(workspaceId)).data?.items ?? [];
  return (
    <SidebarGroup data-testid="sidebar-section-teamspaces">
      <SidebarGroupLabel>{t('sidebar.sections.teamspaces')}</SidebarGroupLabel>
      <SidebarGroupContent>
        {teamspaces.length === 0 ? (
          <EmptySection section="teamspaces" />
        ) : (
          <SidebarMenu>
            {teamspaces.map((ts) => (
              <SidebarMenuItem key={ts.id}>
                <SidebarMenuButton asChild>
                  <Link
                    to="/w/$workspaceId/teamspaces/$teamspaceId"
                    params={{ workspaceId, teamspaceId: ts.id }}
                  >
                    <WorkspaceIcon icon={ts.icon} name={ts.name} />
                    <span className="truncate">{ts.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar({ workspaceId }: { workspaceId?: string | undefined }) {
  const { t } = useTranslation();
  const section = (key: PageSection) => (
    <SidebarGroup key={key} data-testid={`sidebar-section-${key}`}>
      <SidebarGroupLabel>{t(`sidebar.sections.${key}`)}</SidebarGroupLabel>
      <SidebarGroupContent>
        <EmptySection section={key} />
      </SidebarGroupContent>
    </SidebarGroup>
  );
  return (
    <Sidebar aria-label={t('ui.sidebarTitle')}>
      <SidebarHeader>
        <WorkspaceSwitcher currentId={workspaceId} />
      </SidebarHeader>
      {workspaceId && (
        <SidebarContent>
          {section('favorites')}
          <TeamspacesSection workspaceId={workspaceId} />
          {section('shared')}
          {section('private')}
        </SidebarContent>
      )}
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
      <SidebarRail />
    </Sidebar>
  );
}
