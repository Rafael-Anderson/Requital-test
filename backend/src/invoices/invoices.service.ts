import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { InvoiceType } from './invoices.constants';
import { renderInvoiceHtml } from './invoice-html';

const orderForInvoiceInclude = {
  orderitem: true,
  shop: {
    select: {
      name: true,
      displayName: true,
      address: true,
      email: true,
      currency: true,
    },
  },
} satisfies Prisma.orderInclude;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
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

    const existing = await this.prisma.invoice.findUnique({
      where: { orderId_type: { orderId: order.id, type: dto.type } },
    });
    if (existing) return existing;

    const subtotal = order.orderitem.reduce(
      (sum, item) => sum.add(item.priceAtPurchase.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const taxAmount = order.taxAmount ?? new Prisma.Decimal(0);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoiceNumber = await this.nextInvoiceNumber(
          tx,
          ctx.shopId,
          dto.type,
        );
        return tx.invoice.create({
          data: {
            orderId: order.id,
            shopId: ctx.shopId,
            type: dto.type,
            invoiceNumber,
            subtotal,
            taxAmount,
            total: order.total,
          },
        });
      });
    } catch (error) {
      // Lost the race to a concurrent generate for the same order+type —
      // the unique constraint on (orderId, type) is what actually enforces
      // idempotency under concurrency; this just lets the loser read back
      // what the winner created instead of erroring. Same
      // catch-P2002-and-no-op-idempotency pattern as
      // PaymentsService.handleWebhook (see that method's own comment).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const winner = await this.prisma.invoice.findUnique({
          where: { orderId_type: { orderId: order.id, type: dto.type } },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async findOne(ctx: TenantContext, id: number) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, shopId: ctx.shopId },
    });
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
    return this.prisma.invoice.findMany({
      where: { orderId, shopId: ctx.shopId },
      orderBy: { issuedAt: 'asc' },
    });
  }

  async renderHtml(ctx: TenantContext, id: number): Promise<string> {
    const invoice = await this.findOne(ctx, id);
    // Re-scoped by shopId again here, not just trusted from findOne's
    // result, since this is the one call site that reaches back into
    // `order` directly rather than staying inside the already-scoped
    // invoice row.
    const order = await this.prisma.order.findFirstOrThrow({
      where: { id: invoice.orderId, shopId: ctx.shopId },
      include: orderForInvoiceInclude,
    });
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
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId, customerId },
      include: orderForInvoiceInclude,
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { orderId_type: { orderId, type: 'INVOICE' } },
    });
    if (!invoice) {
      throw new NotFoundException(`No invoice generated for order ${orderId}`);
    }
    return this.buildHtml(invoice, order);
  }

  private buildHtml(
    invoice: {
      invoiceNumber: string;
      type: string;
      issuedAt: Date;
      subtotal: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      total: Prisma.Decimal;
      notes: string | null;
    },
    order: Prisma.orderGetPayload<{ include: typeof orderForInvoiceInclude }>,
  ): string {
    return renderInvoiceHtml({
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type as 'INVOICE' | 'PACKING_SLIP',
      issuedAt: invoice.issuedAt,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      notes: invoice.notes,
      shopName: order.shop.displayName ?? order.shop.name,
      shopAddress: order.shop.address,
      shopEmail: order.shop.email,
      currency: order.shop.currency,
      order,
    });
  }

  // Atomic per-(shop,type) sequence via MySQL's `INSERT ... ON DUPLICATE KEY
  // UPDATE ... LAST_INSERT_ID(...)` idiom — the row lock this statement
  // takes serializes concurrent callers, which a Prisma-level
  // upsert-then-read is not guaranteed to do. See invoicecounter's schema
  // comment.
  private async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
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
    await tx.$executeRaw`
      INSERT INTO invoicecounter (shopId, type, lastNumber)
      VALUES (${shopId}, ${type}, LAST_INSERT_ID(1))
      ON DUPLICATE KEY UPDATE lastNumber = LAST_INSERT_ID(lastNumber + 1)
    `;
    const rows = await tx.$queryRaw<
      { seq: bigint }[]
    >`SELECT LAST_INSERT_ID() AS seq`;
    const n = Number(rows[0].seq);
    const prefix = type === 'PACKING_SLIP' ? 'PS' : 'INV';
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }
}
