// SPDX-License-Identifier: AGPL-3.0-only
/** "Today", "Tomorrow", "Yesterday" or a localized date. */
export function formatMentionDate(
  iso: string,
  locale: string,
  now = new Date(),
): { label: string; relative: boolean } {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { label: iso, relative: false };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (Math.abs(days) <= 1) {
    return {
      label: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day'),
      relative: true,
    };
  }
  return {
    label: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date),
    relative: false,
  };
}
