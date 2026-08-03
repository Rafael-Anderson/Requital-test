import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { SetCollectionProductsDto } from './dto/set-collection-products.dto';
import type { CollectionRulesDto } from './dto/collection-rules.dto';

// Public-facing summary shape both PublicService (storefront) and the admin
// list reuse — full product records are resolved separately (see
// resolveProductIds' own comment on why this stays IDs-only here).
export interface CollectionSummary {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: string;
}

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Admin CRUD ----------

  async findAll(ctx: TenantContext) {
    const collections = await this.prisma.collection.findMany({
      where: { shopId: ctx.shopId },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
    // RULE_BASED membership isn't a stored relation (see resolveProductIds),
    // so a real product count means actually resolving each one — no
    // shortcut via Prisma's _count here, that would just report 0 for every
    // rule-based row. Shop-scale collection counts make this cheap enough
    // not to need a lighter count-only path.
    return Promise.all(
      collections.map(async (c) => {
        const productIds = await this.resolveProductIds(ctx.shopId, c);
        return this.toAdminResponse(c, productIds.length);
      }),
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const collection = await this.assertBelongsToShop(ctx, id);
    const productIds = await this.resolveProductIds(ctx.shopId, collection);
    return {
      ...this.toAdminResponse(collection, productIds.length),
      productIds,
    };
  }

  async create(ctx: TenantContext, dto: CreateCollectionDto) {
    this.assertRulesMatchType(dto.type, dto.rules);
    let created: { id: number };
    try {
      created = await this.prisma.collection.create({
        data: {
          shopId: ctx.shopId,
          title: dto.title,
          slug: dto.slug ?? slugify(dto.title),
          description: dto.description,
          image: dto.image,
          type: dto.type,
          rules:
            dto.type === 'RULE_BASED'
              ? (dto.rules as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
    // Routed through findOne rather than returning the raw create() result —
    // same shape (productCount included) every other admin response has.
    return this.findOne(ctx, created.id);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCollectionDto) {
    const existing = await this.assertBelongsToShop(ctx, id);
    const effectiveType =
      dto.type ?? (existing.type as 'MANUAL' | 'RULE_BASED');
    // Rules are only re-validated when this request actually touches type or
    // rules — a plain title/description edit shouldn't need to resend rules.
    if (dto.type !== undefined || dto.rules !== undefined) {
      this.assertRulesMatchType(
        effectiveType,
        dto.rules ?? (existing.rules as CollectionRulesDto | null) ?? undefined,
      );
    }

    try {
      await this.prisma.collection.update({
        where: { id },
        data: {
          title: dto.title,
          slug: dto.slug,
          description: dto.description,
          ...(dto.image !== undefined && { image: dto.image }),
          type: dto.type,
          ...((dto.type !== undefined || dto.rules !== undefined) && {
            rules:
              effectiveType === 'RULE_BASED'
                ? (dto.rules as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          }),
          isActive: dto.isActive,
          displayOrder: dto.displayOrder,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
    return this.findOne(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const collection = await this.assertBelongsToShop(ctx, id);
    await this.prisma.collection.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'collection.deleted',
      entityType: 'collection',
      entityId: id,
      before: { title: collection.title },
    });
    return { id, deleted: true };
  }

  // MANUAL only — full replace of membership + order, same "caller sends
  // the complete desired state" convention as reorderBioLinks. Every
  // productId must belong to this shop, checked up front so a bad id
  // rejects the whole request rather than partially saving.
  async setProducts(
    ctx: TenantContext,
    id: number,
    dto: SetCollectionProductsDto,
  ) {
    const collection = await this.assertBelongsToShop(ctx, id);
    if (collection.type !== 'MANUAL') {
      throw new BadRequestException(
        'Only a MANUAL collection has an explicit product list to set',
      );
    }
    const productIds = dto.products.map((p) => p.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('productId must not repeat');
    }
    if (productIds.length > 0) {
      const count = await this.prisma.product.count({
        where: { id: { in: productIds }, shopId: ctx.shopId },
      });
      if (count !== productIds.length) {
        throw new BadRequestException(
          'One or more productIds are invalid for this shop',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.collectionproduct.deleteMany({ where: { collectionId: id } }),
      ...dto.products.map((p) =>
        this.prisma.collectionproduct.create({
          data: {
            collectionId: id,
            productId: p.productId,
            sortOrder: p.sortOrder,
          },
        }),
      ),
    ]);
    return this.findOne(ctx, id);
  }

  // ---------- Public (storefront) ----------

  async listPublic(shopId: number): Promise<CollectionSummary[]> {
    const collections = await this.prisma.collection.findMany({
      where: { shopId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        image: true,
        type: true,
      },
    });
    return collections;
  }

  // Null (not throw) when not found/inactive — PublicService turns that
  // into the 404, same layering as every other public lookup in this app
  // (e.g. PublicService.getProductBySlug does its own NotFoundException,
  // this layer just reports absence).
  async getPublicBySlug(shopId: number, slug: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { shopId, slug, isActive: true },
    });
    if (!collection) return null;
    const productIds = await this.resolveProductIds(shopId, collection);
    return { summary: collection as CollectionSummary, productIds };
  }

  // MANUAL: the merchant's own explicit order. RULE_BASED: computed at read
  // time against the live product table — membership is never stored, so a
  // price change or a newly-tagged product is reflected immediately without
  // any resync job. Ordered newest-first by default (documented, not
  // configurable — a fixed rule set doesn't need its own sort-order UI on
  // top of the condition fields it already has).
  async resolveProductIds(
    shopId: number,
    collection: { id: number; type: string; rules: unknown },
  ): Promise<number[]> {
    if (collection.type === 'MANUAL') {
      const rows = await this.prisma.collectionproduct.findMany({
        where: { collectionId: collection.id },
        orderBy: { sortOrder: 'asc' },
        select: { productId: true },
      });
      return rows.map((r) => r.productId);
    }

    const rules = (collection.rules as CollectionRulesDto | null) ?? {};
    const where: Prisma.productWhereInput = {
      shopId,
      status: 'Available',
      ...(rules.categoryId !== undefined && {
        productcategory: { some: { categoryId: rules.categoryId } },
      }),
      ...(rules.tagName !== undefined && {
        producttag: { some: { tag: { name: rules.tagName } } },
      }),
      ...((rules.minPrice !== undefined || rules.maxPrice !== undefined) && {
        price: {
          ...(rules.minPrice !== undefined && { gte: rules.minPrice }),
          ...(rules.maxPrice !== undefined && { lte: rules.maxPrice }),
        },
      }),
      ...(rules.createdWithinDays !== undefined && {
        createdAt: {
          gte: new Date(
            Date.now() - rules.createdWithinDays * 24 * 60 * 60 * 1000,
          ),
        },
      }),
    };
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ---------- shared helpers ----------

  private assertRulesMatchType(
    type: 'MANUAL' | 'RULE_BASED',
    rules: CollectionRulesDto | undefined,
  ) {
    if (type === 'RULE_BASED') {
      const hasAnyRule =
        rules &&
        (rules.categoryId !== undefined ||
          rules.tagName !== undefined ||
          rules.minPrice !== undefined ||
          rules.maxPrice !== undefined ||
          rules.createdWithinDays !== undefined);
      if (!hasAnyRule) {
        throw new BadRequestException(
          'A RULE_BASED collection needs at least one rule condition set',
        );
      }
    } else if (rules !== undefined) {
      throw new BadRequestException(
        "rules can only be set when type is 'RULE_BASED'",
      );
    }
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!collection) {
      throw new NotFoundException(`Collection ${id} not found`);
    }
    return collection;
  }

  private toAdminResponse(
    collection: Prisma.collectionGetPayload<object>,
    productCount: number,
  ) {
    return {
      id: collection.id,
      title: collection.title,
      slug: collection.slug,
      description: collection.description,
      image: collection.image,
      type: collection.type,
      rules: collection.rules,
      isActive: collection.isActive,
      displayOrder: collection.displayOrder,
      productCount,
      createdAt: collection.createdAt,
    };
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(
        'A collection with this slug already exists',
      );
    }
    throw error;
  }
}
