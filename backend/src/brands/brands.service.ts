import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { BrandRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

// Brands are shop-scoped (one catalog across all outlets, same as
// Collections). Structural CRUD is admin-only in the controller; reads stay
// open to any authenticated role.
@Injectable()
export class BrandsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.db.query<(BrandRow & RowDataPacket)[]>(
      `SELECT * FROM brand WHERE shopId = ? ORDER BY name ASC`,
      [ctx.shopId],
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(BrandRow & RowDataPacket)[]>(
      `SELECT * FROM brand WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Brand ${id} not found`);
    }
    return rows[0];
  }

  async create(ctx: TenantContext, dto: CreateBrandDto) {
    try {
      const result = await this.db.execute(
        `INSERT INTO brand (shopId, name, logoUrl, updatedAt) VALUES (?, ?, ?, ?)`,
        [ctx.shopId, dto.name, dto.logoUrl ?? null, new Date()],
      );
      const brand = await this.findById(result.insertId);
      await this.auditLogService.logCtx(ctx, {
        action: 'brand.created',
        entityType: 'brand',
        entityId: result.insertId,
        after: { name: dto.name },
      });
      return brand;
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateBrandDto) {
    await this.findOne(ctx, id);
    try {
      const set = buildSetClause({
        name: dto.name,
        logoUrl: dto.logoUrl,
        updatedAt: new Date(),
      });
      if (set) {
        await this.db.execute(
          `UPDATE brand SET ${set.setClause} WHERE id = ?`,
          [...set.params, id],
        );
      }
      await this.auditLogService.logCtx(ctx, {
        action: 'brand.updated',
        entityType: 'brand',
        entityId: id,
        after: { name: dto.name },
      });
      return this.findById(id);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const brand = await this.findOne(ctx, id);
    // `product.brandId` is ON DELETE SET NULL, so the FK already nulls
    // affected products — the explicit UPDATE makes the behavior obvious and
    // keeps it inside one transaction with the delete.
    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE product SET brandId = NULL WHERE brandId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      await conn.query(`DELETE FROM brand WHERE id = ? AND shopId = ?`, [
        id,
        ctx.shopId,
      ]);
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'brand.deleted',
      entityType: 'brand',
      entityId: id,
      before: { name: brand.name },
    });
    return { id, deleted: true };
  }

  private async findById(id: number) {
    const rows = await this.db.query<(BrandRow & RowDataPacket)[]>(
      `SELECT * FROM brand WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A brand with this name already exists');
    }
    throw error;
  }
}
