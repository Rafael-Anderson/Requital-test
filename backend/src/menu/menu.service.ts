import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderMenuItemsDto } from './dto/reorder-menu-items.dto';
import type { MenuItemType } from './menu-constants';

const menuItemInclude = {
  collection: { select: { id: true, name: true, slug: true } },
  menuitemcollection: {
    orderBy: { sortOrder: 'asc' as const },
    include: { collection: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.menuitemInclude;

type MenuItemWithRelations = Prisma.menuitemGetPayload<{
  include: typeof menuItemInclude;
}>;

// The storefront's merchant-configurable top-bar "Menu" (Phase C) — a
// merchant-ordered list of LINK (one Collection) / DROPDOWN (several
// Collections) items. Admin-only end to end, same tier as Collections.
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(ctx: TenantContext) {
    const items = await this.prisma.menuitem.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { displayOrder: 'asc' },
      include: menuItemInclude,
    });
    return items.map((i) => this.toAdminResponse(i));
  }

  async findOne(ctx: TenantContext, id: number) {
    const item = await this.assertBelongsToShop(ctx, id);
    return this.toAdminResponse(item);
  }

  async create(ctx: TenantContext, dto: CreateMenuItemDto) {
    this.assertFieldsMatchType(dto.type, dto);
    if (dto.collectionId) {
      await this.assertCollectionBelongsToShop(ctx, dto.collectionId);
    }
    if (dto.collections?.length) {
      await this.assertCollectionsBelongToShop(
        ctx,
        dto.collections.map((c) => c.collectionId),
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const item = await tx.menuitem.create({
        data: {
          shopId: ctx.shopId,
          label: dto.label,
          type: dto.type,
          collectionId: dto.type === 'LINK' ? dto.collectionId : null,
          displayOrder: dto.displayOrder ?? 0,
        },
      });
      if (dto.type === 'DROPDOWN' && dto.collections?.length) {
        await tx.menuitemcollection.createMany({
          data: dto.collections.map((c) => ({
            menuItemId: item.id,
            collectionId: c.collectionId,
            sortOrder: c.sortOrder,
          })),
        });
      }
      return item;
    });
    return this.findOne(ctx, created.id);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateMenuItemDto) {
    const existing = await this.assertBelongsToShop(ctx, id);

    const touchesTarget =
      dto.type !== undefined ||
      dto.collectionId !== undefined ||
      dto.collections !== undefined;
    const effectiveType = dto.type ?? (existing.type as MenuItemType);

    let collectionId: number | null | undefined;
    let collections: { collectionId: number; sortOrder: number }[] | undefined;
    if (touchesTarget) {
      const merged = {
        collectionId: dto.collectionId,
        collections: dto.collections,
      };
      this.assertFieldsMatchType(effectiveType, merged);
      collectionId = effectiveType === 'LINK' ? (dto.collectionId ?? null) : null;
      collections = effectiveType === 'DROPDOWN' ? dto.collections : [];

      if (collectionId) {
        await this.assertCollectionBelongsToShop(ctx, collectionId);
      }
      if (collections?.length) {
        await this.assertCollectionsBelongToShop(
          ctx,
          collections.map((c) => c.collectionId),
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.menuitem.update({
        where: { id },
        data: {
          label: dto.label,
          type: dto.type,
          displayOrder: dto.displayOrder,
          ...(touchesTarget && { collectionId }),
        },
      });
      if (touchesTarget) {
        await tx.menuitemcollection.deleteMany({ where: { menuItemId: id } });
        if (collections?.length) {
          await tx.menuitemcollection.createMany({
            data: collections.map((c) => ({
              menuItemId: id,
              collectionId: c.collectionId,
              sortOrder: c.sortOrder,
            })),
          });
        }
      }
    });
    return this.findOne(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const item = await this.assertBelongsToShop(ctx, id);
    await this.prisma.menuitem.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'menuitem.deleted',
      entityType: 'menuitem',
      entityId: id,
      before: { label: item.label },
    });
    return { id, deleted: true };
  }

  // ---------- Public (storefront) ----------

  async listPublic(shopId: number) {
    const items = await this.prisma.menuitem.findMany({
      where: { shopId },
      orderBy: { displayOrder: 'asc' },
      include: menuItemInclude,
    });
    return items.map((i) => this.toAdminResponse(i));
  }

  // ---------- Admin CRUD (cont'd) ----------

  // Every id must belong to this shop, same pattern as
  // BioLinksService.reorder / CollectionsService.reorder.
  async reorder(ctx: TenantContext, dto: ReorderMenuItemsDto) {
    const existing = await this.prisma.menuitem.findMany({
      where: { shopId: ctx.shopId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((i) => i.id));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's menu item ids",
      );
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.menuitem.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );
    return this.findAll(ctx);
  }

  private assertFieldsMatchType(
    type: MenuItemType,
    fields: {
      collectionId?: number;
      collections?: { collectionId: number; sortOrder: number }[];
    },
  ) {
    if (type === 'LINK') {
      if (!fields.collectionId) {
        throw new BadRequestException(
          "type 'LINK' requires collectionId to be set",
        );
      }
      if (fields.collections?.length) {
        throw new BadRequestException(
          "type 'LINK' must not set collections (that's DROPDOWN-only)",
        );
      }
    } else {
      if (fields.collectionId) {
        throw new BadRequestException(
          "type 'DROPDOWN' must not set collectionId (that's LINK-only)",
        );
      }
      if (!fields.collections?.length) {
        throw new BadRequestException(
          "type 'DROPDOWN' requires at least one collection",
        );
      }
    }
  }

  private async assertBelongsToShop(
    ctx: TenantContext,
    id: number,
  ): Promise<MenuItemWithRelations> {
    const item = await this.prisma.menuitem.findFirst({
      where: { id, shopId: ctx.shopId },
      include: menuItemInclude,
    });
    if (!item) {
      throw new NotFoundException(`Menu item ${id} not found`);
    }
    return item;
  }

  private async assertCollectionBelongsToShop(
    ctx: TenantContext,
    collectionId: number,
  ) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, shopId: ctx.shopId },
    });
    if (!collection) {
      throw new NotFoundException(`Collection ${collectionId} not found`);
    }
  }

  private async assertCollectionsBelongToShop(
    ctx: TenantContext,
    collectionIds: number[],
  ) {
    const uniqueIds = [...new Set(collectionIds)];
    const count = await this.prisma.collection.count({
      where: { id: { in: uniqueIds }, shopId: ctx.shopId },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more collectionIds are invalid for this shop',
      );
    }
  }

  private toAdminResponse(item: MenuItemWithRelations) {
    return {
      id: item.id,
      label: item.label,
      type: item.type,
      displayOrder: item.displayOrder,
      collectionId: item.collectionId,
      collection: item.collection,
      collections: item.menuitemcollection.map((mic) => ({
        collectionId: mic.collectionId,
        sortOrder: mic.sortOrder,
        collection: mic.collection,
      })),
    };
  }
}
