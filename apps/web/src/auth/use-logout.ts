// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { clearSession } from '@/auth/session';
import { api } from '@/lib/api';

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => {
      clearSession(queryClient);
      void router.navigate({ to: '/login', search: {} });
    },
  });
}
