import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { TaxclassRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateTaxClassDto } from './dto/create-tax-class.dto';
import { UpdateTaxClassDto } from './dto/update-tax-class.dto';
import { typeAllowsNonZeroRate } from './tax-class-constants';

// Tax classes are shop-scoped, like Brands and Collections — one set per shop
// across all outlets, since a VAT treatment is a property of what is being
// sold, not of where it ships from.
//
// This service is assignment and configuration only. NOTHING here computes an
// order total: the per-line computation that reads `rate`/`type` is B2, and
// keeping the schema change and the money math in separate deploys is
// deliberate. So adding, editing or reassigning a class today changes no price.
@Injectable()
export class TaxClassesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.db.query<(TaxclassRow & RowDataPacket)[]>(
      // Default first, then by name — the default is the one a merchant looks
      // for, and it is what an unassigned product falls back to.
      `SELECT * FROM taxclass WHERE shopId = ? ORDER BY isDefault DESC, name ASC`,
      [ctx.shopId],
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(TaxclassRow & RowDataPacket)[]>(
      `SELECT * FROM taxclass WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Tax class ${id} not found`);
    }
    return rows[0];
  }

  async create(ctx: TenantContext, dto: CreateTaxClassDto) {
    this.assertRateMatchesType(dto.type, dto.rate);
    // The first class a shop has must be the default — otherwise a shop can
    // end up with classes but nothing to fall back to.
    const existing = await this.countForShop(ctx.shopId);
    const isDefault = dto.isDefault === true || existing === 0;
    try {
      const id = await this.db.transaction(async (conn) => {
        if (isDefault) {
          await conn.query(
            `UPDATE taxclass SET isDefault = FALSE, updatedAt = ? WHERE shopId = ?`,
            [new Date(), ctx.shopId],
          );
        }
        const [result] = await conn.query(
          `INSERT INTO taxclass (shopId, name, rate, type, isDefault, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [ctx.shopId, dto.name, dto.rate, dto.type, isDefault, new Date()],
        );
        return (result as { insertId: number }).insertId;
      });
      await this.auditLogService.logCtx(ctx, {
        action: 'tax_class.created',
        entityType: 'taxclass',
        entityId: id,
        after: { name: dto.name, rate: dto.rate, type: dto.type, isDefault },
      });
      return this.findOne(ctx, id);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateTaxClassDto) {
    const before = await this.findOne(ctx, id);
    // Validate the resulting pair, not just what was sent: changing `type` to
    // 'zero' on a class that already carries 5% must fail even though the
    // request never mentioned a rate.
    const nextType = dto.type ?? before.type;
    const nextRate = dto.rate ?? Number(before.rate);
    this.assertRateMatchesType(nextType, nextRate);
    if (dto.isDefault === false && before.isDefault) {
      throw new BadRequestException(
        'Make another tax class the default instead of clearing this one',
      );
    }
    try {
      await this.db.transaction(async (conn) => {
        if (dto.isDefault === true) {
          await conn.query(
            `UPDATE taxclass SET isDefault = FALSE, updatedAt = ? WHERE shopId = ?`,
            [new Date(), ctx.shopId],
          );
        }
        const set = buildSetClause({
          name: dto.name,
          rate: dto.rate,
          type: dto.type,
          isDefault: dto.isDefault === true ? true : undefined,
          updatedAt: new Date(),
        });
        if (set) {
          await conn.query(
            `UPDATE taxclass SET ${set.setClause} WHERE id = ?`,
            [...set.params, id],
          );
        }
      });
      // The other half of the relationship ShopService.update maintains: the
      // shop's default standard class IS the shop's standard rate, and
      // `shop.taxRate` is still what the Business Settings field shows and what
      // B2 charges on a taxed delivery fee. Letting them drift would mean the
      // settings page displaying one rate while orders charge another, or
      // delivery being taxed at a stale figure.
      const becameDefault = dto.isDefault === true;
      const isTheDefault = becameDefault || before.isDefault;
      const nowStandard = nextType === 'standard';
      if (isTheDefault && nowStandard) {
        await this.db.execute(`UPDATE shop SET taxRate = ? WHERE id = ?`, [
          nextRate,
          ctx.shopId,
        ]);
      }
      await this.auditLogService.logCtx(ctx, {
        action: 'tax_class.updated',
        entityType: 'taxclass',
        entityId: id,
        before: {
          name: before.name,
          rate: before.rate,
          type: before.type,
          isDefault: before.isDefault,
        },
        after: { name: dto.name, rate: dto.rate, type: dto.type },
      });
      return this.findOne(ctx, id);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const taxClass = await this.findOne(ctx, id);
    // Refusing to delete the default is the whole safety property here: an
    // unassigned product resolves its rate through the default, so a shop
    // without one has no defined behaviour once B2 lands.
    if (taxClass.isDefault) {
      throw new ConflictException(
        'This is the default tax class. Make another class the default before deleting it.',
      );
    }
    const assigned = await this.countProductsUsing(ctx.shopId, id);
    // `product.taxClassId` is ON DELETE SET NULL, so the FK already nulls these
    // — the explicit UPDATE makes it obvious and keeps it in one transaction
    // with the delete (same shape as BrandsService.remove).
    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE product SET taxClassId = NULL WHERE taxClassId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      await conn.query(`DELETE FROM taxclass WHERE id = ? AND shopId = ?`, [
        id,
        ctx.shopId,
      ]);
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'tax_class.deleted',
      entityType: 'taxclass',
      entityId: id,
      before: {
        name: taxClass.name,
        rate: taxClass.rate,
        type: taxClass.type,
        productsUnassigned: assigned,
      },
    });
    // The count is returned rather than only logged: "deleting this unassigned
    // 12 products" is the one consequence a merchant cannot see from the list.
    return { id, deleted: true, productsUnassigned: assigned };
  }

  // Used by the product write paths to reject a taxClassId belonging to another
  // shop — the same ownership check every outletId-taking write does.
  async assertOwned(shopId: number, taxClassId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM taxclass WHERE id = ? AND shopId = ?`,
      [taxClassId, shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Tax class ${taxClassId} not found`);
    }
  }

  private assertRateMatchesType(type: string, rate: number) {
    if (!typeAllowsNonZeroRate(type) && rate !== 0) {
      throw new BadRequestException(
        `A '${type}' tax class must have a rate of 0`,
      );
    }
  }

  private async countForShop(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM taxclass WHERE shopId = ?`,
      [shopId],
    );
    return Number(rows[0].n);
  }

  private async countProductsUsing(shopId: number, taxClassId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM product WHERE shopId = ? AND taxClassId = ?`,
      [shopId, taxClassId],
    );
    return Number(rows[0].n);
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A tax class with this name already exists');
    }
    throw error;
  }
}
