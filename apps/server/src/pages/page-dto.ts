// SPDX-License-Identifier: AGPL-3.0-only
import type { PageDto } from '@ardoise/shared';
import type { PagePatch, PageRecord } from '../store/store.js';

export function toPageDto(page: PageRecord, hasChildren: boolean): PageDto {
  return {
    id: page.id,
    kind: page.kind,
    parentKind: page.parentKind,
    parentId: page.parentId,
    position: page.position,
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    width: page.width,
    font: page.font,
    isLocked: page.isLocked,
    restrictInheritance: page.restrictInheritance,
    isInline: page.isInline,
    isTemplate: page.isTemplate,
    moveState: page.moveState,
    createdBy: page.createdBy,
    createdAt: page.createdAt.toISOString(),
    updatedBy: page.updatedBy,
    updatedAt: page.updatedAt.toISOString(),
    deletedAt: page.deletedAt?.toISOString() ?? null,
    deletedRootId: page.deletedRootId,
    hasChildren,
  };
}

/** The columns a mutation may change, from the post-change DTO. */
export function patchFromDto(
  dto: PageDto,
): Omit<Required<PagePatch>, 'path' | 'isInline' | 'isTemplate'> {
  return {
    parentKind: dto.parentKind,
    parentId: dto.parentId,
    position: dto.position,
    title: dto.title,
    icon: dto.icon,
    cover: dto.cover,
    width: dto.width,
    font: dto.font,
    isLocked: dto.isLocked,
    restrictInheritance: dto.restrictInheritance,
    moveState: dto.moveState,
    updatedBy: dto.updatedBy,
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
    deletedRootId: dto.deletedRootId,
  };
}
