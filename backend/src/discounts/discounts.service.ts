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
  DiscountAppliesTo,
  DiscountKind,
  DiscountRejectionReason,
  DiscountType,
} from './discount-constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  computeDiscountAmount,
  computeEligibility,
  lineMatchesScope,
} from './discount-eligibility';
import type { DiscountLine } from './discount-eligibility';

export interface ProductSummary {
  id: number;
  name: string;
}
export interface CollectionSummary {
  id: number;
  name: string;
}

export interface PublicAutoDiscount {
  id: number;
  type: DiscountType;
  value: string;
  appliesTo: DiscountAppliesTo;
  productIds: number[];
  collectionIds: number[];
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
    const discountType = dto.discountType ?? 'code';
    const appliesTo = dto.appliesTo ?? 'ALL_PRODUCTS';
    this.assertDiscountKindFields({ discountType, code: dto.code, appliesTo });
    await this.assertEligibilityTargetsBelongToShop(ctx, dto);

    let insertId: number;
    try {
      insertId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO discount (shopId, code, discountType, type, value, minPurchaseAmount, appliesTo, usageLimit, usageLimitPerCustomer, startsAt, endsAt, active, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            dto.code ? this.normalizeCode(dto.code) : null,
            discountType,
            dto.type,
            dto.type === 'FREE_SHIPPING' ? null : (dto.value ?? null),
            dto.minPurchaseAmount ?? null,
            appliesTo,
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
    const effectiveDiscountType = dto.discountType ?? (current.discountType as DiscountKind);
    const effectiveAppliesTo = dto.appliesTo ?? (current.appliesTo as DiscountAppliesTo);
    // Switching to 'auto' always clears code, even if this request didn't
    // itself touch the code field — an auto-apply discount can't be left
    // holding a stale code from when it required one.
    const effectiveCode =
      dto.discountType === 'auto' ? undefined : dto.code !== undefined ? dto.code : (current.code ?? undefined);
    if (dto.discountType || dto.code !== undefined || dto.appliesTo) {
      this.assertDiscountKindFields({
        discountType: effectiveDiscountType,
        code: effectiveCode,
        appliesTo: effectiveAppliesTo,
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
          code:
            dto.discountType === 'auto'
              ? null
              : dto.code
                ? this.normalizeCode(dto.code)
                : undefined,
          discountType: dto.discountType,
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

  // Full endpoint logic: resolve by code, then evaluate. Used by both the
  // admin draft-order builder (POST /shop/discounts/validate) and the
  // storefront cart/checkout (POST /public/:shopSlug/discounts/validate), each
  // via the same shopId-scoped call.
  //
  // `lines` are built by the caller from the request's `items` through
  // ProductsService.resolveOrderItems + buildLines(), i.e. exactly what order
  // creation derives, so the amount shown here is the amount charged. Without
  // them (the pre-items request shape: a cart total plus loose product ids)
  // eligibility still works off the ids, but the amount can only be taken on
  // the whole cart total, so such a caller can disagree with the charge for a
  // scoped code on a mixed basket. Real callers send items.
  async validate(
    shopId: number,
    dto: ValidateDiscountDto,
    lines?: DiscountLine[],
  ): Promise<EvaluateResult> {
    const discount = await this.resolveByCode(shopId, dto.code);
    const currency = await this.shopCurrency(shopId);
    if (lines) {
      return this.evaluate(discount, {
        lines,
        customerId: dto.customerId,
        currency,
      });
    }
    return this.evaluate(discount, {
      lines: await this.legacyLines(shopId, dto),
      wholeCartSubtotal: dto.cartSubtotal,
      customerId: dto.customerId,
      currency,
    });
  }

  private async shopCurrency(shopId: number): Promise<string | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT currency FROM shop WHERE id = ?`,
      [shopId],
    );
    return (rows[0]?.currency as string | undefined) ?? null;
  }

  // Order-creation callers pass their RESOLVED items (server prices: the unit
  // price already net of any auto-discount). Collection membership is read
  // here, shop-scoped, never taken from the client.
  async buildLines(
    shopId: number,
    items: { productId: number; price: string | number; quantity: number }[],
  ): Promise<DiscountLine[]> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const byProduct = await this.collectionIdsByProduct(shopId, ids);
    return items.map((i) => ({
      productId: i.productId,
      collectionIds: byProduct.get(i.productId) ?? [],
      amount: Number(i.price) * i.quantity,
    }));
  }

  private async collectionIdsByProduct(shopId: number, productIds: number[]) {
    const byProduct = new Map<number, number[]>();
    if (productIds.length === 0) return byProduct;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT pc.productId, pc.collectionId
         FROM productcollection pc JOIN product p ON p.id = pc.productId
        WHERE pc.productId IN (${productIds.map(() => '?').join(', ')}) AND p.shopId = ?`,
      [...productIds, shopId],
    );
    for (const r of rows) {
      const list = byProduct.get(r.productId as number) ?? [];
      list.push(r.collectionId as number);
      byProduct.set(r.productId as number, list);
    }
    return byProduct;
  }

  // The pre-items validate shape. Client collectionIds ride along as one
  // product-less line: it can satisfy a collection scope but never a product
  // scope. Display-only, as it always was; nothing here is ever charged.
  private async legacyLines(
    shopId: number,
    dto: ValidateDiscountDto,
  ): Promise<DiscountLine[]> {
    const productIds = [...new Set(dto.productIds ?? [])];
    const byProduct = await this.collectionIdsByProduct(shopId, productIds);
    const lines: DiscountLine[] = productIds.map((productId) => ({
      productId,
      collectionIds: byProduct.get(productId) ?? [],
      amount: 0,
    }));
    if (dto.collectionIds?.length) {
      lines.push({ productId: 0, collectionIds: dto.collectionIds, amount: 0 });
    }
    return lines;
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
      // Resolved order lines (see buildLines). The single source for
      // eligibility, the eligible subtotal and the amount.
      lines: DiscountLine[];
      customerId?: number;
      // An order's own redemption must not count against its own per-customer
      // limit when it is re-evaluated (updateItems); see assertPerCustomerLimit.
      excludeOrderId?: number;
      // The order's currency; the amount is rounded to its real minor unit.
      currency?: string | null;
      // Legacy validate shape only; see validate().
      wholeCartSubtotal?: number;
    },
  ): Promise<EvaluateResult> {
    const cartSubtotal =
      input.wholeCartSubtotal ??
      input.lines.reduce((sum, l) => sum + l.amount, 0);
    if (!discount) return this.reject('not_found');
    if (!discount.active) return this.reject('inactive');

    const now = new Date();
    if (discount.startsAt && now < discount.startsAt)
      return this.reject('not_started');
    if (discount.endsAt && now > discount.endsAt) return this.reject('expired');

    if (
      discount.minPurchaseAmount &&
      cartSubtotal < Number(discount.minPurchaseAmount)
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
        `SELECT COUNT(*) AS c FROM discountredemption WHERE discountId = ? AND customerId = ? AND orderId <> ?`,
        [discount.id, input.customerId, input.excludeOrderId ?? 0],
      );
      const usedByCustomer = Number(rows[0].c);
      if (usedByCustomer >= discount.usageLimitPerCustomer) {
        return this.reject('per_customer_limit_reached');
      }
    }

    const eligibility = computeEligibility(
      {
        type: discount.type,
        value: discount.value,
        appliesTo: discount.appliesTo,
        productIds: discount.products.map((p) => p.id),
        collectionIds: discount.collections.map((c) => c.id),
      },
      input.lines,
      input.currency,
      input.wholeCartSubtotal,
    );
    if (!eligibility.eligible) return this.reject('not_eligible');

    return {
      valid: true,
      discountId: discount.id,
      code: discount.code ?? undefined,
      type: discount.type as DiscountType,
      discountAmount: eligibility.discountAmount,
      freeShipping: discount.type === 'FREE_SHIPPING',
    };
  }

  // Enforces usageLimitPerCustomer authoritatively, inside the order's own
  // transaction (evaluate() only sees committed rows and runs before the
  // customer exists, so it is advisory). Call it as the FIRST statement of the
  // transaction, after the customer row is resolved (findOrCreateForOrder).
  //
  // Race safety: locking the customer row FOR UPDATE serialises every order by
  // the same customer for this shop, so the count below cannot interleave with
  // a sibling's INSERT INTO discountredemption. It must be the first statement
  // because the COUNT is a plain (snapshot) read: under REPEATABLE READ the
  // snapshot is taken at the transaction's first consistent read, so taking the
  // lock before any read means the snapshot is taken after the winner committed.
  // A locking COUNT (FOR UPDATE) was rejected: it next-key/gap-locks the
  // (discountId, customerId) index, and two different customers inserting into
  // the same gap deadlock. Only locks when the discount has a per-customer
  // limit, so unlimited codes pay nothing. A cancelled or fully refunded
  // order's redemption is deleted (release-redemption.ts), so it stops counting.
  async assertPerCustomerLimit(
    conn: PoolConnection,
    shopId: number,
    discount: { id: number; usageLimitPerCustomer: number | null },
    customerId: number,
  ) {
    if (discount.usageLimitPerCustomer === null) return;
    const [locked] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM customer WHERE id = ? AND shopId = ? FOR UPDATE`,
      [customerId, shopId],
    );
    if (locked.length === 0) {
      throw new ConflictException('Customer could not be resolved, please retry');
    }
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM discountredemption dr
         JOIN discount d ON d.id = dr.discountId AND d.shopId = ?
        WHERE dr.discountId = ? AND dr.customerId = ?`,
      [shopId, discount.id, customerId],
    );
    if (Number(rows[0].c) >= discount.usageLimitPerCustomer) {
      throw new ConflictException(
        DISCOUNT_REJECTION_MESSAGES.per_customer_limit_reached,
      );
    }
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

  // Public — every currently-live 'auto' discount for a shop, in the shape
  // the storefront needs to compute a struck-through price on a product
  // card/PDP with zero customer action (no code, no cart-total round trip).
  // Public-safe fields only: no usageLimit/timesUsed/id-of-redemptions, etc.
  async listActiveAutoDiscounts(shopId: number): Promise<PublicAutoDiscount[]> {
    const now = new Date();
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM discount
       WHERE shopId = ? AND discountType = 'auto' AND active = 1
         AND (startsAt IS NULL OR startsAt <= ?)
         AND (endsAt IS NULL OR endsAt >= ?)`,
      [shopId, now, now],
    );
    const ids = rows.map((r) => r.id as number);
    const discounts = await this.loadDiscountsWithRelations(ids);
    return ids.map((id) => {
      const d = discounts.get(id)!;
      return {
        id: d.id,
        type: d.type as DiscountType,
        value: trimDecimal(d.value) ?? '0',
        appliesTo: d.appliesTo as DiscountAppliesTo,
        productIds: d.products.map((p) => p.id),
        collectionIds: d.collections.map((c) => c.id),
      };
    });
  }

  // Public — mirrors storefront's computeAutoDiscountedPrice (lib/auto-
  // discounts.ts) on the server, since order pricing must never trust a
  // client-computed display value. See ProductsService.resolveOrderItems,
  // the only caller: given the shop's already-fetched active auto-discounts
  // (one query per resolveOrderItems call, not per item) and one item's
  // price/scope, returns the best (largest) matching discount amount, or 0
  // if none apply. Reuses computeAmount for the actual percent/fixed math
  // so both call sites can never drift apart.
  findBestAutoDiscountAmount(
    autoDiscounts: PublicAutoDiscount[],
    item: { productId: number; price: number; collectionIds: number[] },
  ): number {
    let bestAmount = 0;
    for (const discount of autoDiscounts) {
      if (discount.type === 'FREE_SHIPPING') continue; // no effect on price
      // ALL_PRODUCTS is never a valid scope for an auto discount
      // (backend-enforced at create/update time), so it never applies here.
      if (discount.appliesTo === 'ALL_PRODUCTS') continue;
      if (
        !lineMatchesScope(discount, {
          productId: item.productId,
          collectionIds: item.collectionIds,
        })
      )
        continue;
      const amount = this.computeAmount(discount, item.price);
      if (amount > bestAmount) bestAmount = amount;
    }
    return bestAmount;
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
    base: number,
  ): number {
    return computeDiscountAmount(discount, base);
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private assertDiscountKindFields(fields: {
    discountType: DiscountKind;
    code?: string;
    appliesTo: DiscountAppliesTo;
  }) {
    if (fields.discountType === 'code') {
      if (!fields.code) {
        throw new BadRequestException(
          'code is required for a code-based discount',
        );
      }
    } else {
      if (fields.code) {
        throw new BadRequestException(
          'code must not be set for an auto-apply discount',
        );
      }
      if (fields.appliesTo === 'ALL_PRODUCTS') {
        throw new BadRequestException(
          'An auto-apply discount must be scoped to specific products or collections',
        );
      }
    }
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
