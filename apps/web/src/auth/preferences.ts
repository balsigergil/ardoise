// SPDX-License-Identifier: AGPL-3.0-only
import type { MeDto, UpdateMeInput } from '@ardoise/shared';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useTheme } from '@/theme/theme-context';
import { useSession, useUpdateMeInCache } from './session';

/** Saves a preference on the account when signed in (PRODUCT §3: per-user language and theme). */
export function useSavePreference() {
  const session = useSession();
  const update = useUpdateMeInCache();
  return (patch: Pick<UpdateMeInput, 'locale' | 'theme'>) => {
    if (!session) return;
    void api
      .patch<MeDto>('/api/me', patch)
      .then(update)
      .catch(() => undefined); // the local choice still applies
  };
}

/** Applies the account's language and theme once per signed-in user. */
export function usePreferenceSync(): void {
  const session = useSession();
  const { i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const user = session?.user;
    if (!user || applied.current === user.id) return;
    applied.current = user.id;
    if (user.locale && user.locale !== i18n.language) void changeLanguage(i18n, user.locale);
    if (user.theme !== preference) setPreference(user.theme);
  }, [session, i18n, preference, setPreference]);
}
