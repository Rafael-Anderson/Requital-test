import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { ProductsService } from '../products/products.service';
import { DiscountsService } from '../discounts/discounts.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { buildVariantLabel } from '../products/variant-generator';
import { CreateDraftOrderDto } from './dto/create-draft-order.dto';
import { UpdateDraftOrderDto } from './dto/update-draft-order.dto';

const draftOrderInclude = {
  draftorderitem: {
    include: {
      product: { select: { thumbnail: true } },
      variant: { include: { optionValue1: true, optionValue2: true, optionValue3: true } },
    },
  },
  discount: true,
  customer: { select: { id: true, name: true, phone: true } },
  outlet: { select: { id: true, name: true } },
  convertedOrder: {
    select: { id: true, status: true, paymentStatus: true, total: true, trackingToken: true },
  },
} satisfies Prisma.draftorderInclude;

type DraftOrderWithRelations = Prisma.draftorderGetPayload<{ include: typeof draftOrderInclude }>;

const draftOrderWithItemsInclude = {
  draftorderitem: true,
  discount: { select: { code: true } },
} satisfies Prisma.draftorderInclude;

type DraftOrderWithItems = Prisma.draftorderGetPayload<{ include: typeof draftOrderWithItemsInclude }>;

interface DraftItemInput {
  productId: number;
  variantId?: number;
  quantity: number;
  price?: number;
}

