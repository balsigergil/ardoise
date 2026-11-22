// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';

/** Localized message for an API error code (`errors.codes.*`). */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const code = error instanceof ApiError ? error.code : 'internal_error';
    return t(`errors.codes.${code}`);
  };
}

/** Reads named string fields from a submitted form. */
export function formValues<K extends string>(
  form: HTMLFormElement,
  ...names: K[]
): Record<K, string> {
  const data = new FormData(form);
  return Object.fromEntries(
    names.map((n) => {
      const value = data.get(n);
      return [n, typeof value === 'string' ? value : ''];
    }),
  ) as Record<K, string>;
}
