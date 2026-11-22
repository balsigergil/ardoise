// SPDX-License-Identifier: AGPL-3.0-only
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

/** Sidebar sections, in the order of PRODUCT §4. Content arrives in M2. */
const sidebarSections = ['favorites', 'teamspaces', 'shared', 'private'] as const;

const footerEntries: { key: 'templates' | 'import' | 'trash' | 'settings'; icon: LucideIcon }[] = [
  { key: 'templates', icon: FileStack },
  { key: 'import', icon: Import },
  { key: 'trash', icon: Trash2 },
  { key: 'settings', icon: Settings },
];

export function AppSidebar() {
  const { t } = useTranslation();
  return (
    <Sidebar aria-label={t('ui.sidebarTitle')}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="truncate font-semibold">{t('app.name')}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sidebarSections.map((section) => (
          <SidebarGroup key={section} data-testid={`sidebar-section-${section}`}>
            <SidebarGroupLabel>{t(`sidebar.sections.${section}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <p className="px-2 text-xs text-muted-foreground">{t(`sidebar.empty.${section}`)}</p>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {footerEntries.map(({ key, icon: Icon }) => (
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
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
