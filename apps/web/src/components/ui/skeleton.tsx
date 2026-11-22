// SPDX-License-Identifier: AGPL-3.0-only
// Based on shadcn/ui (MIT), see THIRD_PARTY_NOTICES.md.
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  );
}

export { Skeleton };
