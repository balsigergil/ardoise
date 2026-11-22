// SPDX-License-Identifier: AGPL-3.0-only
/** Only same-app paths are followed after sign-in (no open redirects). */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  return value;
}
