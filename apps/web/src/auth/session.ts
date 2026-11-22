// SPDX-License-Identifier: AGPL-3.0-only
import type { InstanceInfoDto, MeDto, SessionDto, SetupStatusDto } from '@ardoise/shared';
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from '@/lib/api';

export const sessionKey = ['session'] as const;

export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: async (): Promise<SessionDto | null> => {
    try {
      const session = await api.get<SessionDto>('/api/auth/session');
      setCsrfToken(session.csrfToken);
      return session;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCsrfToken(undefined);
        return null;
      }
      throw error;
    }
  },
  staleTime: 5 * 60_000,
});

export const setupStatusQuery = queryOptions({
  queryKey: ['setup'],
  queryFn: () => api.get<SetupStatusDto>('/api/setup'),
  staleTime: 60_000,
});

export const instanceInfoQuery = queryOptions({
  queryKey: ['instance'],
  queryFn: () => api.get<InstanceInfoDto>('/api/instance'),
  staleTime: 60_000,
});

/** Stores a session returned by login, setup or invitation acceptance. */
export function applySession(queryClient: QueryClient, session: SessionDto): void {
  setCsrfToken(session.csrfToken);
  queryClient.setQueryData(sessionKey, session);
}

/** After logout or revocation: forget every cached response. */
export function clearSession(queryClient: QueryClient): void {
  setCsrfToken(undefined);
  queryClient.clear();
  queryClient.setQueryData(sessionKey, null);
}

export function useSession(): SessionDto | null {
  return useQuery(sessionQuery).data ?? null;
}

/** The signed-in user; only inside authenticated routes. */
export function useMe(): MeDto {
  const session = useSession();
  if (!session) throw new Error('useMe outside an authenticated route');
  return session.user;
}

export function useUpdateMeInCache() {
  const queryClient = useQueryClient();
  return (user: MeDto) =>
    queryClient.setQueryData(sessionKey, (old: SessionDto | null | undefined) =>
      old ? { ...old, user } : old,
    );
}
