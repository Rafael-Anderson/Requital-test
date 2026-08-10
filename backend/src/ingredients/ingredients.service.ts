import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import type { IngredientRow } from '../db/types';
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

interface AssembledIngredient extends IngredientRow {
  categoryName: string | null;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

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
    private readonly db: DatabaseService,
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
    const conditions = [
      'i.shopId = ?',
      'i.shadowProductId IS NULL',
      'i.shadowVariantId IS NULL',
    ];
    const params: QueryParam[] = [ctx.shopId];
    if (categoryId !== undefined) {
      conditions.push('i.categoryId = ?');
      params.push(categoryId);
    }
    const rows = await this.loadIngredientRows(conditions, params, outletId);
    return rows.map((i) => this.toResponse(i));
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
    const rows = await this.loadIngredientRows(
      ['i.id = ?', 'i.shopId = ?', 'i.shadowProductId IS NULL', 'i.shadowVariantId IS NULL'],
      [id, ctx.shopId],
      outletId,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Ingredient ${id} not found`);
    }
    return this.toResponse(rows[0]);
  }

  async create(ctx: TenantContext, dto: CreateIngredientDto) {
    if (dto.categoryId !== undefined) {
      await this.assertCategoryBelongsToShop(ctx, dto.categoryId);
    }
    const result = await this.db.execute(
      `INSERT INTO ingredient (shopId, name, unit, trackInventory, image, description, costPerUnit, supplier, categoryId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        dto.name,
        dto.unit,
        dto.trackInventory ?? true,
        dto.image ?? null,
        dto.description ?? null,
        dto.costPerUnit ?? null,
        dto.supplier ?? null,
        dto.categoryId ?? null,
      ],
    );
    const rows = await this.loadIngredientRows(['i.id = ?'], [result.insertId], undefined);
    return this.toResponse(rows[0]);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateIngredientDto) {
    await this.assertBelongsToShop(ctx, id);
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.assertCategoryBelongsToShop(ctx, dto.categoryId);
    }
    const set = buildSetClause({
      name: dto.name,
      unit: dto.unit,
      trackInventory: dto.trackInventory,
      image: dto.image,
      description: dto.description,
      costPerUnit: dto.costPerUnit,
      supplier: dto.supplier,
      categoryId: dto.categoryId,
    });
    if (set) {
      await this.db.execute(`UPDATE ingredient SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const rows = await this.loadIngredientRows(['i.id = ?'], [id], undefined);
    return this.toResponse(rows[0]);
  }

  private async assertCategoryBelongsToShop(
    ctx: TenantContext,
    categoryId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM ingredientcategory WHERE id = ? AND shopId = ?`,
      [categoryId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('categoryId is invalid for this shop');
    }
  }

  private async assertOutletBelongsToShop(
    ctx: TenantContext,
    outletId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('outletId is invalid for this shop');
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const ingredient = await this.assertBelongsToShop(ctx, id);
    await this.db.execute(`DELETE FROM ingredient WHERE id = ?`, [id]);
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

    await this.db.transaction(async (conn) => {
      for (const group of groups) {
        if (group.action === 'reject') continue;

        let ingredientId: number;
        if (group.action === 'create') {
          const [result] = await conn.query(
            `INSERT INTO ingredient (shopId, name, unit, trackInventory) VALUES (?, ?, ?, ?)`,
            [
              ctx.shopId,
              group.data.name,
              group.data.unit!,
              group.data.trackInventory ?? true,
            ],
          );
          ingredientId = (result as { insertId: number }).insertId;
          created += 1;
        } else {
          ingredientId = group.ingredientId!;
          const set = buildSetClause({
            unit: group.data.unit,
            trackInventory: group.data.trackInventory,
          });
          if (set) {
            await conn.query(`UPDATE ingredient SET ${set.setClause} WHERE id = ?`, [
              ...set.params,
              ingredientId,
            ]);
          }
          updated += 1;
        }

        if (group.stock !== undefined && outletId !== undefined) {
          const [beforeRows] = await conn.query<RowDataPacket[]>(
            `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
            [outletId, ingredientId],
          );
          const before = (beforeRows[0]?.stockQuantity as number | undefined) ?? 0;
          await conn.query(
            `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE stockQuantity = VALUES(stockQuantity)`,
            [outletId, ingredientId, group.stock],
          );
          await conn.query(
            `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ctx.shopId,
              null,
              null,
              ingredientId,
              'IMPORT',
              null,
              group.stock - before,
              outletId,
              null,
              'CSV import',
              ctx.userId,
            ],
          );
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

      let existingId: number | undefined;
      if (name) {
        const existingRows = await this.db.query<RowDataPacket[]>(
          `SELECT id FROM ingredient
           WHERE shopId = ? AND name = ? AND shadowProductId IS NULL AND shadowVariantId IS NULL`,
          [ctx.shopId, name],
        );
        existingId = existingRows[0]?.id as number | undefined;
      }
      const action: ImportAction = existingId !== undefined ? 'update' : 'create';

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
        ingredientId: existingId,
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
    const rows = await this.db.query<(IngredientRow & RowDataPacket)[]>(
      `SELECT * FROM ingredient
       WHERE id = ? AND shopId = ? AND shadowProductId IS NULL AND shadowVariantId IS NULL`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Ingredient ${id} not found`);
    }
    return rows[0];
  }

  // Shared by findAll/findOne/create/update — joins in the category name
  // and (only when outletId is resolved) this ingredient's live stock at
  // that outlet, same shape as ProductsService.loadIngredientLinks.
  private async loadIngredientRows(
    conditions: string[],
    conditionParams: QueryParam[],
    outletId: number | undefined,
  ): Promise<AssembledIngredient[]> {
    const stockJoin =
      outletId !== undefined
        ? `LEFT JOIN outletingredientstock ois ON ois.ingredientId = i.id AND ois.outletId = ?`
        : '';
    const stockColumns =
      outletId !== undefined
        ? `ois.stockQuantity AS stockQuantity, ois.lowStockThreshold AS lowStockThreshold`
        : `NULL AS stockQuantity, NULL AS lowStockThreshold`;
    // The join's `?` (if present) appears before the WHERE clause's `?`s in
    // the SQL text below — params must be in that same order since .query()
    // binds positionally, not by clause (see ProductsService.loadIngredientLinks
    // for the bug this mirrors the fix of).
    const params = outletId !== undefined ? [outletId, ...conditionParams] : conditionParams;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT i.*, c.name AS categoryName, ${stockColumns}
       FROM ingredient i
       LEFT JOIN ingredientcategory c ON c.id = i.categoryId
       ${stockJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.id ASC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as number,
      shopId: r.shopId as number,
      name: r.name as string,
      unit: r.unit as string,
      trackInventory: Boolean(r.trackInventory),
      image: r.image as string | null,
      description: r.description as string | null,
      costPerUnit: r.costPerUnit as string | null,
      supplier: r.supplier as string | null,
      categoryId: r.categoryId as number | null,
      shadowProductId: r.shadowProductId as number | null,
      shadowVariantId: r.shadowVariantId as number | null,
      createdAt: r.createdAt as Date,
      categoryName: r.categoryName as string | null,
      stockQuantity: r.stockQuantity as number | null,
      lowStockThreshold: r.lowStockThreshold as number | null,
    }));
  }

  private toResponse(ingredient: AssembledIngredient) {
    return {
      id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      trackInventory: ingredient.trackInventory,
      image: ingredient.image,
      description: ingredient.description,
      costPerUnit: trimDecimal(ingredient.costPerUnit),
      supplier: ingredient.supplier,
      categoryId: ingredient.categoryId,
      categoryName: ingredient.categoryName,
      createdAt: ingredient.createdAt,
      stockQuantity: ingredient.stockQuantity,
      lowStockThreshold: ingredient.lowStockThreshold,
    };
  }
}
