import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { trimDecimal } from '../database/decimal.util';
import type { DiscountRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ValidateDiscountDto } from './dto/validate-discount.dto';
import {
  DISCOUNT_REJECTION_MESSAGES,
  DiscountRejectionReason,
  DiscountType,
} from './discount-constants';
import { AuditLogService } from '../audit-log/audit-log.service';

export interface ProductSummary {
  id: number;
  name: string;
}
export interface CollectionSummary {
  id: number;
  name: string;
}

interface AssembledDiscount extends DiscountRow {
  products: ProductSummary[];
  collections: CollectionSummary[];
}

export interface EvaluateResult {
  valid: boolean;
  reason?: DiscountRejectionReason;
  message?: string;
  discountId?: number;
  code?: string;
  type?: DiscountType;
  discountAmount?: number;
  freeShipping?: boolean;
}

@Injectable()
export class DiscountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM discount WHERE shopId = ? ORDER BY id DESC`,
      [ctx.shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const discounts = await this.loadDiscountsWithRelations(ids);
    return ids.map((id) => this.toResponse(discounts.get(id)!));
  }

  async findOne(ctx: TenantContext, id: number) {
    await this.findRaw(ctx, id);
    const discounts = await this.loadDiscountsWithRelations([id]);
    return this.toResponse(discounts.get(id)!);
  }

  async create(ctx: TenantContext, dto: CreateDiscountDto) {
    this.assertFieldsMatchType(dto);
    await this.assertEligibilityTargetsBelongToShop(ctx, dto);

    let insertId: number;
    try {
      insertId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO discount (shopId, code, type, value, minPurchaseAmount, appliesTo, usageLimit, usageLimitPerCustomer, startsAt, endsAt, active, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            this.normalizeCode(dto.code),
            dto.type,
            dto.type === 'FREE_SHIPPING' ? null : (dto.value ?? null),
            dto.minPurchaseAmount ?? null,
            dto.appliesTo ?? 'ALL_PRODUCTS',
            dto.usageLimit ?? null,
            dto.usageLimitPerCustomer ?? null,
            dto.startsAt ? new Date(dto.startsAt) : null,
            dto.endsAt ? new Date(dto.endsAt) : null,
            dto.active ?? true,
            new Date(),
          ],
        );
        const newId = (result as { insertId: number }).insertId;
        if (dto.appliesTo === 'SPECIFIC_PRODUCTS' && dto.productIds?.length) {
          const placeholders = dto.productIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO discountproduct (discountId, productId) VALUES ${placeholders}`,
            dto.productIds.flatMap((productId) => [newId, productId]),
          );
        }
        if (
          dto.appliesTo === 'SPECIFIC_COLLECTIONS' &&
          dto.collectionIds?.length
        ) {
          const placeholders = dto.collectionIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO discountcollection (discountId, collectionId) VALUES ${placeholders}`,
            dto.collectionIds.flatMap((collectionId) => [newId, collectionId]),
          );
        }
        return newId;
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const discounts = await this.loadDiscountsWithRelations([insertId]);
    return this.toResponse(discounts.get(insertId)!);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDiscountDto) {
    const current = await this.findRaw(ctx, id);
    const effectiveType = dto.type ?? (current.type as DiscountType);
    if (dto.type || dto.value !== undefined) {
      this.assertFieldsMatchType({
        type: effectiveType,
        value: dto.value ?? (current.value ? Number(current.value) : undefined),
      });
    }
    if (dto.productIds || dto.collectionIds) {
      await this.assertEligibilityTargetsBelongToShop(ctx, dto);
    }

    try {
      await this.db.transaction(async (conn) => {
        if (dto.productIds) {
          await conn.query(`DELETE FROM discountproduct WHERE discountId = ?`, [id]);
          if (dto.productIds.length > 0) {
            const placeholders = dto.productIds.map(() => '(?, ?)').join(', ');
            await conn.query(
              `INSERT INTO discountproduct (discountId, productId) VALUES ${placeholders}`,
              dto.productIds.flatMap((productId) => [id, productId]),
            );
          }
        }
        if (dto.collectionIds) {
          await conn.query(`DELETE FROM discountcollection WHERE discountId = ?`, [id]);
          if (dto.collectionIds.length > 0) {
            const placeholders = dto.collectionIds.map(() => '(?, ?)').join(', ');
            await conn.query(
              `INSERT INTO discountcollection (discountId, collectionId) VALUES ${placeholders}`,
              dto.collectionIds.flatMap((collectionId) => [id, collectionId]),
            );
          }
        }
        const set = buildSetClause({
          code: dto.code ? this.normalizeCode(dto.code) : undefined,
          type: dto.type,
          value: effectiveType === 'FREE_SHIPPING' ? null : dto.value,
          minPurchaseAmount: dto.minPurchaseAmount,
          appliesTo: dto.appliesTo,
          usageLimit: dto.usageLimit,
          usageLimitPerCustomer: dto.usageLimitPerCustomer,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
          active: dto.active,
          updatedAt: new Date(),
        });
        if (set) {
          await conn.query(`UPDATE discount SET ${set.setClause} WHERE id = ?`, [
            ...set.params,
            id,
          ]);
        }
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const discounts = await this.loadDiscountsWithRelations([id]);
    return this.toResponse(discounts.get(id)!);
  }

  async remove(ctx: TenantContext, id: number) {
    const discount = await this.findRaw(ctx, id);
    await this.db.execute(`DELETE FROM discount WHERE id = ?`, [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'discount.deleted',
      entityType: 'discount',
      entityId: id,
      before: { code: discount.code },
    });
    return { id, deleted: true };
  }

  // Full endpoint logic: resolve by code, then evaluate. Used by both
  // POST /shop/discounts/validate (admin-authenticated, draft-order builder)
  // and POST /public/:shopSlug/discounts/validate (storefront cart/checkout
  // — see PublicController) via the same shopId-scoped call.
  async validate(
    shopId: number,
    dto: ValidateDiscountDto,
  ): Promise<EvaluateResult> {
    const discount = await this.resolveByCode(shopId, dto.code);
    return this.evaluate(discount, dto);
  }

  async resolveByCode(
    shopId: number,
    code: string,
  ): Promise<AssembledDiscount | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM discount WHERE shopId = ? AND code = ?`,
      [shopId, this.normalizeCode(code)],
    );
    if (rows.length === 0) return null;
    const discounts = await this.loadDiscountsWithRelations([rows[0].id as number]);
    return discounts.get(rows[0].id as number) ?? null;
  }

  async resolveById(
    shopId: number,
    id: number,
  ): Promise<AssembledDiscount | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM discount WHERE id = ? AND shopId = ?`,
      [id, shopId],
    );
    if (rows.length === 0) return null;
    const discounts = await this.loadDiscountsWithRelations([id]);
    return discounts.get(id) ?? null;
  }

  // Eligibility/amount computation given an already-resolved discount row
  // (or null, for "code not found") — shared by validate() and by
  // OrdersService/PublicService's pre-transaction discount check before
  // order creation. Doesn't touch usage counters — see redeem() for the
  // atomic claim, which happens separately, inside the order's transaction.
  async evaluate(
    discount: AssembledDiscount | null,
    input: {
      cartSubtotal: number;
      productIds?: number[];
      collectionIds?: number[];
      customerId?: number;
    },
  ): Promise<EvaluateResult> {
    if (!discount) return this.reject('not_found');
    if (!discount.active) return this.reject('inactive');

    const now = new Date();
    if (discount.startsAt && now < discount.startsAt)
      return this.reject('not_started');
    if (discount.endsAt && now > discount.endsAt) return this.reject('expired');

    if (
      discount.minPurchaseAmount &&
      input.cartSubtotal < Number(discount.minPurchaseAmount)
    ) {
      return this.reject('min_purchase_not_met');
    }

    if (
      discount.usageLimit !== null &&
      discount.timesUsed >= discount.usageLimit
    ) {
      return this.reject('usage_limit_reached');
    }

    if (
      discount.usageLimitPerCustomer !== null &&
      input.customerId !== undefined
    ) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM discountredemption WHERE discountId = ? AND customerId = ?`,
        [discount.id, input.customerId],
      );
      const usedByCustomer = Number(rows[0].c);
      if (usedByCustomer >= discount.usageLimitPerCustomer) {
        return this.reject('per_customer_limit_reached');
      }
    }

    if (discount.appliesTo === 'SPECIFIC_PRODUCTS') {
      const eligibleIds = new Set(discount.products.map((p) => p.id));
      if (!(input.productIds ?? []).some((id) => eligibleIds.has(id))) {
        return this.reject('not_eligible');
      }
    } else if (discount.appliesTo === 'SPECIFIC_COLLECTIONS') {
      const eligibleIds = new Set(discount.collections.map((c) => c.id));
      if (!(input.collectionIds ?? []).some((id) => eligibleIds.has(id))) {
        return this.reject('not_eligible');
      }
    }

    return {
      valid: true,
      discountId: discount.id,
      code: discount.code,
      type: discount.type as DiscountType,
      discountAmount: this.computeAmount(discount, input.cartSubtotal),
      freeShipping: discount.type === 'FREE_SHIPPING',
    };
  }

  // Atomically claims one use — CAS on usageLimit, same WHERE-guarded
  // UPDATE idiom as outletstock's stock decrement — then records a
  // redemption row. Must run INSIDE the same transaction that creates the
  // order (see OrdersService.create/PublicService.createOrder): if the CAS
  // fails (limit reached by a concurrent request since evaluate() ran), this
  // throws and the whole order attempt aborts — a discount is never silently
  // dropped from an order that already priced it in.
  async redeem(
    conn: PoolConnection,
    discount: { id: number; usageLimit: number | null },
    orderId: number,
    customerId: number | null,
  ) {
    const conditions = ['id = ?'];
    const params: QueryParam[] = [discount.id];
    if (discount.usageLimit !== null) {
      conditions.push('timesUsed < ?');
      params.push(discount.usageLimit);
    }
    const [result] = await conn.query(
      `UPDATE discount SET timesUsed = timesUsed + 1, updatedAt = ? WHERE ${conditions.join(' AND ')}`,
      [new Date(), ...params],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new ConflictException(
        'This promo code has just reached its usage limit',
      );
    }
    await conn.query(
      `INSERT INTO discountredemption (discountId, customerId, orderId) VALUES (?, ?, ?)`,
      [discount.id, customerId, orderId],
    );
  }

  private reject(reason: DiscountRejectionReason): EvaluateResult {
    return {
      valid: false,
      reason,
      message: DISCOUNT_REJECTION_MESSAGES[reason],
    };
  }

  // Public — reused by DraftOrdersService to preview the discount amount on
  // an as-yet-unconverted draft order without duplicating the type/value math.
  computeAmount(
    discount: { type: string; value: string | number | null },
    cartSubtotal: number,
  ): number {
    if (discount.type === 'FREE_SHIPPING') return 0;
    const value = Number(discount.value ?? 0);
    if (discount.type === 'PERCENTAGE') {
      return Math.min(cartSubtotal, (cartSubtotal * value) / 100);
    }
    return Math.min(cartSubtotal, value);
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private assertFieldsMatchType(dto: { type: DiscountType; value?: number }) {
    if (dto.type === 'FREE_SHIPPING') {
      if (dto.value !== undefined) {
        throw new BadRequestException(
          'value must not be set for a FREE_SHIPPING discount',
        );
      }
    } else if (dto.value === undefined) {
      throw new BadRequestException(
        `value is required for a ${dto.type} discount`,
      );
    }
  }

  private async assertEligibilityTargetsBelongToShop(
    ctx: TenantContext,
    dto: { appliesTo?: string; productIds?: number[]; collectionIds?: number[] },
  ) {
    if (dto.productIds?.length) {
      const uniqueIds = [...new Set(dto.productIds)];
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM product WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
        [...uniqueIds, ctx.shopId],
      );
      if (Number(rows[0].c) !== uniqueIds.length) {
        throw new BadRequestException(
          'One or more productIds are invalid for this shop',
        );
      }
    }
    if (dto.collectionIds?.length) {
      const uniqueIds = [...new Set(dto.collectionIds)];
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM collection WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
        [...uniqueIds, ctx.shopId],
      );
      if (Number(rows[0].c) !== uniqueIds.length) {
        throw new BadRequestException(
          'One or more collectionIds are invalid for this shop',
        );
      }
    }
  }

  private async findRaw(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(DiscountRow & RowDataPacket)[]>(
      `SELECT * FROM discount WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Discount ${id} not found`);
    }
    return rows[0];
  }

  // Batch-loads discountproduct/discountcollection (with their own product/
  // collection name join) the way Prisma's nested include used to.
  private async loadDiscountsWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledDiscount>> {
    const result = new Map<number, AssembledDiscount>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const [discounts, productLinks, collectionLinks] = await Promise.all([
      this.db.query<(DiscountRow & RowDataPacket)[]>(
        `SELECT * FROM discount WHERE id IN (${idList})`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT dp.discountId, p.id AS productId, p.name AS productName
         FROM discountproduct dp JOIN product p ON p.id = dp.productId
         WHERE dp.discountId IN (${idList})`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT dc.discountId, c.id AS collectionId, c.name AS collectionName
         FROM discountcollection dc JOIN collection c ON c.id = dc.collectionId
         WHERE dc.discountId IN (${idList})`,
        ids,
      ),
    ]);
    const productsByDiscount = new Map<number, ProductSummary[]>();
    for (const row of productLinks) {
      const list = productsByDiscount.get(row.discountId as number) ?? [];
      list.push({ id: row.productId as number, name: row.productName as string });
      productsByDiscount.set(row.discountId as number, list);
    }
    const collectionsByDiscount = new Map<number, CollectionSummary[]>();
    for (const row of collectionLinks) {
      const list = collectionsByDiscount.get(row.discountId as number) ?? [];
      list.push({
        id: row.collectionId as number,
        name: row.collectionName as string,
      });
      collectionsByDiscount.set(row.discountId as number, list);
    }
    for (const d of discounts) {
      result.set(d.id, {
        ...d,
        products: productsByDiscount.get(d.id) ?? [],
        collections: collectionsByDiscount.get(d.id) ?? [],
      });
    }
    return result;
  }

  private toResponse(discount: AssembledDiscount) {
    return {
      ...discount,
      value: trimDecimal(discount.value),
      minPurchaseAmount: trimDecimal(discount.minPurchaseAmount),
    };
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A discount with this code already exists');
    }
    throw error;
  }
}
