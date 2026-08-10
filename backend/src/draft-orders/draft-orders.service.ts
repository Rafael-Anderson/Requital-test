import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import type { DraftorderRow, DraftorderitemRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { ProductsService } from '../products/products.service';
import { DiscountsService } from '../discounts/discounts.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { buildVariantLabel } from '../products/variant-generator';
import { CreateDraftOrderDto } from './dto/create-draft-order.dto';
import { UpdateDraftOrderDto } from './dto/update-draft-order.dto';

interface DraftItemInput {
  productId: number;
  variantId?: number;
  quantity: number;
  price?: number;
}

interface AssembledDraftItem extends DraftorderitemRow {
  thumbnail: string;
  optionValue1: string | null;
  optionValue2: string | null;
  optionValue3: string | null;
}

interface AssembledDraftOrder extends DraftorderRow {
  draftorderitem: AssembledDraftItem[];
  discount: { id: number; code: string; type: string; value: string | null } | null;
  customer: { id: number; name: string; phone: string } | null;
  outlet: { id: number; name: string };
  convertedOrder: {
    id: number;
    status: string;
    paymentStatus: string;
    total: string;
    trackingToken: string | null;
  } | null;
}

@Injectable()
export class DraftOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM draftorder WHERE shopId = ? ORDER BY id DESC`,
      [ctx.shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const drafts = await this.loadDraftOrdersWithRelations(ids);
    return ids.map((id) => this.toResponse(drafts.get(id)!));
  }

  async findOne(ctx: TenantContext, id: number) {
    return this.toResponse(await this.findRawWithRelations(ctx, id));
  }

  async create(ctx: TenantContext, dto: CreateDraftOrderDto) {
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [dto.outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }

    const itemsData = await this.buildItemsData(ctx, dto.items);
    const subtotal = this.sumItems(itemsData ?? []);

    // Read-only — doesn't create a customer record for what might be an
    // abandoned draft; a real row is only ever created at conversion time,
    // via OrdersService -> CustomersService.findOrCreateForOrder.
    const existingCustomerRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM customer WHERE shopId = ? AND phone = ?`,
      [ctx.shopId, dto.customerPhone],
    );
    const existingCustomerId = existingCustomerRows[0]?.id as number | undefined;

    const discountId = dto.discountCode
      ? await this.resolveDiscountOrThrow(
          ctx.shopId,
          dto.discountCode,
          subtotal,
          existingCustomerId,
        )
      : null;

    const newId = await this.db.transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO draftorder (shopId, outletId, customerId, customerName, customerPhone, customerEmail, customerAddress, emirate, area, orderType, discountId, notes, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.outletId,
          existingCustomerId ?? null,
          dto.customerName,
          dto.customerPhone,
          dto.customerEmail ?? null,
          dto.customerAddress ?? null,
          dto.emirate ?? null,
          dto.area ?? null,
          dto.orderType ?? null,
          discountId,
          dto.notes ?? null,
          new Date(),
        ],
      );
      const draftId = (result as { insertId: number }).insertId;
      if (itemsData && itemsData.length > 0) {
        const placeholders = itemsData.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO draftorderitem (draftOrderId, productId, variantId, productName, quantity, price)
           VALUES ${placeholders}`,
          itemsData.flatMap((i) => [
            draftId,
            i.productId,
            i.variantId ?? null,
            i.productName,
            i.quantity,
            i.price,
          ]),
        );
      }
      return draftId;
    });
    return this.toResponse((await this.loadDraftOrdersWithRelations([newId])).get(newId)!);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDraftOrderDto) {
    const draft = await this.findRaw(ctx, id);
    if (draft.status !== 'OPEN') {
      throw new BadRequestException(
        `Cannot edit a draft order that is already '${draft.status}'`,
      );
    }
    if (dto.outletId !== undefined) {
      const outletRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [dto.outletId, ctx.shopId],
      );
      if (outletRows.length === 0) {
        throw new BadRequestException('outletId is invalid for this shop');
      }
    }

    const itemsData = await this.buildItemsData(ctx, dto.items);
    let subtotal: number;
    if (itemsData) {
      subtotal = this.sumItems(itemsData);
    } else {
      const existingItems = await this.db.query<RowDataPacket[]>(
        `SELECT price, quantity FROM draftorderitem WHERE draftOrderId = ?`,
        [id],
      );
      subtotal = this.sumItems(
        existingItems.map((i) => ({
          price: i.price as string,
          quantity: i.quantity as number,
        })),
      );
    }

    let discountId: number | null | undefined;
    if (dto.discountCode === null) {
      discountId = null;
    } else if (dto.discountCode !== undefined) {
      const phone = dto.customerPhone ?? draft.customerPhone;
      const existingCustomerRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM customer WHERE shopId = ? AND phone = ?`,
        [ctx.shopId, phone],
      );
      discountId = await this.resolveDiscountOrThrow(
        ctx.shopId,
        dto.discountCode,
        subtotal,
        existingCustomerRows[0]?.id as number | undefined,
      );
    }

    await this.db.transaction(async (conn) => {
      if (itemsData) {
        await conn.query(`DELETE FROM draftorderitem WHERE draftOrderId = ?`, [id]);
        if (itemsData.length > 0) {
          const placeholders = itemsData.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
          await conn.query(
            `INSERT INTO draftorderitem (draftOrderId, productId, variantId, productName, quantity, price) VALUES ${placeholders}`,
            itemsData.flatMap((i) => [
              id,
              i.productId,
              i.variantId ?? null,
              i.productName,
              i.quantity,
              i.price,
            ]),
          );
        }
      }
      const set = buildSetClause({
        outletId: dto.outletId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        customerAddress: dto.customerAddress,
        emirate: dto.emirate,
        area: dto.area,
        orderType: dto.orderType,
        discountId,
        notes: dto.notes,
        updatedAt: new Date(),
      });
      if (set) {
        await conn.query(`UPDATE draftorder SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          id,
        ]);
      }
    });
    return this.toResponse((await this.loadDraftOrdersWithRelations([id])).get(id)!);
  }

  async cancel(ctx: TenantContext, id: number) {
    const draft = await this.findRaw(ctx, id);
    if (draft.status === 'COMPLETED' || draft.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot cancel a draft order that is already '${draft.status}'`,
      );
    }
    if (draft.convertedOrderId) {
      // INVOICE_SENT — a real (unpaid) order already exists; cancel it too
      // through the existing order-cancel path rather than leaving it
      // orphaned (it also restocks reserved inventory, same as any other
      // storefront-style cancellation — see OrdersService.cancel).
      await this.ordersService.cancel(ctx, draft.convertedOrderId);
    }
    await this.db.execute(
      `UPDATE draftorder SET status = 'CANCELLED', updatedAt = ? WHERE id = ?`,
      [new Date(), id],
    );
    return this.findOne(ctx, id);
  }

  // "Mark as paid" — the cash/COD-style path for a phone order that skips
  // the payment link entirely. Converts to a real Order if that hasn't
  // already happened via sendInvoice (customer paid by cash instead of
  // using the link that was sent), then marks it paid.
  async complete(ctx: TenantContext, id: number) {
    const draft = await this.findRawWithItems(ctx, id);
    if (draft.status === 'COMPLETED' || draft.status === 'CANCELLED') {
      throw new BadRequestException(`Draft order is already '${draft.status}'`);
    }
    if (draft.draftorderitem.length === 0) {
      throw new BadRequestException(
        'Add at least one item before completing this draft order',
      );
    }

    let orderId = draft.convertedOrderId;
    if (!orderId) {
      const order = await this.convertToOrder(ctx, draft);
      orderId = order.id as number;
    }
    await this.db.execute(`UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`, [
      orderId,
    ]);
    await this.db.execute(
      `UPDATE draftorder SET status = 'COMPLETED', convertedOrderId = ?, updatedAt = ? WHERE id = ?`,
      [orderId, new Date(), id],
    );
    return this.findOne(ctx, id);
  }

  // Converts to a real (unpaid) Order immediately and generates a payment
  // link on it via the existing mechanism (PaymentsService.generateLink) —
  // no separate draft-order payment infrastructure. Actual payment
  // template then follows the normal flow for that order; a merchant who
  // sees it get paid (or gets paid by cash instead) calls complete() to
  // finish it off, or the order can be tracked/marked paid the same way any
  // other order is.
  async sendInvoice(ctx: TenantContext, id: number) {
    const draft = await this.findRawWithItems(ctx, id);
    if (draft.status !== 'OPEN') {
      throw new BadRequestException(
        'Only an open draft order can have an invoice sent',
      );
    }
    if (draft.draftorderitem.length === 0) {
      throw new BadRequestException(
        'Add at least one item before sending an invoice',
      );
    }

    const order = await this.convertToOrder(ctx, draft);
    const paymentLink = await this.paymentsService.generateLink(ctx, order.id as number);
    await this.db.execute(
      `UPDATE draftorder SET status = 'INVOICE_SENT', convertedOrderId = ?, updatedAt = ? WHERE id = ?`,
      [order.id, new Date(), id],
    );
    return { draftOrder: await this.findOne(ctx, id), paymentLink };
  }

  // Funnels into OrdersService.create — the exact same pricing/item-
  // resolution/customer/discount path a storefront or admin-entered order
  // uses (with reserveStock: true, matching storefront checkout's immediate
  // atomic stock reservation, not the deferred-to-confirm behavior a plain
  // admin-entered order gets) — so draft orders can't silently drift from
  // how every other order is built.
  private async convertToOrder(
    ctx: TenantContext,
    draft: DraftorderRow & { draftorderitem: DraftorderitemRow[]; discountCode?: string },
  ) {
    return this.ordersService.create(
      ctx,
      {
        outletId: draft.outletId,
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        customerEmail: draft.customerEmail ?? undefined,
        // Guaranteed non-null: CreateDraftOrderDto requires both fields at
        // creation time even though the DB column is nullable (nullable
        // only so historical/edge rows can't violate a NOT NULL constraint).
        customerAddress: draft.customerAddress as string,
        emirate: draft.emirate as string,
        area: draft.area ?? undefined,
        orderType: draft.orderType ?? undefined,
        channel: 'draft_order',
        discountCode: draft.discountCode,
        items: draft.draftorderitem.map((i) => ({
          productId: i.productId,
          variantId: i.variantId ?? undefined,
          quantity: i.quantity,
          priceOverride: Number(i.price),
        })),
      },
      { reserveStock: true },
    );
  }

  private async buildItemsData(
    ctx: TenantContext,
    items: DraftItemInput[] | undefined,
  ) {
    if (!items) return undefined;
    const resolved = await this.productsService.resolveOrderItems(
      ctx.shopId,
      items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        priceOverride: i.price,
      })),
    );
    return resolved.map(({ product, variant, quantity, price }) => ({
      productId: product.id as number,
      variantId: variant?.id ?? null,
      productName: product.name as string,
      quantity,
      price,
    }));
  }

  private sumItems(
    items: { price: string | number; quantity: number }[],
  ): number {
    return items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  }

  private async resolveDiscountOrThrow(
    shopId: number,
    code: string,
    subtotal: number,
    customerId?: number,
  ) {
    const discount = await this.discountsService.resolveByCode(shopId, code);
    const result = await this.discountsService.evaluate(discount, {
      cartSubtotal: subtotal,
      customerId,
    });
    if (!result.valid) {
      throw new BadRequestException(
        result.message ?? 'This discount code cannot be applied',
      );
    }
    return result.discountId!;
  }

  private async findRaw(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(DraftorderRow & RowDataPacket)[]>(
      `SELECT * FROM draftorder WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Draft order ${id} not found`);
    }
    return rows[0];
  }

  private async findRawWithRelations(ctx: TenantContext, id: number) {
    await this.findRaw(ctx, id);
    const draft = (await this.loadDraftOrdersWithRelations([id])).get(id);
    if (!draft) {
      throw new NotFoundException(`Draft order ${id} not found`);
    }
    return draft;
  }

  private async findRawWithItems(ctx: TenantContext, id: number) {
    const draft = await this.findRaw(ctx, id);
    const items = await this.db.query<(DraftorderitemRow & RowDataPacket)[]>(
      `SELECT * FROM draftorderitem WHERE draftOrderId = ?`,
      [id],
    );
    let discountCode: string | undefined;
    if (draft.discountId) {
      const discountRows = await this.db.query<RowDataPacket[]>(
        `SELECT code FROM discount WHERE id = ?`,
        [draft.discountId],
      );
      discountCode = discountRows[0]?.code as string | undefined;
    }
    return { ...draft, draftorderitem: items, discountCode };
  }

  // Batch-loads every relation draftOrderInclude used to fetch in one
  // Prisma nested include, as separate WHERE...IN queries grouped in JS.
  private async loadDraftOrdersWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledDraftOrder>> {
    const result = new Map<number, AssembledDraftOrder>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const [drafts, items] = await Promise.all([
      this.db.query<(DraftorderRow & RowDataPacket)[]>(
        `SELECT d.*, disc.code AS discountCode, disc.type AS discountType, disc.value AS discountValue,
                c.id AS customerRowId, c.name AS customerName2, c.phone AS customerPhone2,
                o.id AS outletRowId, o.name AS outletName,
                co.id AS convertedOrderRowId, co.status AS convertedOrderStatus,
                co.paymentStatus AS convertedOrderPaymentStatus, co.total AS convertedOrderTotal,
                co.trackingToken AS convertedOrderTrackingToken
         FROM draftorder d
         LEFT JOIN discount disc ON disc.id = d.discountId
         LEFT JOIN customer c ON c.id = d.customerId
         JOIN outlet o ON o.id = d.outletId
         LEFT JOIN \`order\` co ON co.id = d.convertedOrderId
         WHERE d.id IN (${idList})`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT di.*, p.thumbnail AS productThumbnail,
                ov1.value AS optionValue1, ov2.value AS optionValue2, ov3.value AS optionValue3
         FROM draftorderitem di
         JOIN product p ON p.id = di.productId
         LEFT JOIN productvariant v ON v.id = di.variantId
         LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
         LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
         LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
         WHERE di.draftOrderId IN (${idList})`,
        ids,
      ),
    ]);
    const itemsByDraft = new Map<number, AssembledDraftItem[]>();
    for (const item of items) {
      const list = itemsByDraft.get(item.draftOrderId as number) ?? [];
      list.push({
        id: item.id as number,
        draftOrderId: item.draftOrderId as number,
        productId: item.productId as number,
        variantId: item.variantId as number | null,
        productName: item.productName as string,
        quantity: item.quantity as number,
        price: item.price as string,
        thumbnail: item.productThumbnail as string,
        optionValue1: item.optionValue1 as string | null,
        optionValue2: item.optionValue2 as string | null,
        optionValue3: item.optionValue3 as string | null,
      });
      itemsByDraft.set(item.draftOrderId as number, list);
    }
    for (const d of drafts) {
      result.set(d.id, {
        ...d,
        draftorderitem: itemsByDraft.get(d.id) ?? [],
        discount: d.discountId
          ? {
              id: d.discountId,
              code: d.discountCode as unknown as string,
              type: d.discountType as unknown as string,
              value: d.discountValue as unknown as string | null,
            }
          : null,
        customer: d.customerId
          ? {
              id: d.customerRowId as unknown as number,
              name: d.customerName2 as unknown as string,
              phone: d.customerPhone2 as unknown as string,
            }
          : null,
        outlet: {
          id: d.outletRowId as unknown as number,
          name: d.outletName as unknown as string,
        },
        convertedOrder: d.convertedOrderId
          ? {
              id: d.convertedOrderRowId as unknown as number,
              status: d.convertedOrderStatus as unknown as string,
              paymentStatus: d.convertedOrderPaymentStatus as unknown as string,
              total: d.convertedOrderTotal as unknown as string,
              trackingToken: d.convertedOrderTrackingToken as unknown as string | null,
            }
          : null,
      });
    }
    return result;
  }

  private toResponse(draft: AssembledDraftOrder) {
    const { draftorderitem, discount, ...rest } = draft;
    const items = draftorderitem.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      thumbnail: i.thumbnail,
      variantId: i.variantId,
      variantLabel: i.variantId
        ? buildVariantLabel([i.optionValue1, i.optionValue2, i.optionValue3])
        : null,
      quantity: i.quantity,
      price: trimDecimal(i.price),
    }));
    const subtotal = this.sumItems(items);
    const discountAmount = discount
      ? this.discountsService.computeAmount(discount, subtotal)
      : 0;
    const total = Math.max(0, subtotal - discountAmount);
    return {
      ...rest,
      discount: discount
        ? { id: discount.id, code: discount.code, type: discount.type }
        : null,
      items,
      subtotal,
      discountAmount,
      total,
    };
  }
}
