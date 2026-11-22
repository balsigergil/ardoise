// SPDX-License-Identifier: AGPL-3.0-only
import type { TeamspaceDto, WorkspaceDto, Page } from '@ardoise/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, pageQuery } from '@/lib/api';

export const SIDEBAR_TEAMSPACE_LIMIT = 100;

export const workspacesQuery = queryOptions({
  queryKey: ['workspaces'],
  queryFn: () => api.get<WorkspaceDto[]>('/api/workspaces'),
  staleTime: 60_000,
});

export const workspaceQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId],
    queryFn: () => api.get<WorkspaceDto>(`/api/workspaces/${workspaceId}`),
    staleTime: 60_000,
  });

/** Teamspaces the user belongs to, for the sidebar (bounded). */
export const myTeamspacesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'teamspaces', 'mine'],
    queryFn: () =>
      api.get<Page<TeamspaceDto>>(
        `/api/workspaces/${workspaceId}/teamspaces${pageQuery({ limit: SIDEBAR_TEAMSPACE_LIMIT })}&mine=true`,
      ),
    staleTime: 60_000,
  });

export const teamspaceQuery = (workspaceId: string, teamspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'teamspaces', teamspaceId],
    queryFn: () =>
      api.get<TeamspaceDto>(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}`),
  });
