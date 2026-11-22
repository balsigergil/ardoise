// SPDX-License-Identifier: AGPL-3.0-only
import type { PageCover } from '@ardoise/shared';

/** Tailwind classes for page covers (solid and gradient, light and dark). */
export const COVER_CLASSES: Record<string, string> = {
  gray: 'bg-zinc-300 dark:bg-zinc-700',
  brown: 'bg-amber-800/60',
  orange: 'bg-orange-300 dark:bg-orange-800',
  yellow: 'bg-yellow-200 dark:bg-yellow-700',
  green: 'bg-emerald-300 dark:bg-emerald-800',
  blue: 'bg-sky-300 dark:bg-sky-800',
  purple: 'bg-violet-300 dark:bg-violet-800',
  pink: 'bg-pink-300 dark:bg-pink-800',
  red: 'bg-rose-300 dark:bg-rose-800',
  dawn: 'bg-gradient-to-r from-amber-200 via-rose-200 to-violet-300 dark:from-amber-800 dark:via-rose-800 dark:to-violet-900',
  dusk: 'bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900',
  ocean:
    'bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-400 dark:from-cyan-900 dark:via-sky-900 dark:to-blue-950',
  forest:
    'bg-gradient-to-r from-lime-200 via-emerald-300 to-teal-500 dark:from-lime-900 dark:via-emerald-900 dark:to-teal-950',
};

export function coverClass(cover: PageCover): string {
  return cover ? (COVER_CLASSES[cover.value] ?? '') : '';
}
