import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import type { InvoiceRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { InvoiceType } from './invoices.constants';
import { renderInvoiceHtml } from './invoice-html';

interface OrderForInvoice {
  id: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  emirate: string;
  area: string | null;
  createdAt: Date;
  deliveryFee: string | null;
  discountAmount: string | null;
  discountCode: string | null;
  paymentMethod: string | null;
  paymentStatus: string;
  shopName: string;
  shopDisplayName: string | null;
  shopAddress: string | null;
  shopEmail: string | null;
  shopCurrency: string;
  orderitem: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceAtPurchase: string;
    autoDiscountAmount: string | null;
  }[];
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ordersService: OrdersService,
  ) {}

  // Idempotent: a second call for the same (orderId, type) returns the
  // already-generated invoice rather than erroring or creating a duplicate.
  async generateForOrder(ctx: TenantContext, dto: CreateInvoiceDto) {
    // Tenant/outlet scope check — 404s for another shop's order (and, for a
    // branch user, an order outside their own outlet) without ever
    // confirming the order exists, same as every other resource-scoped
    // lookup in this codebase (OrdersService.findOne, GiftCardsService,
    // etc.) rather than a ForbiddenException that would leak existence.
    const order = await this.ordersService.findOne(ctx, dto.orderId);

    const existingRows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
      `SELECT * FROM invoice WHERE orderId = ? AND type = ?`,
      [order.id, dto.type],
    );
    if (existingRows[0]) return existingRows[0];

    const subtotal = order.orderitem.reduce(
      (sum: number, item: { priceAtPurchase: string; quantity: number }) =>
        sum + Number(item.priceAtPurchase) * item.quantity,
      0,
    );
    const taxAmount = Number(order.taxAmount ?? 0);

    try {
      const invoiceId = await this.db.transaction(async (conn) => {
        const invoiceNumber = await this.nextInvoiceNumber(
          conn,
          ctx.shopId,
          dto.type,
        );
        const [result] = await conn.query(
          `INSERT INTO invoice (orderId, shopId, type, invoiceNumber, subtotal, taxAmount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            order.id,
            ctx.shopId,
            dto.type,
            invoiceNumber,
            subtotal,
            taxAmount,
            order.total,
          ],
        );
        return (result as { insertId: number }).insertId;
      });
      const rows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
        `SELECT * FROM invoice WHERE id = ?`,
        [invoiceId],
      );
      return rows[0];
    } catch (error) {
      // Lost the race to a concurrent generate for the same order+type —
      // the unique constraint on (orderId, type) is what actually enforces
      // idempotency under concurrency; this just lets the loser read back
      // what the winner created instead of erroring. Same
      // catch-duplicate-key-and-no-op-idempotency pattern as
      // PaymentsService.handleWebhook (see that method's own comment).
      if (isDuplicateKeyError(error) || isLockConflict(error)) {
        const winnerRows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
          `SELECT * FROM invoice WHERE orderId = ? AND type = ?`,
          [order.id, dto.type],
        );
        if (winnerRows[0]) return winnerRows[0];
      }
      throw error;
    }
  }

  async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
      `SELECT * FROM invoice WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const invoice = rows[0];
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    // Outlet scope check, not just shopId — a branch user must be equally
    // blocked from an invoice belonging to a sibling outlet's order as they
    // are from the order itself. Reuses OrdersService.findOne's own
    // outlet-scoping/permission logic rather than duplicating it here.
    await this.ordersService.findOne(ctx, invoice.orderId);
    return invoice;
  }

  async findAllForOrder(ctx: TenantContext, orderId: number) {
    await this.ordersService.findOne(ctx, orderId); // tenant/outlet scope check
    return this.db.query<(InvoiceRow & RowDataPacket)[]>(
      `SELECT * FROM invoice WHERE orderId = ? AND shopId = ? ORDER BY issuedAt ASC`,
      [orderId, ctx.shopId],
    );
  }

  async renderHtml(ctx: TenantContext, id: number): Promise<string> {
    const invoice = await this.findOne(ctx, id);
    // Re-scoped by shopId again here, not just trusted from findOne's
    // result, since this is the one call site that reaches back into
    // `order` directly rather than staying inside the already-scoped
    // invoice row.
    const order = await this.loadOrderForInvoice(invoice.orderId, ctx.shopId);
    if (!order) {
      throw new NotFoundException(`Order ${invoice.orderId} not found`);
    }
    return this.buildHtml(invoice, order);
  }

  // Storefront counterpart of renderHtml above — scoped by (shopId,
  // customerId) instead of staff TenantContext, for the customer-account
  // "Download Invoice" link (see CustomerAccountController). Never
  // generates: the storefront only ever downloads an invoice the merchant
  // already generated from the admin Invoice tab, same "read-only from the
  // customer's side" shape as every other customer-account/order-history
  // endpoint in this codebase.
  async renderHtmlForCustomerOrder(
    shopId: number,
    customerId: number,
    orderId: number,
  ): Promise<string> {
    const order = await this.loadOrderForInvoice(orderId, shopId, customerId);
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    const rows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
      `SELECT * FROM invoice WHERE orderId = ? AND type = 'INVOICE'`,
      [orderId],
    );
    const invoice = rows[0];
    if (!invoice) {
      throw new NotFoundException(`No invoice generated for order ${orderId}`);
    }
    return this.buildHtml(invoice, order);
  }

  private async loadOrderForInvoice(
    orderId: number,
    shopId: number,
    customerId?: number,
  ): Promise<OrderForInvoice | null> {
    const conditions = ['o.id = ?', 'o.shopId = ?'];
    const params: (number | string)[] = [orderId, shopId];
    if (customerId !== undefined) {
      conditions.push('o.customerId = ?');
      params.push(customerId);
    }
    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT o.*, s.name AS shopName, s.displayName AS shopDisplayName,
              s.address AS shopAddress, s.email AS shopEmail, s.currency AS shopCurrency
       FROM \`order\` o JOIN shop s ON s.id = o.shopId
       WHERE ${conditions.join(' AND ')}`,
      params,
    );
    const order = orderRows[0];
    if (!order) return null;
    const items = await this.db.query<RowDataPacket[]>(
      `SELECT productName, variantLabel, quantity, priceAtPurchase, autoDiscountAmount FROM orderitem WHERE orderId = ?`,
      [orderId],
    );
    return {
      id: order.id as number,
      customerName: order.customerName as string,
      customerPhone: order.customerPhone as string,
      customerEmail: order.customerEmail as string | null,
      customerAddress: order.customerAddress as string,
      emirate: order.emirate as string,
      area: order.area as string | null,
      createdAt: order.createdAt as Date,
      deliveryFee: order.deliveryFee as string | null,
      discountAmount: order.discountAmount as string | null,
      discountCode: order.discountCode as string | null,
      paymentMethod: order.paymentMethod as string | null,
      paymentStatus: order.paymentStatus as string,
      shopName: order.shopName as string,
      shopDisplayName: order.shopDisplayName as string | null,
      shopAddress: order.shopAddress as string | null,
      shopEmail: order.shopEmail as string | null,
      shopCurrency: order.shopCurrency as string,
      orderitem: items.map((i) => ({
        productName: i.productName as string,
        variantLabel: i.variantLabel as string | null,
        quantity: i.quantity as number,
        priceAtPurchase: i.priceAtPurchase as string,
        autoDiscountAmount: i.autoDiscountAmount as string | null,
      })),
    };
  }

  private buildHtml(invoice: InvoiceRow, order: OrderForInvoice): string {
    return renderInvoiceHtml({
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type as 'INVOICE' | 'PACKING_SLIP',
      issuedAt: invoice.issuedAt,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      notes: invoice.notes,
      shopName: order.shopDisplayName ?? order.shopName,
      shopAddress: order.shopAddress,
      shopEmail: order.shopEmail,
      currency: order.shopCurrency,
      order,
    });
  }

  // Atomic per-(shop,type) sequence via MySQL's `INSERT ... ON DUPLICATE KEY
  // UPDATE ... LAST_INSERT_ID(...)` idiom — the row lock this statement
  // takes serializes concurrent callers, which a read-then-write upsert is
  // not guaranteed to do. See invoicecounter's schema comment.
  private async nextInvoiceNumber(
    conn: PoolConnection,
    shopId: number,
    type: InvoiceType,
  ): Promise<string> {
    // `invoicecounter` has no AUTO_INCREMENT column of its own, so the
    // plain-INSERT branch (first invoice ever for this shop+type) would
    // leave LAST_INSERT_ID() untouched — wrapping the seed value in
    // LAST_INSERT_ID(1) too (not just the ON DUPLICATE KEY UPDATE branch's
    // increment) is what makes SELECT LAST_INSERT_ID() below correct on
    // both the create and increment paths, not just whichever one happened
    // to run last on this pooled connection.
    await conn.query(
      `INSERT INTO invoicecounter (shopId, type, lastNumber)
       VALUES (?, ?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE lastNumber = LAST_INSERT_ID(lastNumber + 1)`,
      [shopId, type],
    );
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT LAST_INSERT_ID() AS seq`);
    const n = Number(rows[0].seq);
    const prefix = type === 'PACKING_SLIP' ? 'PS' : 'INV';
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }
}
