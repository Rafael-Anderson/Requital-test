import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { IngredientcategoryRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { CreateIngredientCategoryDto } from './dto/create-ingredient-category.dto';
import { UpdateIngredientCategoryDto } from './dto/update-ingredient-category.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

// Deliberately much lighter than CategoriesService — flat, no parent/tree,
// no slug/image/isFeatured (see ingredientcategory's schema comment for
// why: no storefront navigation use case exists for it the way there is
// for product categories).
@Injectable()
export class IngredientCategoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.db.query<(IngredientcategoryRow & RowDataPacket)[]>(
      `SELECT * FROM ingredientcategory WHERE shopId = ? ORDER BY name ASC`,
      [ctx.shopId],
    );
  }

  async create(ctx: TenantContext, dto: CreateIngredientCategoryDto) {
    const result = await this.db.execute(
      `INSERT INTO ingredientcategory (shopId, name) VALUES (?, ?)`,
      [ctx.shopId, dto.name],
    );
    return this.findById(result.insertId);
  }

  async update(
    ctx: TenantContext,
    id: number,
    dto: UpdateIngredientCategoryDto,
  ) {
    await this.findOne(ctx, id);
    const set = buildSetClause({ name: dto.name });
    if (set) {
      await this.db.execute(
        `UPDATE ingredientcategory SET ${set.setClause} WHERE id = ?`,
        [...set.params, id],
      );
    }
    return this.findById(id);
  }

  async remove(ctx: TenantContext, id: number) {
    const category = await this.findOne(ctx, id);

    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ingredient WHERE categoryId = ?`,
      [id],
    );
    const ingredientCount = Number(countRows[0].c);
    if (ingredientCount > 0) {
      throw new ConflictException(
        `Cannot delete: this category has ${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    await this.db.execute(`DELETE FROM ingredientcategory WHERE id = ?`, [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'ingredient_category.deleted',
      entityType: 'ingredientcategory',
      entityId: id,
      before: { name: category.name },
    });
    return { id, deleted: true };
  }

  private async findById(id: number) {
    const rows = await this.db.query<(IngredientcategoryRow & RowDataPacket)[]>(
      `SELECT * FROM ingredientcategory WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(IngredientcategoryRow & RowDataPacket)[]>(
      `SELECT * FROM ingredientcategory WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Ingredient category ${id} not found`);
    }
    return rows[0];
  }
}
