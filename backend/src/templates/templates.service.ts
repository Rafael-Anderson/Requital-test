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
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SetTemplateProductsDto } from './dto/set-template-products.dto';
import { SetTemplateCollectionsDto } from './dto/set-template-collections.dto';
import type { TemplateRulesDto } from './dto/template-rules.dto';

// Public-facing summary shape both PublicService (storefront) and the admin
// list reuse — full product records are resolved separately (see
// resolveProductIds' own comment on why this stays IDs-only here).
export interface TemplateSummary {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: string;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Admin CRUD ----------

  async findAll(ctx: TenantContext) {
    const templates = await this.prisma.template.findMany({
      where: { shopId: ctx.shopId },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
    // RULE_BASED membership isn't a stored relation (see resolveProductIds),
    // so a real product count means actually resolving each one — no
    // shortcut via Prisma's _count here, that would just report 0 for every
    // rule-based row. Shop-scale template counts make this cheap enough
    // not to need a lighter count-only path.
    return Promise.all(
      templates.map(async (c) => {
        const productIds = await this.resolveProductIds(ctx.shopId, c);
        return this.toAdminResponse(c, productIds.length);
      }),
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const template = await this.assertBelongsToShop(ctx, id);
    const productIds = await this.resolveProductIds(ctx.shopId, template);
    // COLLECTION_GROUP's own membership editor needs the raw
    // templatecollection rows (which Collections, in what order) — a
    // different shape than productIds (the resolved union of their
    // products), which every type already returns above.
    const collectionMemberships =
      template.type === 'COLLECTION_GROUP'
        ? await this.prisma.templatecollection.findMany({
            where: { templateId: id },
            orderBy: { sortOrder: 'asc' },
            select: { collectionId: true, sortOrder: true },
          })
        : undefined;
    return {
      ...this.toAdminResponse(template, productIds.length),
      productIds,
      ...(collectionMemberships && { collections: collectionMemberships }),
    };
  }

  async create(ctx: TenantContext, dto: CreateTemplateDto) {
    this.assertRulesMatchType(dto.type, dto.rules);
    let created: { id: number };
    try {
      created = await this.prisma.template.create({
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

  async update(ctx: TenantContext, id: number, dto: UpdateTemplateDto) {
    const existing = await this.assertBelongsToShop(ctx, id);
    const effectiveType =
      dto.type ??
      (existing.type as 'MANUAL' | 'RULE_BASED' | 'COLLECTION_GROUP');
    // Rules are only re-validated when this request actually touches type or
    // rules — a plain title/description edit shouldn't need to resend rules.
    if (dto.type !== undefined || dto.rules !== undefined) {
      this.assertRulesMatchType(
        effectiveType,
        dto.rules ?? (existing.rules as TemplateRulesDto | null) ?? undefined,
      );
    }

    try {
      await this.prisma.template.update({
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
    const template = await this.assertBelongsToShop(ctx, id);
    await this.prisma.template.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'template.deleted',
      entityType: 'template',
      entityId: id,
      before: { title: template.title },
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
    dto: SetTemplateProductsDto,
  ) {
    const template = await this.assertBelongsToShop(ctx, id);
    if (template.type !== 'MANUAL') {
      throw new BadRequestException(
        'Only a MANUAL template has an explicit product list to set',
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
      this.prisma.templateproduct.deleteMany({ where: { templateId: id } }),
      ...dto.products.map((p) =>
        this.prisma.templateproduct.create({
          data: {
            templateId: id,
            productId: p.productId,
            sortOrder: p.sortOrder,
          },
        }),
      ),
    ]);
    return this.findOne(ctx, id);
  }

  // COLLECTION_GROUP only — full replace of which Collections this Template
  // groups, same "caller sends the complete desired state" convention as
  // setProducts. Every collectionId must belong to this shop.
  async setCollections(
    ctx: TenantContext,
    id: number,
    dto: SetTemplateCollectionsDto,
  ) {
    const template = await this.assertBelongsToShop(ctx, id);
    if (template.type !== 'COLLECTION_GROUP') {
      throw new BadRequestException(
        'Only a COLLECTION_GROUP template has a Collections list to set',
      );
    }
    const collectionIds = dto.collections.map((c) => c.collectionId);
    if (new Set(collectionIds).size !== collectionIds.length) {
      throw new BadRequestException('collectionId must not repeat');
    }
    if (collectionIds.length > 0) {
      const count = await this.prisma.collection.count({
        where: { id: { in: collectionIds }, shopId: ctx.shopId },
      });
      if (count !== collectionIds.length) {
        throw new BadRequestException(
          'One or more collectionIds are invalid for this shop',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.templatecollection.deleteMany({ where: { templateId: id } }),
      ...dto.collections.map((c) =>
        this.prisma.templatecollection.create({
          data: {
            templateId: id,
            collectionId: c.collectionId,
            sortOrder: c.sortOrder,
          },
        }),
      ),
    ]);
    return this.findOne(ctx, id);
  }

  // ---------- Public (storefront) ----------

  async listPublic(shopId: number): Promise<TemplateSummary[]> {
    const templates = await this.prisma.template.findMany({
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
    return templates;
  }

  // Null (not throw) when not found/inactive — PublicService turns that
  // into the 404, same layering as every other public lookup in this app
  // (e.g. PublicService.getProductBySlug does its own NotFoundException,
  // this layer just reports absence).
  async getPublicBySlug(shopId: number, slug: string) {
    const template = await this.prisma.template.findFirst({
      where: { shopId, slug, isActive: true },
    });
    if (!template) return null;
    const productIds = await this.resolveProductIds(shopId, template);
    return { summary: template as TemplateSummary, productIds };
  }

  // MANUAL: the merchant's own explicit order. RULE_BASED: computed at read
  // time against the live product table — membership is never stored, so a
  // price change or a newly-tagged product is reflected immediately without
  // any resync job. Ordered newest-first by default (documented, not
  // configurable — a fixed rule set doesn't need its own sort-order UI on
  // top of the condition fields it already has).
  async resolveProductIds(
    shopId: number,
    template: { id: number; type: string; rules: unknown },
  ): Promise<number[]> {
    if (template.type === 'MANUAL') {
      const rows = await this.prisma.templateproduct.findMany({
        where: { templateId: template.id },
        orderBy: { sortOrder: 'asc' },
        select: { productId: true },
      });
      return rows.map((r) => r.productId);
    }

    if (template.type === 'COLLECTION_GROUP') {
      const memberships = await this.prisma.templatecollection.findMany({
        where: { templateId: template.id },
        orderBy: { sortOrder: 'asc' },
        select: { collectionId: true },
      });
      // Union across member Collections, de-duplicated, preserving each
      // Collection's own product order and the Collections' own sortOrder —
      // a product tagged into two member Collections only appears once.
      const seen = new Set<number>();
      const ids: number[] = [];
      for (const { collectionId } of memberships) {
        const rows = await this.prisma.productcollection.findMany({
          where: { collectionId, product: { shopId, status: 'Available' } },
          select: { productId: true },
        });
        for (const { productId } of rows) {
          if (!seen.has(productId)) {
            seen.add(productId);
            ids.push(productId);
          }
        }
      }
      return ids;
    }

    const rules = (template.rules as TemplateRulesDto | null) ?? {};
    const where: Prisma.productWhereInput = {
      shopId,
      status: 'Available',
      ...(rules.collectionId !== undefined && {
        productcollection: { some: { collectionId: rules.collectionId } },
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

  // Storefront PDP "related products" reverse lookup (Phase 8.4) — template
  // membership is a stronger merchandising signal than collection (a merchant
  // curates it on purpose), so PublicService.getRelatedProducts tries this
  // first and falls back to same-collection only when it comes up empty.
  // Reuses resolveProductIds per active template rather than a dedicated
  // reverse-rule-evaluation query — shops only ever have a handful of
  // templates (config data, not a hot list), so re-resolving each one is
  // cheap and avoids duplicating the MANUAL/RULE_BASED branching a second time.
  async findRelatedProductIds(
    shopId: number,
    productId: number,
    limit = 4,
  ): Promise<number[]> {
    const templates = await this.prisma.template.findMany({
      where: { shopId, isActive: true },
      select: { id: true, type: true, rules: true },
    });
    const related = new Set<number>();
    for (const template of templates) {
      const productIds = await this.resolveProductIds(shopId, template);
      if (!productIds.includes(productId)) continue;
      for (const id of productIds) {
        if (id !== productId) related.add(id);
      }
      if (related.size >= limit) break;
    }
    return [...related].slice(0, limit);
  }

  // ---------- shared helpers ----------

  private assertRulesMatchType(
    type: 'MANUAL' | 'RULE_BASED' | 'COLLECTION_GROUP',
    rules: TemplateRulesDto | undefined,
  ) {
    if (type === 'RULE_BASED') {
      const hasAnyRule =
        rules &&
        (rules.collectionId !== undefined ||
          rules.tagName !== undefined ||
          rules.minPrice !== undefined ||
          rules.maxPrice !== undefined ||
          rules.createdWithinDays !== undefined);
      if (!hasAnyRule) {
        throw new BadRequestException(
          'A RULE_BASED template needs at least one rule condition set',
        );
      }
    } else if (rules !== undefined) {
      throw new BadRequestException(
        "rules can only be set when type is 'RULE_BASED'",
      );
    }
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const template = await this.prisma.template.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return template;
  }

  private toAdminResponse(
    template: Prisma.templateGetPayload<object>,
    productCount: number,
  ) {
    return {
      id: template.id,
      title: template.title,
      slug: template.slug,
      description: template.description,
      image: template.image,
      type: template.type,
      rules: template.rules,
      isActive: template.isActive,
      displayOrder: template.displayOrder,
      productCount,
      createdAt: template.createdAt,
    };
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(
        'A template with this slug already exists',
      );
    }
    throw error;
  }
}
