// SPDX-License-Identifier: AGPL-3.0-only
/** Avatars of the people viewing the page (PRODUCT §6.3), from Yjs awareness. */
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DocSession } from '../collab';
import { presentUsers } from './presence-model';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function Presence({ session }: { session: DocSession }) {
  const { t } = useTranslation();
  const awareness = session.provider.awareness;
  const snapshot = useSyncExternalStore(
    (listener) => {
      awareness?.on('change', listener);
      return () => awareness?.off('change', listener);
    },
    () => {
      const states: ReadonlyMap<number, Record<string, unknown>> = awareness?.getStates() ??
      new Map();
      return JSON.stringify([...states.entries()].map(([k, v]) => [k, v['user']] as const));
    },
  );
  const users = awareness ? presentUsers(awareness.getStates(), awareness.clientID) : [];
  void snapshot;
  if (users.length <= 1) return null;
  const shown = users.slice(0, 5);
  return (
    <div
      className="flex items-center -space-x-1.5"
      aria-label={t('editor.presence.viewing', { count: users.length })}
      data-testid="presence"
    >
      {shown.map((user) => (
        <Tooltip key={user.id}>
          <TooltipTrigger asChild>
            <span
              className="flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
              style={{ backgroundColor: user.color }}
            >
              {initials(user.name)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {user.self ? `${user.name} (${t('editor.presence.you')})` : user.name}
          </TooltipContent>
        </Tooltip>
      ))}
      {users.length > shown.length && (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px]">
          +{users.length - shown.length}
        </span>
      )}
    </div>
  );
}
