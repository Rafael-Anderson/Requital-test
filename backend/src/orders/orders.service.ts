import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { generateTrackingCode } from '../common/token-hash';
import { CustomersService } from '../customers/customers.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { ProductsService } from '../products/products.service';
import { DiscountsService } from '../discounts/discounts.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { BulkUpdateOrderStatusDto } from './dto/bulk-update-order-status.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OrderNotificationsService } from './order-notifications.service';
import { UpdateDeliveryFeeDto } from './dto/update-delivery-fee.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import {
  EDITABLE_ORDER_STATUSES,
  IMMEDIATE_STOCK_RESERVATION_CHANNELS,
  isValidStatusTransition,
  OrderStatus,
} from './constants';
import { computeOrderTotals } from '../public/order-pricing';

const orderInclude = {
  orderitem: true,
  // Latest payment transaction, for the Order History table's Payment Mode
  // column — same shape orderDetailInclude already fetches for the modal,
  // just also needed at list level now that History shows it per row.
  paymenttransaction: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.orderInclude;

// Richer include used only by the single-order detail endpoint (the order
// detail modal) — product thumbnails for item images and the latest payment
// transaction for payment-mode display. Kept separate from `orderInclude` so
// list/status-transition responses don't carry the extra joins.
const orderDetailInclude = {
  orderitem: { include: { product: { select: { thumbnail: true } } } },
  paymenttransaction: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  externaldelivery: true,
  // Staff-only note thread — included here (single-order detail) but never
  // in `orderInclude` above (list views) or anywhere in src/public. Newest
  // first, matching a typical activity-feed reading order.
  ordernote: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.orderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly affiliateService: AffiliateService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly auditLogService: AuditLogService,
    private readonly orderNotificationsService: OrderNotificationsService,
  ) {}

  async findAll(ctx: TenantContext, query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const searchTerm = query.search?.trim();
    const searchAsId =
      searchTerm && /^\d+$/.test(searchTerm) ? Number(searchTerm) : undefined;
    const outletId = resolveOutletFilter(ctx, query.outletId);
    const where: Prisma.orderWhereInput = {
      shopId: ctx.shopId,
      ...(outletId !== undefined && { outletId }),
      ...(query.statuses?.length
        ? { status: { in: query.statuses } }
        : query.status && { status: query.status }),
      ...((query.dateFrom || query.dateTo) && {
        createdAt: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
      ...(searchTerm && {
        OR: [
          { customerName: { contains: searchTerm } },
          { customerPhone: { contains: searchTerm } },
          ...(searchAsId !== undefined ? [{ id: searchAsId }] : []),
        ],
      }),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data: orders, page, pageSize, total };
  }

  async findOne(ctx: TenantContext, id: number) {
    const outletId = resolveOutletFilter(ctx);
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        shopId: ctx.shopId,
        ...(outletId !== undefined && { outletId }),
      },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  // Used by the GET /orders/:id endpoint (order detail modal) — same lookup
  // as findOne but with the richer include plus a computed repeat-customer
  // count, neither of which the internal status/cancel checks need.
  async findOneDetail(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    const detail = await this.prisma.order.findFirst({
      where: { id: order.id },
      include: orderDetailInclude,
    });
    // Repeat-customer count is shop-wide by design — a customer who has
    // ordered from a different branch is still a repeat customer.
    const customerOrderCount = await this.prisma.order.count({
      where: { shopId: ctx.shopId, customerPhone: order.customerPhone },
    });
    return { ...detail, customerOrderCount };
  }

  // findOne() below is the same tenant/outlet-scoped existence check every
  // other order mutation goes through — a note can't be added to an order
  // outside this shop (or, for a branch user, outside their own outlet).
  async addNote(ctx: TenantContext, orderId: number, dto: CreateOrderNoteDto) {
    await this.findOne(ctx, orderId);
    return this.prisma.ordernote.create({
      data: { orderId, authorUserId: ctx.userId, note: dto.note },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  // reserveStock: off by default (admin-entered orders defer stock
  // decrement to the confirm transition — see adjustStockForOrder below),
  // but draft-order completion needs the same immediate atomic reservation
  // storefront checkout uses (see DraftOrdersService.complete) — same
  // CAS-guarded WHERE clause as PublicService.createOrder, just gated
  // behind this flag so the default admin-entered-order path is unchanged.
  async create(ctx: TenantContext, dto: CreateOrderDto, options: { reserveStock?: boolean } = {}) {
    // Branch users are always pinned to their own outlet — any outletId in
    // the request body is ignored, not just validated, so a branch account
    // can never place an order against a different branch by spoofing this
    // field. Admins aren't scoped to one outlet, so they must pick one.
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }

    const resolvedItems = await this.productsService.resolveOrderItems(
      ctx.shopId,
      dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variantId: item.variantId,
        priceOverride: item.priceOverride,
      })),
    );

    let subtotal = new Prisma.Decimal(0);
    const itemsData = resolvedItems.map(({ product, variant, quantity, price, variantLabel }) => {
      subtotal = subtotal.add(price.mul(quantity));
      return {
        productId: product.id,
        productName: product.name,
        variantId: variant?.id,
        variantLabel: variantLabel ?? undefined,
        quantity,
        priceAtPurchase: price,
      };
    });

    // A caller-supplied fee (e.g. 0 for pickup) wins outright; otherwise
    // resolve and snapshot the shop's current default at creation time, same
    // principle as priceAtPurchase on order items — a later change to the
    // shop default must never retroactively change this order's total.
    let deliveryFee: Prisma.Decimal;
    if (dto.deliveryFee !== undefined) {
      deliveryFee = new Prisma.Decimal(dto.deliveryFee);
    } else {
      const shop = await this.prisma.shop.findUniqueOrThrow({
        where: { id: ctx.shopId },
        select: { defaultDeliveryFee: true },
      });
      deliveryFee = shop.defaultDeliveryFee;
    }

    // Resolved (not yet claimed — see redeem() inside the transaction below)
    // before the customer lookup, same "cheap read before the expensive/
    // stateful part" ordering as affiliate attribution.
    let discount: { id: number; usageLimit: number | null } | null = null;
    let discountAmount = new Prisma.Decimal(0);
    let discountCodeSnapshot: string | undefined;
    if (dto.discountCode) {
      const resolved = await this.discountsService.resolveByCode(ctx.shopId, dto.discountCode);
      const evaluated = await this.discountsService.evaluate(resolved, { cartSubtotal: Number(subtotal) });
      if (!evaluated.valid) {
        throw new BadRequestException(evaluated.message ?? 'This discount code cannot be applied');
      }
      discount = resolved!;
      discountAmount = new Prisma.Decimal(evaluated.discountAmount ?? 0);
      discountCodeSnapshot = evaluated.code;
      if (evaluated.freeShipping) {
        deliveryFee = new Prisma.Decimal(0);
      }
    }

    let total = subtotal.add(deliveryFee).sub(discountAmount);
    if (total.isNegative()) total = new Prisma.Decimal(0);

    const customer = await this.customersService.findOrCreateForOrder(ctx.shopId, {
      name: dto.customerName,
      phone: dto.customerPhone,
      email: dto.customerEmail,
    });

    const attribution = await this.affiliateService.resolveAttribution(
      ctx.shopId,
      dto.referralCode,
      Number(total),
    );

    const order = await this.prisma.$transaction(async (tx) => {
      // Ingredient consumption only fires alongside an immediate stock
      // reservation, same condition as the product-stock loop right below —
      // a deferred (non-reserveStock) admin order hasn't committed product
      // stock yet either, so consuming ingredients here would run ahead of
      // it; that case is instead covered at the pending->confirmed
      // transition (see OrdersService.adjustStockForOrder).
      let ingredientsConsumed = false;
      if (options.reserveStock) {
        for (const { product, variant, quantity } of resolvedItems) {
          if (!product.trackInventory) continue;
          const result = variant
            ? await tx.outletvariantstock.updateMany({
                where: { outletId, variantId: variant.id, stockQuantity: { gte: quantity } },
                data: { stockQuantity: { decrement: quantity } },
              })
            : await tx.outletstock.updateMany({
                where: { outletId, productId: product.id, stockQuantity: { gte: quantity } },
                data: { stockQuantity: { decrement: quantity } },
              });
          if (result.count === 0) {
            throw new ConflictException(`${product.name} is out of stock`);
          }
        }

        ingredientsConsumed = await this.productsService.consumeForOrderItems(
          tx,
          ctx.shopId,
          outletId,
          resolvedItems
            .filter(({ product }) => !product.isGiftCard)
            .map(({ product, variant, quantity }) => ({
              productId: product.id,
              variantId: variant?.id ?? null,
              quantity,
            })),
          -1,
          { throwOnInsufficientStock: true, actorUserId: ctx.userId },
        );
      }

      const created = await tx.order.create({
        data: {
          shopId: ctx.shopId,
          outletId,
          ingredientsConsumedAt: ingredientsConsumed ? new Date() : undefined,
          customerId: customer.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          customerAddress: dto.customerAddress,
          emirate: dto.emirate,
          area: dto.area,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
          deliveryTimeSlot: dto.deliveryTimeSlot,
          deliveryNotes: dto.deliveryNotes,
          receiverMessage: dto.receiverMessage,
          channel: dto.channel,
          orderType: dto.orderType,
          deliveryFee,
          discountId: discount?.id,
          discountCode: discountCodeSnapshot,
          discountAmount: discount ? discountAmount : undefined,
          total,
          trackingToken: generateTrackingCode(),
          orderitem: { create: itemsData },
        },
        include: orderInclude,
      });

      if (discount) {
        await this.discountsService.redeem(tx, discount, created.id, customer.id);
      }

      return created;
    });

    if (attribution) {
      await this.affiliateService.recordAttribution(this.prisma, ctx.shopId, order.id, attribution);
    }

    await this.orderNotificationsService.notifyOrderConfirmed(ctx.shopId, order);

    return order;
  }

  // Editable up to the point fulfillment is effectively done — matches the
  // same cutoff `cancel()` uses (delivered/cancelled are terminal states).
  async updateDeliveryFee(ctx: TenantContext, id: number, dto: UpdateDeliveryFeeDto) {
    const order = await this.findOne(ctx, id);
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot edit delivery fee for an order that is already '${order.status}'`,
      );
    }

    const subtotal = order.orderitem.reduce(
      (sum, item) => sum.add(item.priceAtPurchase.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const deliveryFee = new Prisma.Decimal(dto.deliveryFee);

    return this.prisma.order.update({
      where: { id },
      data: { deliveryFee, total: subtotal.add(deliveryFee) },
      include: orderInclude,
    });
  }

  async updateStatus(
    ctx: TenantContext,
    id: number,
    dto: UpdateOrderStatusDto,
  ) {
    // findOne already applies the outlet-override rule — a branch user
    // requesting an order outside their outlet gets a 404 here and never
    // reaches the CAS update below.
    const order = await this.findOne(ctx, id);
    if (!isValidStatusTransition(order.status as OrderStatus, dto.status)) {
      throw new BadRequestException(
        `Cannot move order from '${order.status}' to '${dto.status}'`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap on the status column, not a plain update: the
      // WHERE clause re-checks `order.status` at the moment MySQL takes the
      // row lock, so if two requests race to confirm the same order, only
      // one UPDATE can match — the loser gets count 0 instead of both
      // decrementing stock. Without this, the `order.status` read above is
      // stale by the time the write happens and the guard below is a no-op
      // under concurrency. The outletId re-check is defense in depth on top
      // of the findOne check above, not load-bearing on its own.
      const result = await tx.order.updateMany({
        where: {
          id,
          shopId: ctx.shopId,
          outletId: order.outletId,
          status: order.status,
        },
        data: { status: dto.status },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Order status changed before this update could be applied — refresh and retry',
        );
      }

      // Stock is committed at the moment an order is confirmed, not when the
      // order is created — except channels that reserve stock atomically at
      // creation time instead (see OrdersService.create's reserveStock
      // option / IMMEDIATE_STOCK_RESERVATION_CHANNELS), since those need
      // that guarantee immediately rather than waiting on merchant
      // confirmation. Decrementing again here for those would double-count.
      // This only runs for the request that won the CAS above, so the
      // deferred-reservation path can never double-decrement either.
      if (
        order.status === 'pending' &&
        dto.status === 'confirmed' &&
        !IMMEDIATE_STOCK_RESERVATION_CHANNELS.includes(order.channel ?? '')
      ) {
        await this.adjustStockForOrder(tx, ctx, order.id, order.outletId, -1, false);
      }
      return tx.order.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
    });

    await this.affiliateService.syncOrderStatus(id, { orderStatus: dto.status });
    // Covers bulkUpdateStatus() too — it's a loop over this same method, so
    // a bulk status change naturally produces one log row per order here,
    // not a separate summary call.
    await this.auditLogService.logCtx(ctx, {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      before: { status: order.status },
      after: { status: dto.status },
    });
    if (dto.status === 'out_for_delivery') {
      await this.orderNotificationsService.notifyOutForDelivery(ctx.shopId, updated);
    }
    return updated;
  }

  // Deliberately just a loop calling the exact same updateStatus() every
  // single-order status change already goes through — same CAS guard, same
  // stock/affiliate side effects, same isValidStatusTransition check (so an
  // order that can't legally make this jump is skipped, not forced) — no
  // parallel bulk-specific transition logic. Tenant/outlet scoping comes
  // for free from updateStatus's own findOne() call: an id from another
  // shop (or, for a branch user, another outlet) throws NotFoundException,
  // caught here and reported as a per-item failure, never processed.
  async bulkUpdateStatus(ctx: TenantContext, dto: BulkUpdateOrderStatusDto) {
    const results: { orderId: number; success: boolean; error?: string }[] = [];
    for (const orderId of dto.orderIds) {
      try {
        await this.updateStatus(ctx, orderId, { status: dto.status });
        results.push({ orderId, success: true });
      } catch (err) {
        results.push({
          orderId,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to update status',
        });
      }
    }
    return { results, succeeded: results.filter((r) => r.success).length };
  }

  // #9: full item-list replacement, allowed only while the order is
  // 'pending' or 'confirmed' (EDITABLE_ORDER_STATUSES — see constants.ts for
  // why 'preparing' and beyond are excluded). Reuses
  // ProductsService.resolveOrderItems for validation/pricing (same as
  // create()) and the exact CAS-guarded updateMany discipline checkout's
  // reserveStock uses for the "need more stock" direction — not a parallel
  // implementation.
  async updateItems(ctx: TenantContext, orderId: number, dto: UpdateOrderItemsDto) {
    const order = await this.findOne(ctx, orderId);
    if (!EDITABLE_ORDER_STATUSES.includes(order.status as OrderStatus)) {
      throw new BadRequestException(
        `Order items can only be edited while status is one of: ${EDITABLE_ORDER_STATUSES.join(', ')} (current: '${order.status}')`,
      );
    }

    const resolvedItems = await this.productsService.resolveOrderItems(
      ctx.shopId,
      dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variantId: item.variantId,
        priceOverride: item.priceOverride,
      })),
    );

    let newSubtotal = new Prisma.Decimal(0);
    const newItemsData = resolvedItems.map(({ product, variant, quantity, price, variantLabel }) => {
      newSubtotal = newSubtotal.add(price.mul(quantity));
      return {
        productId: product.id,
        productName: product.name,
        variantId: variant?.id,
        variantLabel: variantLabel ?? undefined,
        quantity,
        priceAtPurchase: price,
      };
    });

    // Stock is "already reserved" for this order (so a quantity change must
    // adjust it, not just be free to overwrite) whenever either: the
    // channel reserves immediately at creation (storefront/draft_order —
    // see IMMEDIATE_STOCK_RESERVATION_CHANNELS), or the order has already
    // passed the pending->confirmed decrement point. A still-pending,
    // non-immediate-channel order has decremented nothing yet, so editing
    // its items needs no stock adjustment at all — the eventual confirm
    // will decrement whatever the (now-edited) item list says.
    const stockReserved =
      IMMEDIATE_STOCK_RESERVATION_CHANNELS.includes(order.channel ?? '') || order.status === 'confirmed';

    // Re-validate an attached discount against the NEW subtotal/items
    // rather than blindly carrying the old amount over — e.g. a
    // SPECIFIC_PRODUCTS discount whose eligible product just got removed,
    // or a min-purchase threshold the new (smaller) subtotal no longer
    // clears. Dropped (not re-claimed a second time either way — usage was
    // already recorded at original order creation) rather than blocking the
    // edit outright; the caller is told via `discountDropped`.
    let discountAmount = order.discountAmount ?? new Prisma.Decimal(0);
    let discountDropped = false;
    if (order.discountId) {
      const discount = await this.discountsService.resolveById(ctx.shopId, order.discountId);
      const evaluated = await this.discountsService.evaluate(discount, {
        cartSubtotal: Number(newSubtotal),
        productIds: resolvedItems.map((i) => i.product.id),
        customerId: order.customerId ?? undefined,
      });
      if (evaluated.valid) {
        discountAmount = new Prisma.Decimal(evaluated.discountAmount ?? 0);
      } else {
        discountAmount = new Prisma.Decimal(0);
        discountDropped = true;
      }
    }

    // Tax and total are recomputed from the new subtotal via the same
    // computeOrderTotals() checkout uses — not "never retroactively
    // change" like deliveryFee's own snapshot: the subtotal itself just
    // materially changed because of this edit, so the tax on it must track
    // that, or the order's numbers stop adding up. deliveryFee is left
    // exactly as it was (it doesn't depend on items in this app's model).
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: ctx.shopId },
      select: { taxRate: true, taxInclusive: true },
    });
    const deliveryFee = order.deliveryFee ?? new Prisma.Decimal(0);
    const { taxAmount, total: totalBeforeDiscount } = computeOrderTotals({
      subtotal: Number(newSubtotal),
      deliveryFee: Number(deliveryFee),
      taxRate: Number(shop.taxRate),
      taxInclusive: shop.taxInclusive,
    });
    let total = new Prisma.Decimal(totalBeforeDiscount).sub(discountAmount);
    if (total.isNegative()) total = new Prisma.Decimal(0);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (stockReserved) {
        const oldItems = await tx.orderitem.findMany({ where: { orderId } });
        const key = (productId: number, variantId: number | null) => `${productId}:${variantId ?? ''}`;
        const oldQtyByKey = new Map(oldItems.map((i) => [key(i.productId, i.variantId), i.quantity]));
        const newQtyByKey = new Map(
          resolvedItems.map((i) => [key(i.product.id, i.variant?.id ?? null), i.quantity]),
        );
        const productTrackInventory = new Map(resolvedItems.map((i) => [i.product.id, i.product.trackInventory]));
        const allKeys = new Set([...oldQtyByKey.keys(), ...newQtyByKey.keys()]);

        for (const k of allKeys) {
          const [productIdStr, variantIdStr] = k.split(':');
          const productId = Number(productIdStr);
          const variantId = variantIdStr ? Number(variantIdStr) : null;
          const delta = (newQtyByKey.get(k) ?? 0) - (oldQtyByKey.get(k) ?? 0);
          if (delta === 0) continue;

          const trackInventory =
            productTrackInventory.get(productId) ??
            (await tx.product.findUnique({ where: { id: productId }, select: { trackInventory: true } }))
              ?.trackInventory ??
            false;
          if (!trackInventory) continue;

          if (delta > 0) {
            const result = variantId
              ? await tx.outletvariantstock.updateMany({
                  where: { outletId: order.outletId, variantId, stockQuantity: { gte: delta } },
                  data: { stockQuantity: { decrement: delta } },
                })
              : await tx.outletstock.updateMany({
                  where: { outletId: order.outletId, productId, stockQuantity: { gte: delta } },
                  data: { stockQuantity: { decrement: delta } },
                });
            if (result.count === 0) {
              throw new ConflictException('Not enough stock available to increase this item’s quantity');
            }
          } else if (variantId) {
            await tx.outletvariantstock.upsert({
              where: { outletId_variantId: { outletId: order.outletId, variantId } },
              update: { stockQuantity: { increment: -delta } },
              create: { outletId: order.outletId, variantId, stockQuantity: -delta },
            });
          } else {
            await tx.outletstock.upsert({
              where: { outletId_productId: { outletId: order.outletId, productId } },
              update: { stockQuantity: { increment: -delta } },
              create: { outletId: order.outletId, productId, stockQuantity: -delta },
            });
          }
        }
      }

      await tx.orderitem.deleteMany({ where: { orderId } });
      await tx.orderitem.createMany({ data: newItemsData.map((d) => ({ ...d, orderId })) });

      return tx.order.update({
        where: { id: orderId },
        data: {
          total,
          taxAmount: new Prisma.Decimal(taxAmount),
          discountAmount,
          ...(discountDropped && { discountId: null, discountCode: null }),
        },
        include: orderInclude,
      });
    });

    await this.auditLogService.logCtx(ctx, {
      action: 'order.items_edited',
      entityType: 'order',
      entityId: orderId,
      before: { total: order.total.toString(), itemCount: order.orderitem.length },
      after: { total: total.toString(), itemCount: newItemsData.length },
      metadata: discountDropped ? { discountDropped: true } : undefined,
    });

    return { ...updated, discountDropped };
  }

  async cancel(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot cancel an order that is already '${order.status}'`,
      );
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Two CAS attempts instead of "read status, then decide" — that read
      // is stale by the time we write under concurrency (e.g. a confirm and
      // a cancel racing the same order), and the wrong branch would either
      // skip a needed restock or double-restock. Whichever CAS actually
      // matches the row's current status at lock time is authoritative.
      const fromPending = await tx.order.updateMany({
        where: {
          id,
          shopId: ctx.shopId,
          outletId: order.outletId,
          status: 'pending',
        },
        data: { status: 'cancelled' },
      });
      if (fromPending.count === 1) {
        // An order from an immediate-reservation channel already reserved
        // stock at creation (decremented while still 'pending', not at
        // confirm — see updateStatus above) — cancelling from 'pending' must
        // restock it here, unlike the deferred-reservation path where
        // nothing was ever decremented yet at this stage.
        if (IMMEDIATE_STOCK_RESERVATION_CHANNELS.includes(order.channel ?? '')) {
          await this.adjustStockForOrder(tx, ctx, id, order.outletId, 1, order.ingredientsConsumedAt !== null);
        }
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        });
      }

      const fromStockDecremented = await tx.order.updateMany({
        where: {
          id,
          shopId: ctx.shopId,
          outletId: order.outletId,
          status: { in: ['confirmed', 'preparing', 'out_for_delivery'] },
        },
        data: { status: 'cancelled' },
      });
      if (fromStockDecremented.count === 1) {
        await this.adjustStockForOrder(tx, ctx, id, order.outletId, 1, order.ingredientsConsumedAt !== null);
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        });
      }

      throw new ConflictException(
        'Order status changed before this cancellation could be applied — refresh and retry',
      );
    });

    await this.affiliateService.syncOrderStatus(id, { orderStatus: 'cancelled' });
    return cancelled;
  }

  // ingredientsAlreadyConsumed only matters for direction 1 (restock): the
  // pre-transaction-read order.ingredientsConsumedAt !== null, telling this
  // call whether Bill of Materials ingredients were actually deducted for
  // this specific order — never re-derived from the *current* value of
  // shop.autoDeductIngredientStock, which may have changed since (see
  // order.ingredientsConsumedAt's own schema comment). Safe to trust despite
  // being read before this method's own transaction: confirm and cancel are
  // both CAS-guarded on `status`, so at most one of them can ever be the
  // request that actually wins the race on a given order — the value can't
  // have gone stale under the concurrent case that would matter here, same
  // trust already placed in order.channel/order.outletId throughout this file.
  private async adjustStockForOrder(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    orderId: number,
    outletId: number,
    direction: 1 | -1,
    ingredientsAlreadyConsumed: boolean,
  ) {
    const items = await tx.orderitem.findMany({
      where: { orderId },
      include: { product: { select: { trackInventory: true } } },
    });
    for (const item of items) {
      if (!item.product.trackInventory) continue;
      // Stock is per-outlet-per-product now, not shop-wide — upsert because
      // a product may never have had an explicit stock row created for this
      // outlet yet (e.g. added to the catalog after the outlet was set up).
      // A variant-bearing item adjusts its own outletvariantstock row
      // instead (see schema.prisma) — the parent product's outletstock
      // stays untouched once a product has variants.
      if (item.variantId) {
        await tx.outletvariantstock.upsert({
          where: { outletId_variantId: { outletId, variantId: item.variantId } },
          update: { stockQuantity: { increment: direction * item.quantity } },
          create: {
            outletId,
            variantId: item.variantId,
            stockQuantity: direction * item.quantity,
          },
        });
        continue;
      }
      await tx.outletstock.upsert({
        where: { outletId_productId: { outletId, productId: item.productId } },
        update: { stockQuantity: { increment: direction * item.quantity } },
        create: {
          outletId,
          productId: item.productId,
          stockQuantity: direction * item.quantity,
        },
      });
    }

    // Bill of Materials — same trigger point as the product-stock loop just
    // above, direction for direction: the pending->confirmed decrement
    // (direction -1) and every cancel-restock (direction 1, but only when
    // this specific order actually consumed ingredients in the first place).
    if (direction === -1) {
      const consumed = await this.productsService.consumeForOrderItems(
        tx,
        ctx.shopId,
        outletId,
        items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity })),
        -1,
        { throwOnInsufficientStock: false, actorUserId: ctx.userId },
      );
      if (consumed) {
        await tx.order.update({ where: { id: orderId }, data: { ingredientsConsumedAt: new Date() } });
      }
    } else if (ingredientsAlreadyConsumed) {
      await this.productsService.consumeForOrderItems(
        tx,
        ctx.shopId,
        outletId,
        items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity })),
        1,
        { throwOnInsufficientStock: false, actorUserId: ctx.userId },
      );
    }
  }
}
