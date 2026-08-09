import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.prisma.collection.findMany({
      where: { shopId: ctx.shopId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(ctx: TenantContext, id: number) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!collection) {
      throw new NotFoundException(`Collection ${id} not found`);
    }
    return collection;
  }

  async create(ctx: TenantContext, dto: CreateCollectionDto) {
    if (dto.parentCollectionId !== undefined) {
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
    }

    try {
      return await this.prisma.collection.create({
        data: {
          shopId: ctx.shopId,
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          parentCollectionId: dto.parentCollectionId,
          displayOrder: dto.displayOrder ?? 0,
          image: dto.image,
          isFeatured: dto.isFeatured ?? false,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCollectionDto) {
    await this.findOne(ctx, id);

    if (dto.parentCollectionId !== undefined && dto.parentCollectionId !== null) {
      if (dto.parentCollectionId === id) {
        throw new BadRequestException('A collection cannot be its own parent');
      }
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
      await this.assertNoCycle(ctx, id, dto.parentCollectionId);
    }

    try {
      return await this.prisma.collection.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          displayOrder: dto.displayOrder,
          isFeatured: dto.isFeatured,
          ...(dto.parentCollectionId !== undefined && {
            parentCollectionId: dto.parentCollectionId,
          }),
          ...(dto.image !== undefined && { image: dto.image }),
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const collection = await this.findOne(ctx, id);

    const [childCount, productCount] = await this.prisma.$transaction([
      this.prisma.collection.count({ where: { parentCollectionId: id } }),
      this.prisma.productcollection.count({ where: { collectionId: id } }),
    ]);
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        `Cannot delete: this collection has ${childCount} sub-collection${childCount === 1 ? '' : 's'} and ${productCount} product${productCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    await this.prisma.collection.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'collection.deleted',
      entityType: 'collection',
      entityId: id,
      before: { name: collection.name },
    });
    return { id, deleted: true };
  }

  // Every id must belong to this shop (validated up front, before any
  // writes) — a stray/foreign id in the array rejects the whole request
  // rather than partially reordering. Same pattern as BioLinksService.reorder.
  async reorder(ctx: TenantContext, dto: ReorderCollectionsDto) {
    const existing = await this.prisma.collection.findMany({
      where: { shopId: ctx.shopId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's collection ids",
      );
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.collection.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );
    return this.findAll(ctx);
  }

  private async assertParentBelongsToShop(
    ctx: TenantContext,
    parentCollectionId: number,
  ) {
    const parent = await this.prisma.collection.findFirst({
      where: { id: parentCollectionId, shopId: ctx.shopId },
    });
    if (!parent) {
      throw new BadRequestException(
        'parentCollectionId is invalid for this shop',
      );
    }
  }

  // Walks the proposed new parent's ancestor chain — if the collection being
  // moved (id) appears anywhere in it, reassigning would create a cycle.
  private async assertNoCycle(
    ctx: TenantContext,
    id: number,
    proposedParentId: number,
  ) {
    let cursor: number | null = proposedParentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === id) {
        throw new BadRequestException(
          'This move would make the collection an ancestor of itself',
        );
      }
      if (seen.has(cursor)) break; // defensive: pre-existing cycle, stop walking
      seen.add(cursor);
      const node: { parentCollectionId: number | null } | null =
        await this.prisma.collection.findFirst({
          where: { id: cursor, shopId: ctx.shopId },
          select: { parentCollectionId: true },
        });
      cursor = node?.parentCollectionId ?? null;
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A collection with this slug already exists');
    }
    throw error;
  }
}
