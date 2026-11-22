// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { useMe } from '@/auth/session';
import { useLogout } from '@/auth/use-logout';

export function UserMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton data-testid="user-menu">
          <UserRound />
          <span className="truncate">{me.name}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {me.email}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserRound />
            {t('account.title')}
          </Link>
        </DropdownMenuItem>
        {me.isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck />
              {t('admin.title')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} data-testid="logout">
          <LogOut />
          {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