@Injectable()
export class DraftOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async findAll(ctx: TenantContext) {
    const drafts = await this.prisma.draftorder.findMany({
      where: { shopId: ctx.shopId },
      include: draftOrderInclude,
      orderBy: { id: 'desc' },
    });
    return drafts.map((d) => this.toResponse(d));
  }

  async findOne(ctx: TenantContext, id: number) {
    return this.toResponse(await this.findRawWithRelations(ctx, id));
  }

  async create(ctx: TenantContext, dto: CreateDraftOrderDto) {
    const outlet = await this.prisma.outlet.findFirst({ where: { id: dto.outletId, shopId: ctx.shopId } });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }

    const itemsData = await this.buildItemsData(ctx, dto.items);
    const subtotal = this.sumItems(itemsData ?? []);

    // Read-only — doesn't create a customer record for what might be an
    // abandoned draft; a real row is only ever created at conversion time,
    // via OrdersService -> CustomersService.findOrCreateForOrder.
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { shopId_phone: { shopId: ctx.shopId, phone: dto.customerPhone } },
    });

    const discountId = dto.discountCode
      ? await this.resolveDiscountOrThrow(ctx.shopId, dto.discountCode, subtotal, existingCustomer?.id)
      : undefined;

    const draft = await this.prisma.draftorder.create({
      data: {
        shopId: ctx.shopId,
        outletId: dto.outletId,
        customerId: existingCustomer?.id,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        customerAddress: dto.customerAddress,
        emirate: dto.emirate,
        area: dto.area,
        orderType: dto.orderType,
        discountId,
        notes: dto.notes,
        draftorderitem: itemsData ? { create: itemsData } : undefined,
      },
      include: draftOrderInclude,
    });
    return this.toResponse(draft);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDraftOrderDto) {
    const draft = await this.findRaw(ctx, id);
    if (draft.status !== 'OPEN') {
      throw new BadRequestException(`Cannot edit a draft order that is already '${draft.status}'`);
    }
    if (dto.outletId !== undefined) {
      const outlet = await this.prisma.outlet.findFirst({ where: { id: dto.outletId, shopId: ctx.shopId } });
      if (!outlet) {
        throw new BadRequestException('outletId is invalid for this shop');
      }
    }

    const itemsData = await this.buildItemsData(ctx, dto.items);
    let subtotal: number;
    if (itemsData) {
      subtotal = this.sumItems(itemsData);
    } else {
      const existingItems = await this.prisma.draftorderitem.findMany({ where: { draftOrderId: id } });
      subtotal = this.sumItems(existingItems);
    }

    let discountId: number | null | undefined;
    if (dto.discountCode === null) {
      discountId = null;
    } else if (dto.discountCode !== undefined) {
      const phone = dto.customerPhone ?? draft.customerPhone;
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { shopId_phone: { shopId: ctx.shopId, phone } },
      });
      discountId = await this.resolveDiscountOrThrow(ctx.shopId, dto.discountCode, subtotal, existingCustomer?.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (itemsData) {
        await tx.draftorderitem.deleteMany({ where: { draftOrderId: id } });
      }
      return tx.draftorder.update({
        where: { id },
        data: {
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
          ...(itemsData && { draftorderitem: { create: itemsData } }),
        },
        include: draftOrderInclude,
      });
    });
    return this.toResponse(updated);
  }

  async cancel(ctx: TenantContext, id: number) {
    const draft = await this.findRaw(ctx, id);
    if (draft.status === 'COMPLETED' || draft.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot cancel a draft order that is already '${draft.status}'`);
    }
    if (draft.convertedOrderId) {
      // INVOICE_SENT — a real (unpaid) order already exists; cancel it too
      // through the existing order-cancel path rather than leaving it
      // orphaned (it also restocks reserved inventory, same as any other
      // storefront-style cancellation — see OrdersService.cancel).
      await this.ordersService.cancel(ctx, draft.convertedOrderId);
    }
    await this.prisma.draftorder.update({ where: { id }, data: { status: 'CANCELLED' } });
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
      throw new BadRequestException('Add at least one item before completing this draft order');
    }

    let orderId = draft.convertedOrderId;
    if (!orderId) {
      const order = await this.convertToOrder(ctx, draft);
      orderId = order.id;
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus: 'paid' } });
    await this.prisma.draftorder.update({
      where: { id },
      data: { status: 'COMPLETED', convertedOrderId: orderId },
    });
    return this.findOne(ctx, id);
  }

  // Converts to a real (unpaid) Order immediately and generates a payment
  // link on it via the existing mechanism (PaymentsService.generateLink) —
  // no separate draft-order payment infrastructure. Actual payment
  // collection then follows the normal flow for that order; a merchant who
  // sees it get paid (or gets paid by cash instead) calls complete() to
  // finish it off, or the order can be tracked/marked paid the same way any
  // other order is.
  async sendInvoice(ctx: TenantContext, id: number) {
    const draft = await this.findRawWithItems(ctx, id);
    if (draft.status !== 'OPEN') {
      throw new BadRequestException('Only an open draft order can have an invoice sent');
    }
    if (draft.draftorderitem.length === 0) {
      throw new BadRequestException('Add at least one item before sending an invoice');
    }

    const order = await this.convertToOrder(ctx, draft);
    const paymentLink = await this.paymentsService.generateLink(ctx, order.id);
    await this.prisma.draftorder.update({
      where: { id },
      data: { status: 'INVOICE_SENT', convertedOrderId: order.id },
    });
    return { draftOrder: await this.findOne(ctx, id), paymentLink };
  }

  // Funnels into OrdersService.create — the exact same pricing/item-
  // resolution/customer/discount path a storefront or admin-entered order
  // uses (with reserveStock: true, matching storefront checkout's immediate
  // atomic stock reservation, not the deferred-to-confirm behavior a plain
  // admin-entered order gets) — so draft orders can't silently drift from
  // how every other order is built.
  private async convertToOrder(ctx: TenantContext, draft: DraftOrderWithItems) {
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
        discountCode: draft.discount?.code,
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

  private async buildItemsData(ctx: TenantContext, items: DraftItemInput[] | undefined) {
    if (!items) return undefined;
    const resolved = await this.productsService.resolveOrderItems(
      ctx.shopId,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity, variantId: i.variantId, priceOverride: i.price })),
    );
    return resolved.map(({ product, variant, quantity, price }) => ({
      productId: product.id,
      variantId: variant?.id,
      productName: product.name,
      quantity,
      price,
    }));
  }

  private sumItems(items: { price: Prisma.Decimal | number; quantity: number }[]): number {
    return items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  }

  private async resolveDiscountOrThrow(shopId: number, code: string, subtotal: number, customerId?: number) {
    const discount = await this.discountsService.resolveByCode(shopId, code);
    const result = await this.discountsService.evaluate(discount, { cartSubtotal: subtotal, customerId });
    if (!result.valid) {
      throw new BadRequestException(result.message ?? 'This discount code cannot be applied');
    }
    return result.discountId!;
  }

  private async findRaw(ctx: TenantContext, id: number) {
    const draft = await this.prisma.draftorder.findFirst({ where: { id, shopId: ctx.shopId } });
    if (!draft) {
      throw new NotFoundException(`Draft order ${id} not found`);
    }
    return draft;
  }

  private async findRawWithRelations(ctx: TenantContext, id: number) {
    const draft = await this.prisma.draftorder.findFirst({
      where: { id, shopId: ctx.shopId },
      include: draftOrderInclude,
    });
    if (!draft) {
      throw new NotFoundException(`Draft order ${id} not found`);
    }
    return draft;
  }

  private async findRawWithItems(ctx: TenantContext, id: number) {
    const draft = await this.prisma.draftorder.findFirst({
      where: { id, shopId: ctx.shopId },
      include: draftOrderWithItemsInclude,
    });
    if (!draft) {
      throw new NotFoundException(`Draft order ${id} not found`);
    }
    return draft;
  }

  private toResponse(draft: DraftOrderWithRelations) {
    const { draftorderitem, discount, ...rest } = draft;
    const items = draftorderitem.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      thumbnail: i.product.thumbnail,
      variantId: i.variantId,
      variantLabel: i.variant
        ? buildVariantLabel([i.variant.optionValue1?.value, i.variant.optionValue2?.value, i.variant.optionValue3?.value])
        : null,
      quantity: i.quantity,
      price: i.price,
    }));
    const subtotal = this.sumItems(items);
    const discountAmount = discount ? this.discountsService.computeAmount(discount, subtotal) : 0;
    const total = Math.max(0, subtotal - discountAmount);
    return {
      ...rest,
      discount: discount ? { id: discount.id, code: discount.code, type: discount.type } : null,
      items,
      subtotal,
      discountAmount,
      total,
    };
  }
}
