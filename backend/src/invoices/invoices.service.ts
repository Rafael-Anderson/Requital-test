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
import { buildTaxBreakdown } from './invoice-tax';

// The shape version written into invoice.snapshotVersion. Bump it whenever
// OrderForInvoice changes in a way that moves or removes a field the renderer
// reads, so an older snapshot is recognised as a shape this code no longer
// understands and falls back to live rendering rather than being misread.
export const INVOICE_SNAPSHOT_VERSION = 1;

interface OrderForInvoice {
  id: number;
  shopOrderNumber: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  emirate: string | null;
  area: string | null;
  createdAt: Date;
  deliveryFee: string | null;
  discountAmount: string | null;
  discountCode: string | null;
  paymentMethod: string | null;
  paymentStatus: string;
  // The order's CURRENT total. Only the packing slip reads it (see buildHtml):
  // the rider collects what is owed now, not what was owed when the document was
  // first generated. Every other figure on an invoice comes from the frozen
  // invoice row.
  total: string;
  // Snapshotted for completeness (C1) even though the renderer does not print it
  // yet - when it does, it must read the frozen value, not a live one.
  giftCardAmount: string | null;
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
    // B2's per-line capture. NULL on any order that predates it - unknown, not
    // zero, which is why the renderer omits the column rather than printing 0.
    taxRate: string | null;
    taxAmount: string | null;
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

    // C1: freeze what the document renders. Read through loadOrderForInvoice -
    // the exact same loader buildHtml uses - so the snapshot's shape is identical
    // to the live shape by construction rather than by a parallel mapping that
    // could drift. Read-only, so it happens before the transaction.
    //
    // A PACKING_SLIP is deliberately NOT snapshotted: it is a live picking and
    // cash-collection document, and freezing it is what would cause a rider to
    // collect a stale amount.
    const snapshot =
      dto.type === 'PACKING_SLIP'
        ? null
        : await this.loadOrderForInvoice(order.id, ctx.shopId);

    try {
      const invoiceId = await this.db.transaction(async (conn) => {
        const invoiceNumber = await this.nextInvoiceNumber(
          conn,
          ctx.shopId,
          dto.type,
        );
        const [result] = await conn.query(
          `INSERT INTO invoice (orderId, shopId, type, invoiceNumber, subtotal, taxAmount, total, currency, taxInclusive,
                                snapshotJson, snapshotVersion)
           VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT currency FROM \`order\` WHERE id = ?),
                   (SELECT taxInclusive FROM shop WHERE id = ?), ?, ?)`,
          [
            order.id,
            ctx.shopId,
            dto.type,
            invoiceNumber,
            subtotal,
            taxAmount,
            order.total,
            // Taken from the order, not the shop. invoice-html.ts currently
            // formats every amount with a LIVE shop join, so a merchant
            // switching currency re-denominates invoices they already issued.
            order.id,
            // Whether `subtotal` above already contains the tax. Frozen for the
            // same reason as currency: flipping the shop toggle must not rewrite
            // the arithmetic of a document already issued. See invoice-html.ts.
            ctx.shopId,
            snapshot ? JSON.stringify(snapshot) : null,
            snapshot ? INVOICE_SNAPSHOT_VERSION : null,
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
      `SELECT productName, variantLabel, quantity, priceAtPurchase,
              autoDiscountAmount, taxRate, taxAmount
         FROM orderitem WHERE orderId = ?`,
      [orderId],
    );
    return {
      id: order.id as number,
      shopOrderNumber: order.shopOrderNumber as number,
      customerName: order.customerName as string,
      customerPhone: order.customerPhone as string,
      customerEmail: order.customerEmail as string | null,
      customerAddress: order.customerAddress as string,
      emirate: order.emirate as string | null,
      area: order.area as string | null,
      createdAt: order.createdAt as Date,
      deliveryFee: order.deliveryFee as string | null,
      discountAmount: order.discountAmount as string | null,
      discountCode: order.discountCode as string | null,
      paymentMethod: order.paymentMethod as string | null,
      paymentStatus: order.paymentStatus as string,
      total: order.total as string,
      giftCardAmount: order.giftCardAmount as string | null,
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
        // B2's capture. NULL on any order predating it, which the renderer
        // treats as unknown rather than zero.
        taxRate: i.taxRate as string | null,
        taxAmount: i.taxAmount as string | null,
      })),
    };
  }

  // What the document is rendered FROM.
  //
  // An INVOICE renders from its snapshot when it has one: line items, delivery
  // fee, discount, payment state, order number, and the customer and shop blocks
  // as they were when it was issued. Editing the order afterwards, or renaming
  // the shop, no longer rewrites a document already given to a customer.
  //
  // A PACKING_SLIP always renders LIVE, on purpose. It is a picking and
  // cash-collection document, not a record: its "CASH TO COLLECT" must be what is
  // owed NOW, or a rider collects a stale amount after the order was edited -
  // the concrete bug this piece exists to prevent.
  //
  // An unrecognised snapshotVersion falls back to live as well: reading fields out
  // of a shape this code no longer understands is worse than rendering fresh.
  private resolveRenderSource(
    invoice: InvoiceRow,
    live: OrderForInvoice,
  ): { order: OrderForInvoice; fromSnapshot: boolean } {
    if (invoice.type === 'PACKING_SLIP') {
      return { order: live, fromSnapshot: false };
    }
    if (
      invoice.snapshotJson == null ||
      invoice.snapshotVersion !== INVOICE_SNAPSHOT_VERSION
    ) {
      return { order: live, fromSnapshot: false };
    }
    // mysql2 parses a real JSON column for us (see the migration's note on why
    // the column is JSON and not LONGTEXT). createdAt comes back as the ISO
    // string JSON.stringify produced and the renderer calls
    // toLocaleDateString() on it, so it is revived to a Date here.
    const snapshot = invoice.snapshotJson as unknown as OrderForInvoice;
    return {
      order: { ...snapshot, createdAt: new Date(snapshot.createdAt) },
      fromSnapshot: true,
    };
  }

  private buildHtml(invoice: InvoiceRow, liveOrder: OrderForInvoice): string {
    const { order } = this.resolveRenderSource(invoice, liveOrder);
    // Grouped from the CAPTURED per-line figures, never recomputed from a live
    // rate - the whole point of the capture is that the document keeps adding up
    // after the shop's settings change.
    return renderInvoiceHtml({
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type as 'INVOICE' | 'PACKING_SLIP',
      issuedAt: invoice.issuedAt,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      // A packing slip's only money is "CASH TO COLLECT", and that has to be
      // what is owed NOW: invoice.total was frozen when the slip was generated,
      // so after an edit it would send the rider to collect the wrong amount.
      // An invoice keeps its frozen total, which is the whole point of an invoice.
      total: invoice.type === 'PACKING_SLIP' ? liveOrder.total : invoice.total,
      taxInclusive: invoice.taxInclusive,
      taxBreakdown: buildTaxBreakdown({
        items: order.orderitem,
        discountAmount: order.discountAmount,
        taxInclusive: invoice.taxInclusive,
        orderTaxAmount: invoice.taxAmount,
      }),
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
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT LAST_INSERT_ID() AS seq`,
    );
    const n = Number(rows[0].seq);
    const prefix = type === 'PACKING_SLIP' ? 'PS' : 'INV';
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }
}
