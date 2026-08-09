import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { parseCsv } from '../common/csv.util';
import {
  ImportAction,
  ImportRowResult,
  parseImportBoolean,
  parseImportNumber,
} from '../products/products-import';

function includeFor(outletId: number | undefined) {
  return {
    category: { select: { id: true, name: true } },
    ...(outletId !== undefined && {
      outletingredientstock: {
        where: { outletId },
        select: { stockQuantity: true, lowStockThreshold: true },
      },
    }),
  } satisfies Prisma.ingredientInclude;
}

type IngredientWithStock = Prisma.ingredientGetPayload<{
  include: ReturnType<typeof includeFor>;
}>;

// Deliberately a much lighter CRUD than ProductsService — no categories,
// tags, images, options/variants, SEO, or publishing fields exist on this
// model at all (see schema.prisma's comment on `ingredient` for why this is
// a separate model rather than a Product flag). Stock transfer/adjustment
// itself stays in ProductsService (see its transferStock/
// adjustStockWithReason — extended to accept ingredientId as an alternative
// to productId) rather than duplicated here, per the task's "reuse the
// existing StockMovement endpoints" instruction.
@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  async findAll(
    ctx: TenantContext,
    requestedOutletId?: number,
    categoryId?: number,
  ) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    // Ingredients are shop-wide catalog (like Products) — outletId here is
    // just which outlet's stock count to attach, not a resource the
    // ingredient "belongs to." Skipped when undefined (admin viewing
    // without picking one outlet), same aggregate-ignores-overrides
    // reasoning as Dashboard.
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'ingredients.view',
      );
    }
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        shopId: ctx.shopId,
        // Phase A: a usesIngredients:false product/variant's auto-managed
        // shadow ingredient is never a merchant-manageable ingredient —
        // excluded here (the single query every other consumer of this
        // list, incl. CSV export, goes through) rather than filtered by
        // each caller. See ingredient.shadowProductId's schema comment.
        shadowProductId: null,
        shadowVariantId: null,
        ...(categoryId !== undefined && { categoryId }),
      },
      include: includeFor(outletId),
      orderBy: { id: 'asc' },
    });
    return ingredients.map((i) => this.toResponse(i, outletId));
  }

  async findOne(ctx: TenantContext, id: number, requestedOutletId?: number) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'ingredients.view',
      );
    }
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, shopId: ctx.shopId, shadowProductId: null, shadowVariantId: null },
      include: includeFor(outletId),
    });
    if (!ingredient) {
      throw new NotFoundException(`Ingredient ${id} not found`);
    }
    return this.toResponse(ingredient, outletId);
  }

  async create(ctx: TenantContext, dto: CreateIngredientDto) {
    if (dto.categoryId !== undefined) {
      await this.assertCategoryBelongsToShop(ctx, dto.categoryId);
    }
    const ingredient = await this.prisma.ingredient.create({
      data: {
        shopId: ctx.shopId,
        name: dto.name,
        unit: dto.unit,
        trackInventory: dto.trackInventory ?? true,
        image: dto.image,
        description: dto.description,
        costPerUnit: dto.costPerUnit,
        supplier: dto.supplier,
        categoryId: dto.categoryId,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return this.toResponse(
      { ...ingredient, outletingredientstock: [] },
      undefined,
    );
  }

  async update(ctx: TenantContext, id: number, dto: UpdateIngredientDto) {
    await this.assertBelongsToShop(ctx, id);
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.assertCategoryBelongsToShop(ctx, dto.categoryId);
    }
    const ingredient = await this.prisma.ingredient.update({
      where: { id },
      data: {
        name: dto.name,
        unit: dto.unit,
        trackInventory: dto.trackInventory,
        image: dto.image,
        description: dto.description,
        costPerUnit: dto.costPerUnit,
        supplier: dto.supplier,
        categoryId: dto.categoryId,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return this.toResponse(
      { ...ingredient, outletingredientstock: [] },
      undefined,
    );
  }

  private async assertCategoryBelongsToShop(
    ctx: TenantContext,
    categoryId: number,
  ) {
    const category = await this.prisma.ingredientcategory.findFirst({
      where: { id: categoryId, shopId: ctx.shopId },
    });
    if (!category) {
      throw new NotFoundException('categoryId is invalid for this shop');
    }
  }

  private async assertOutletBelongsToShop(
    ctx: TenantContext,
    outletId: number,
  ) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new NotFoundException('outletId is invalid for this shop');
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const ingredient = await this.assertBelongsToShop(ctx, id);
    await this.prisma.ingredient.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'ingredient.deleted',
      entityType: 'ingredient',
      entityId: id,
      before: { name: ingredient.name },
    });
    return { id, deleted: true };
  }

  // Same stateless preview/confirm pair and shopId-scoped-name matching
  // convention as ProductsService's CSV import — see the comment there for
  // the full rationale.
  async previewImportIngredients(
    ctx: TenantContext,
    file: Express.Multer.File,
  ) {
    const rawRows = parseCsv(file.buffer.toString('utf-8'));
    const { results } = await this.classifyImportRows(ctx, rawRows);
    return { rows: results };
  }

  async confirmImportIngredients(
    ctx: TenantContext,
    file: Express.Multer.File,
    outletId: number | undefined,
  ) {
    if (outletId !== undefined) {
      await this.assertOutletBelongsToShop(ctx, outletId);
    }
    const rawRows = parseCsv(file.buffer.toString('utf-8'));
    const { results, groups } = await this.classifyImportRows(ctx, rawRows);

    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const group of groups) {
        if (group.action === 'reject') continue;

        let ingredientId: number;
        if (group.action === 'create') {
          const newIngredient = await tx.ingredient.create({
            data: {
              shopId: ctx.shopId,
              name: group.data.name,
              unit: group.data.unit!,
              trackInventory: group.data.trackInventory ?? true,
            },
            select: { id: true },
          });
          ingredientId = newIngredient.id;
          created += 1;
        } else {
          ingredientId = group.ingredientId!;
          await tx.ingredient.update({
            where: { id: ingredientId },
            data: {
              unit: group.data.unit,
              trackInventory: group.data.trackInventory,
            },
          });
          updated += 1;
        }

        if (group.stock !== undefined && outletId !== undefined) {
          const before =
            (
              await tx.outletingredientstock.findUnique({
                where: { outletId_ingredientId: { outletId, ingredientId } },
              })
            )?.stockQuantity ?? 0;
          await tx.outletingredientstock.upsert({
            where: { outletId_ingredientId: { outletId, ingredientId } },
            update: { stockQuantity: group.stock },
            create: { outletId, ingredientId, stockQuantity: group.stock },
          });
          await tx.stockmovement.create({
            data: {
              shopId: ctx.shopId,
              productId: null,
              variantId: null,
              ingredientId,
              type: 'IMPORT',
              reason: null,
              delta: group.stock - before,
              outletId,
              toOutletId: null,
              note: 'CSV import',
              actorUserId: ctx.userId,
            },
          });
        }
      }
    });

    return {
      rows: results,
      created,
      updated,
      skipped: results.filter((r) => r.action === 'reject').length,
    };
  }

  private async classifyImportRows(
    ctx: TenantContext,
    rawRows: Record<string, string>[],
  ): Promise<{
    results: ImportRowResult[];
    groups: {
      rowNumber: number;
      action: ImportAction;
      ingredientId?: number;
      data: { name: string; unit?: string; trackInventory?: boolean };
      stock?: number;
    }[];
  }> {
    const results: ImportRowResult[] = [];
    const groups: {
      rowNumber: number;
      action: ImportAction;
      ingredientId?: number;
      data: { name: string; unit?: string; trackInventory?: boolean };
      stock?: number;
    }[] = [];
    const usedNewNames = new Set<string>();

    for (let i = 0; i < rawRows.length; i += 1) {
      const raw = rawRows[i];
      const rowNumber = i + 2;
      const errors: string[] = [];

      const name = raw['Name']?.trim();
      const unit = raw['Unit']?.trim() || undefined;
      const trackInventory = parseImportBoolean(raw['Track Inventory'] ?? '');
      const stock = parseImportNumber(raw['Stock'] ?? '');

      if (!name) errors.push('Name is required');
      if (raw['Track Inventory'] && trackInventory === undefined)
        errors.push('Track Inventory must be true/false');
      if (raw['Stock'] && Number.isNaN(stock))
        errors.push('Stock is not a number');

      const existing = name
        ? await this.prisma.ingredient.findFirst({
            where: {
              shopId: ctx.shopId,
              name,
              shadowProductId: null,
              shadowVariantId: null,
            },
            select: { id: true },
          })
        : null;
      const action: ImportAction = existing ? 'update' : 'create';

      if (action === 'create') {
        if (!unit) errors.push('Unit is required to create a new ingredient');
        if (name) {
          if (usedNewNames.has(name.toLowerCase()))
            errors.push(`Duplicate name within this file: ${name}`);
          usedNewNames.add(name.toLowerCase());
        }
      }

      const finalAction: ImportAction = errors.length > 0 ? 'reject' : action;
      results.push({
        rowNumber,
        kind: 'ingredient',
        identifier: name ?? `row ${rowNumber}`,
        action: finalAction,
        errors,
      });
      groups.push({
        rowNumber,
        action: finalAction,
        ingredientId: existing?.id,
        data: { name: name ?? '', unit, trackInventory },
        stock,
      });
    }

    return { results, groups };
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    // Excludes a shadow ingredient too (see findAll's own comment) — it's
    // never merchant-editable/deletable through this API, only auto-managed
    // by ProductsService.
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, shopId: ctx.shopId, shadowProductId: null, shadowVariantId: null },
    });
    if (!ingredient) {
      throw new NotFoundException(`Ingredient ${id} not found`);
    }
    return ingredient;
  }

  private toResponse(
    ingredient: IngredientWithStock,
    outletId: number | undefined,
  ) {
    const stockRow =
      outletId !== undefined
        ? ingredient.outletingredientstock?.[0]
        : undefined;
    return {
      id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      trackInventory: ingredient.trackInventory,
      image: ingredient.image,
      description: ingredient.description,
      costPerUnit: ingredient.costPerUnit,
      supplier: ingredient.supplier,
      categoryId: ingredient.categoryId,
      categoryName: ingredient.category?.name ?? null,
      createdAt: ingredient.createdAt,
      stockQuantity: stockRow?.stockQuantity ?? null,
      lowStockThreshold: stockRow?.lowStockThreshold ?? null,
    };
  }
}
