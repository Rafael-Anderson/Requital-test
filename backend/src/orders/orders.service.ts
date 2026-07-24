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
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateDeliveryFeeDto } from './dto/update-delivery-fee.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { isValidStatusTransition, OrderStatus } from './constants';

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
} satisfies Prisma.orderInclude;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(ctx: TenantContext, dto: CreateOrderDto) {
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

    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId: ctx.shopId },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more items reference a product that does not belong to this shop',
      );
    }
    const productsById = new Map(products.map((p) => [p.id, p]));

    let total = new Prisma.Decimal(0);
    const itemsData = dto.items.map((item) => {
      const product = productsById.get(item.productId)!;
      const lineTotal = product.price.mul(item.quantity);
      total = total.add(lineTotal);
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        priceAtPurchase: product.price,
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
    total = total.add(deliveryFee);

    return this.prisma.order.create({
      data: {
        shopId: ctx.shopId,
        outletId,
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
        total,
        orderitem: { create: itemsData },
      },
      include: orderInclude,
    });
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

    return this.prisma.$transaction(async (tx) => {
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
      // customer places it. This only runs for the request that won the CAS
      // above, so it can never double-decrement.
      if (order.status === 'pending' && dto.status === 'confirmed') {
        await this.adjustStockForOrder(tx, order.id, order.outletId, -1);
      }
      return tx.order.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
    });
  }

  async cancel(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot cancel an order that is already '${order.status}'`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
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
        await this.adjustStockForOrder(tx, id, order.outletId, 1);
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        });
      }

      throw new ConflictException(
        'Order status changed before this cancellation could be applied — refresh and retry',
      );
    });
  }

  private async adjustStockForOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
    outletId: number,
    direction: 1 | -1,
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
  }
}
