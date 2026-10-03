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
import { trimDecimal } from '../database/decimal.util';
import { roundMoney } from '../common/currency-minor-units';
import type {
  SupplierRow,
  SuppliercontactRow,
  SupplieritemRow,
} from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CreateSupplierContactDto,
  CreateSupplierDto,
  UpdateSupplierContactDto,
  UpdateSupplierDto,
  UpsertSupplierItemDto,
} from './dto/supplier.dto';

// INV-1. Suppliers are shop-scoped master data (not outlet-scoped): one record
// per supplier across all outlets. Every id that arrives from the client
// (supplier id in the path, contact id, ingredient id) is resolved through a
// query that also carries ctx.shopId, so a foreign id is a 404, never a read.
//
// The free-text `ingredient.supplier` / `product.vendor` columns are NOT touched
// here (no write, no migration); `suggestFromFreeText` only reads them.
@Injectable()
export class SuppliersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---- suppliers ----

  async findAll(ctx: TenantContext, status?: string) {
    const params: (string | number)[] = [ctx.shopId];
    let where = 's.shopId = ?';
    if (status === 'active' || status === 'archived') {
      where += ' AND s.status = ?';
      params.push(status);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT s.*,
              (SELECT COUNT(*) FROM supplieritem si WHERE si.supplierId = s.id) AS itemCount,
              (SELECT c.name  FROM suppliercontact c WHERE c.supplierId = s.id AND c.shopId = s.shopId ORDER BY c.isPrimary DESC, c.id ASC LIMIT 1) AS primaryContactName,
              (SELECT c.email FROM suppliercontact c WHERE c.supplierId = s.id AND c.shopId = s.shopId ORDER BY c.isPrimary DESC, c.id ASC LIMIT 1) AS primaryContactEmail,
              (SELECT c.phone FROM suppliercontact c WHERE c.supplierId = s.id AND c.shopId = s.shopId ORDER BY c.isPrimary DESC, c.id ASC LIMIT 1) AS primaryContactPhone
       FROM supplier s WHERE ${where} ORDER BY s.status ASC, s.name ASC`,
      params,
    );
    return rows.map((r) => ({
      ...this.shape(r as unknown as SupplierRow),
      itemCount: Number(r.itemCount),
      primaryContactName: r.primaryContactName as string | null,
      primaryContactEmail: r.primaryContactEmail as string | null,
      primaryContactPhone: r.primaryContactPhone as string | null,
    }));
  }

  async findOne(ctx: TenantContext, id: number) {
    const supplier = await this.getOwned(ctx.shopId, id);
    const contacts = await this.db.query<
      (SuppliercontactRow & RowDataPacket)[]
    >(
      `SELECT * FROM suppliercontact WHERE supplierId = ? AND shopId = ?
       ORDER BY isPrimary DESC, id ASC`,
      [id, ctx.shopId],
    );
    const items = await this.db.query<RowDataPacket[]>(
      `SELECT si.*, i.name AS ingredientName, i.unit AS ingredientUnit
       FROM supplieritem si JOIN ingredient i ON i.id = si.ingredientId AND i.shopId = si.shopId
       WHERE si.supplierId = ? AND si.shopId = ? ORDER BY i.name ASC`,
      [id, ctx.shopId],
    );
    return {
      ...this.shape(supplier),
      contacts,
      items: items.map((r) => ({
        ...r,
        unitCost: trimDecimal((r.unitCost as string | null) ?? null),
      })),
    };
  }

  async create(ctx: TenantContext, dto: CreateSupplierDto) {
    const currency = dto.currency ?? null;
    this.assertMinimumNeedsCurrency(dto.minimumOrderAmount, currency);
    try {
      const result = await this.db.execute(
        `INSERT INTO supplier (shopId, name, paymentTerms, leadTimeDays, currency, minimumOrderAmount, notes, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.name.trim(),
          dto.paymentTerms ?? null,
          dto.leadTimeDays ?? null,
          currency,
          this.roundedOrNull(dto.minimumOrderAmount, currency),
          dto.notes ?? null,
          new Date(),
        ],
      );
      await this.auditLogService.logCtx(ctx, {
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: result.insertId,
        after: { name: dto.name.trim(), currency },
      });
      return this.findOne(ctx, result.insertId);
    } catch (error) {
      this.handleDuplicate(error, 'A supplier with this name already exists');
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateSupplierDto) {
    const before = await this.getOwned(ctx.shopId, id);
    // Validate the RESULTING pair, not only what was sent: clearing the
    // currency on a supplier that has a minimum order amount must fail.
    const nextCurrency =
      dto.currency !== undefined ? dto.currency : before.currency;
    const nextMin =
      dto.minimumOrderAmount !== undefined
        ? dto.minimumOrderAmount
        : before.minimumOrderAmount === null
          ? null
          : Number(before.minimumOrderAmount);
    this.assertMinimumNeedsCurrency(nextMin, nextCurrency);
    const set = buildSetClause({
      name: dto.name?.trim(),
      status: dto.status,
      paymentTerms: dto.paymentTerms,
      leadTimeDays: dto.leadTimeDays,
      currency: dto.currency,
      minimumOrderAmount:
        dto.minimumOrderAmount !== undefined
          ? this.roundedOrNull(dto.minimumOrderAmount, nextCurrency)
          : undefined,
      notes: dto.notes,
      updatedAt: new Date(),
    });
    try {
      if (set) {
        await this.db.execute(
          `UPDATE supplier SET ${set.setClause} WHERE id = ? AND shopId = ?`,
          [...set.params, id, ctx.shopId],
        );
      }
    } catch (error) {
      this.handleDuplicate(error, 'A supplier with this name already exists');
    }
    await this.auditLogService.logCtx(ctx, {
      action:
        dto.status !== undefined && dto.status !== before.status
          ? `supplier.${dto.status}`
          : 'supplier.updated',
      entityType: 'supplier',
      entityId: id,
      before: { name: before.name, status: before.status },
      after: { ...dto },
    });
    return this.findOne(ctx, id);
  }

  // A supplier that any purchase order points at is ARCHIVED, not deleted: the
  // order history must keep its supplier (the FK is RESTRICT, so a hard delete
  // would fail anyway). A supplier no order has used is deleted outright.
  async remove(ctx: TenantContext, id: number) {
    const supplier = await this.getOwned(ctx.shopId, id);
    const used = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM purchaseorder WHERE supplierId = ? AND shopId = ? LIMIT 1`,
      [id, ctx.shopId],
    );
    if (used.length > 0) {
      await this.db.execute(
        `UPDATE supplier SET status = 'archived', updatedAt = ? WHERE id = ? AND shopId = ?`,
        [new Date(), id, ctx.shopId],
      );
      await this.auditLogService.logCtx(ctx, {
        action: 'supplier.archived',
        entityType: 'supplier',
        entityId: id,
        before: { name: supplier.name, status: supplier.status },
        metadata: { reason: 'referenced by a purchase order' },
      });
      return { id, deleted: false, archived: true };
    }
    await this.db.execute(`DELETE FROM supplier WHERE id = ? AND shopId = ?`, [
      id,
      ctx.shopId,
    ]);
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier.deleted',
      entityType: 'supplier',
      entityId: id,
      before: { name: supplier.name },
    });
    return { id, deleted: true, archived: false };
  }

  // Read-only: distinct free-text names the merchant already typed that match
  // no supplier row yet. Writes nothing; promoting one is a manual create.
  async suggestFromFreeText(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT name, source, COUNT(*) AS uses FROM (
         SELECT TRIM(supplier) AS name, 'ingredient.supplier' AS source FROM ingredient
           WHERE shopId = ? AND supplier IS NOT NULL AND TRIM(supplier) <> ''
         UNION ALL
         SELECT TRIM(vendor) AS name, 'product.vendor' AS source FROM product
           WHERE shopId = ? AND vendor IS NOT NULL AND TRIM(vendor) <> ''
       ) t
       WHERE NOT EXISTS (SELECT 1 FROM supplier s WHERE s.shopId = ? AND s.name = t.name)
       GROUP BY name, source ORDER BY uses DESC, name ASC LIMIT 200`,
      [ctx.shopId, ctx.shopId, ctx.shopId],
    );
    return rows.map((r) => ({
      name: r.name as string,
      source: r.source as string,
      uses: Number(r.uses),
    }));
  }

  // ---- contacts ----

  async addContact(
    ctx: TenantContext,
    supplierId: number,
    dto: CreateSupplierContactDto,
  ) {
    await this.getOwned(ctx.shopId, supplierId);
    const id = await this.db.transaction(async (conn) => {
      if (dto.isPrimary) {
        await conn.query(
          `UPDATE suppliercontact SET isPrimary = FALSE WHERE supplierId = ? AND shopId = ?`,
          [supplierId, ctx.shopId],
        );
      }
      const [result] = await conn.query(
        `INSERT INTO suppliercontact (supplierId, shopId, name, role, email, phone, isPrimary, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          supplierId,
          ctx.shopId,
          dto.name.trim(),
          dto.role ?? null,
          dto.email ?? null,
          dto.phone ?? null,
          dto.isPrimary === true,
          new Date(),
        ],
      );
      return (result as { insertId: number }).insertId;
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier_contact.created',
      entityType: 'supplier',
      entityId: supplierId,
      after: { contactId: id, name: dto.name.trim() },
    });
    return this.findOne(ctx, supplierId);
  }

  async updateContact(
    ctx: TenantContext,
    supplierId: number,
    contactId: number,
    dto: UpdateSupplierContactDto,
  ) {
    await this.getOwnedContact(ctx.shopId, supplierId, contactId);
    await this.db.transaction(async (conn) => {
      if (dto.isPrimary === true) {
        await conn.query(
          `UPDATE suppliercontact SET isPrimary = FALSE WHERE supplierId = ? AND shopId = ?`,
          [supplierId, ctx.shopId],
        );
      }
      const set = buildSetClause({
        name: dto.name?.trim(),
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary,
        updatedAt: new Date(),
      });
      if (set) {
        await conn.query(
          `UPDATE suppliercontact SET ${set.setClause} WHERE id = ? AND supplierId = ? AND shopId = ?`,
          [...set.params, contactId, supplierId, ctx.shopId],
        );
      }
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier_contact.updated',
      entityType: 'supplier',
      entityId: supplierId,
      after: { contactId, ...dto },
    });
    return this.findOne(ctx, supplierId);
  }

  async removeContact(
    ctx: TenantContext,
    supplierId: number,
    contactId: number,
  ) {
    await this.getOwnedContact(ctx.shopId, supplierId, contactId);
    await this.db.execute(
      `DELETE FROM suppliercontact WHERE id = ? AND supplierId = ? AND shopId = ?`,
      [contactId, supplierId, ctx.shopId],
    );
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier_contact.deleted',
      entityType: 'supplier',
      entityId: supplierId,
      before: { contactId },
    });
    return this.findOne(ctx, supplierId);
  }

  // ---- supplier catalogue (supplieritem) ----

  // Upsert on (supplierId, ingredientId). The ingredientId from the path is
  // checked against the caller's shop before anything is written.
  async upsertItem(
    ctx: TenantContext,
    supplierId: number,
    ingredientId: number,
    dto: UpsertSupplierItemDto,
  ) {
    const supplier = await this.getOwned(ctx.shopId, supplierId);
    const ing = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM ingredient WHERE id = ? AND shopId = ?`,
      [ingredientId, ctx.shopId],
    );
    if (ing.length === 0) {
      throw new NotFoundException(`Ingredient ${ingredientId} not found`);
    }
    const existing = await this.db.query<(SupplieritemRow & RowDataPacket)[]>(
      `SELECT * FROM supplieritem WHERE supplierId = ? AND ingredientId = ? AND shopId = ?`,
      [supplierId, ingredientId, ctx.shopId],
    );
    const prev = existing[0];
    // Currency of the cost: what was sent, else what the row already has, else
    // the supplier's own stated currency (which is the supplier's, not ours).
    // A cost with no currency anywhere is refused rather than guessed.
    const nextCost =
      dto.unitCost !== undefined
        ? dto.unitCost
        : prev?.unitCost != null
          ? Number(prev.unitCost)
          : null;
    const currency =
      dto.currency !== undefined
        ? dto.currency
        : (prev?.currency ?? supplier.currency ?? null);
    if (nextCost !== null && currency === null) {
      throw new BadRequestException(
        'A unit cost needs a currency: set one on the item or on the supplier',
      );
    }
    if (prev) {
      const set = buildSetClause({
        supplierSku: dto.supplierSku,
        unitCost: dto.unitCost,
        currency:
          dto.currency !== undefined || (prev.currency === null && nextCost !== null)
            ? currency
            : undefined,
        minOrderQty: dto.minOrderQty,
        leadTimeDays: dto.leadTimeDays,
        updatedAt: new Date(),
      });
      if (set) {
        await this.db.execute(
          `UPDATE supplieritem SET ${set.setClause} WHERE id = ? AND shopId = ?`,
          [...set.params, prev.id, ctx.shopId],
        );
      }
    } else {
      try {
        await this.db.execute(
          `INSERT INTO supplieritem (shopId, supplierId, ingredientId, supplierSku, unitCost, currency, minOrderQty, leadTimeDays, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            supplierId,
            ingredientId,
            dto.supplierSku ?? null,
            nextCost,
            currency,
            dto.minOrderQty ?? null,
            dto.leadTimeDays ?? null,
            new Date(),
          ],
        );
      } catch (error) {
        this.handleDuplicate(error, 'This ingredient is already on the supplier');
      }
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier_item.saved',
      entityType: 'supplier',
      entityId: supplierId,
      after: { ingredientId, ...dto },
    });
    return this.findOne(ctx, supplierId);
  }

  async removeItem(
    ctx: TenantContext,
    supplierId: number,
    ingredientId: number,
  ) {
    await this.getOwned(ctx.shopId, supplierId);
    const result = await this.db.execute(
      `DELETE FROM supplieritem WHERE supplierId = ? AND ingredientId = ? AND shopId = ?`,
      [supplierId, ingredientId, ctx.shopId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException('Supplier item not found');
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'supplier_item.deleted',
      entityType: 'supplier',
      entityId: supplierId,
      before: { ingredientId },
    });
    return this.findOne(ctx, supplierId);
  }

  // ---- helpers ----

  async getOwned(shopId: number, id: number) {
    const rows = await this.db.query<(SupplierRow & RowDataPacket)[]>(
      `SELECT * FROM supplier WHERE id = ? AND shopId = ?`,
      [id, shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    return rows[0];
  }

  private async getOwnedContact(
    shopId: number,
    supplierId: number,
    contactId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM suppliercontact WHERE id = ? AND supplierId = ? AND shopId = ?`,
      [contactId, supplierId, shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Contact ${contactId} not found`);
    }
  }

  private shape(row: SupplierRow) {
    return {
      ...row,
      minimumOrderAmount: trimDecimal(row.minimumOrderAmount ?? null),
    };
  }

  private assertMinimumNeedsCurrency(
    amount: number | null | undefined,
    currency: string | null,
  ) {
    if (amount != null && currency === null) {
      throw new BadRequestException(
        'A minimum order amount needs the supplier currency to be set',
      );
    }
  }

  // Rounded once, by the supplier's own currency (3 decimals for KWD/BHD/OMR).
  private roundedOrNull(
    amount: number | null | undefined,
    currency: string | null,
  ): number | null {
    return amount == null ? null : roundMoney(amount, currency);
  }

  private handleDuplicate(error: unknown, message: string): never {
    if (isDuplicateKeyError(error)) throw new ConflictException(message);
    throw error;
  }
}
