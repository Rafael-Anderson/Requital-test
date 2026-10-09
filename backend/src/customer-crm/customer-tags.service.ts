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
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { assertCustomerInShop } from './customer-scope';
import type {
  BulkTagDto,
  CreateCustomerTagDto,
  UpdateCustomerTagDto,
} from './dto/crm.dto';

export interface CustomerTag {
  id: number;
  name: string;
  color: string | null;
}

// CUS-2. Shop-scoped tags and a many-to-many assignment table (composite PK
// customerId+tagId). Every statement that touches an id from the request is
// joined back to ctx.shopId, so a tag or customer id from another shop can
// neither be read nor assigned: it is simply not found.
@Injectable()
export class CustomerTagsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT t.id, t.name, t.color, COUNT(a.customerId) AS customerCount
         FROM customertag t
         LEFT JOIN customertagassignment a ON a.tagId = t.id AND a.shopId = t.shopId
        WHERE t.shopId = ?
        GROUP BY t.id
        ORDER BY t.name`,
      [ctx.shopId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      color: (r.color as string | null) ?? null,
      customerCount: Number(r.customerCount),
    }));
  }

  async create(ctx: TenantContext, dto: CreateCustomerTagDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Tag name is required');
    try {
      const res = await this.db.execute(
        `INSERT INTO customertag (shopId, name, color) VALUES (?, ?, ?)`,
        [ctx.shopId, name, dto.color ?? null],
      );
      await this.auditLog.logCtx(ctx, {
        action: 'customer.tag.created',
        entityType: 'customertag',
        entityId: res.insertId,
        after: { name },
      });
      return { id: res.insertId, name, color: dto.color ?? null, customerCount: 0 };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A tag with this name already exists');
      }
      throw error;
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCustomerTagDto) {
    await this.assertTag(ctx.shopId, id);
    const set = buildSetClause({
      name: dto.name?.trim(),
      color: dto.color,
    });
    if (set) {
      try {
        await this.db.execute(
          `UPDATE customertag SET ${set.setClause} WHERE id = ? AND shopId = ?`,
          [...set.params, id, ctx.shopId],
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictException('A tag with this name already exists');
        }
        throw error;
      }
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, color FROM customertag WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    return rows[0];
  }

  async remove(ctx: TenantContext, id: number) {
    await this.assertTag(ctx.shopId, id);
    // Assignments go with the tag (FK cascade). Customers are untouched.
    await this.db.execute(
      `DELETE FROM customertag WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'customer.tag.deleted',
      entityType: 'customertag',
      entityId: id,
    });
    return { deleted: true };
  }

  async forCustomer(ctx: TenantContext, customerId: number): Promise<CustomerTag[]> {
    await assertCustomerInShop(this.db, ctx.shopId, customerId);
    const map = await this.tagsByCustomer(ctx.shopId, [customerId]);
    return map.get(customerId) ?? [];
  }

  // Batch load for the list endpoint: one query for a whole page.
  async tagsByCustomer(
    shopId: number,
    customerIds: number[],
  ): Promise<Map<number, CustomerTag[]>> {
    const result = new Map<number, CustomerTag[]>();
    if (customerIds.length === 0) return result;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT a.customerId, t.id, t.name, t.color
         FROM customertagassignment a
         JOIN customertag t ON t.id = a.tagId AND t.shopId = a.shopId
        WHERE a.shopId = ? AND a.customerId IN (${customerIds.map(() => '?').join(', ')})
        ORDER BY t.name`,
      [shopId, ...customerIds],
    );
    for (const r of rows) {
      const list = result.get(r.customerId as number) ?? [];
      list.push({
        id: r.id as number,
        name: r.name as string,
        color: (r.color as string | null) ?? null,
      });
      result.set(r.customerId as number, list);
    }
    return result;
  }

  async assign(ctx: TenantContext, dto: BulkTagDto) {
    const { customerIds, tagIds } = await this.validateBulk(ctx.shopId, dto);
    // One statement, scoped by the join to a single shop on BOTH sides, so the
    // cross-product can only ever contain this shop's customers and tags.
    const res = await this.db.execute(
      `INSERT INTO customertagassignment (customerId, tagId, shopId)
       SELECT c.id, t.id, c.shopId
         FROM customer c
         JOIN customertag t ON t.shopId = c.shopId
        WHERE c.shopId = ?
          AND c.id IN (${customerIds.map(() => '?').join(', ')})
          AND t.id IN (${tagIds.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE customertagassignment.customerId = customertagassignment.customerId`,
      [ctx.shopId, ...customerIds, ...tagIds],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'customer.tag.assigned',
      entityType: 'customertag',
      metadata: { customerCount: customerIds.length, tagIds },
    });
    return { assigned: res.affectedRows > 0, customers: customerIds.length };
  }

  async unassign(ctx: TenantContext, dto: BulkTagDto) {
    const { customerIds, tagIds } = await this.validateBulk(ctx.shopId, dto);
    const res = await this.db.execute(
      `DELETE FROM customertagassignment
        WHERE shopId = ?
          AND customerId IN (${customerIds.map(() => '?').join(', ')})
          AND tagId IN (${tagIds.map(() => '?').join(', ')})`,
      [ctx.shopId, ...customerIds, ...tagIds],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'customer.tag.unassigned',
      entityType: 'customertag',
      metadata: { customerCount: customerIds.length, tagIds },
    });
    return { removed: res.affectedRows };
  }

  // Every id must exist IN THIS SHOP, or the whole request is a 404: a partial
  // apply that quietly skips a foreign id would hide the mistake.
  private async validateBulk(shopId: number, dto: BulkTagDto) {
    const customerIds = [...new Set(dto.customerIds)];
    const tagIds = [...new Set(dto.tagIds)];
    const [customers, tags] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customer WHERE shopId = ? AND id IN (${customerIds.map(() => '?').join(', ')})`,
        [shopId, ...customerIds],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customertag WHERE shopId = ? AND id IN (${tagIds.map(() => '?').join(', ')})`,
        [shopId, ...tagIds],
      ),
    ]);
    if (Number(customers[0].n) !== customerIds.length) {
      throw new NotFoundException('One or more customers were not found');
    }
    if (Number(tags[0].n) !== tagIds.length) {
      throw new NotFoundException('One or more tags were not found');
    }
    return { customerIds, tagIds };
  }

  private async assertTag(shopId: number, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM customertag WHERE id = ? AND shopId = ?`,
      [id, shopId],
    );
    if (rows.length === 0) throw new NotFoundException(`Tag ${id} not found`);
  }
}
