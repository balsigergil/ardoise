// SPDX-License-Identifier: AGPL-3.0-only
import type { PageIcon as PageIconValue } from '@ardoise/shared';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageIcon({
  icon,
  className,
}: {
  icon: PageIconValue | undefined;
  className?: string;
}) {
  if (icon?.type === 'emoji')
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center leading-none',
          className,
        )}
      >
        {icon.value}
      </span>
    );
  return (
    <FileText
      aria-hidden="true"
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
    />
  );
}
