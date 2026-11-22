// SPDX-License-Identifier: AGPL-3.0-only
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Same-origin check for state-changing requests (defense in depth with SameSite and
 * CSRF tokens). A missing `Origin` is accepted when `Sec-Fetch-Site` does not say
 * cross-site, so non-browser clients keep working.
 */
export function isSameOriginRequest(
  headers: { origin?: string | undefined; secFetchSite?: string | undefined },
  publicUrl: string,
): boolean {
  if (headers.origin !== undefined) {
    if (headers.origin === 'null') return false;
    return (
      URL.canParse(headers.origin) && new URL(headers.origin).origin === new URL(publicUrl).origin
    );
  }
  return (
    headers.secFetchSite === undefined || ['same-origin', 'none'].includes(headers.secFetchSite)
  );
}
