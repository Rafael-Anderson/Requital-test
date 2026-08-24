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
import { trimDecimal } from '../database/decimal.util';
import type { OrderRow, OrderitemRow } from '../db/types';
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
import { createLogger } from '../common/logging/logger';

const logger = createLogger('OrdersService');
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
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { NotifySubscriptionsService } from '../notify-subscriptions/notify-subscriptions.service';

interface AssembledOrderItem extends OrderitemRow {
  product?: { thumbnail: string };
}

interface AssembledOrder extends OrderRow {
  orderitem: AssembledOrderItem[];
  paymenttransaction: RowDataPacket[];
  cashCollectedByName: string | null;
}

export interface AssembledOrderNote {
  id: number;
  orderId: number;
  authorUserId: number;
  note: string;
  createdAt: Date;
  author: { id: number; name: string };
}

interface AssembledOrderDetail extends AssembledOrder {
  externaldelivery: RowDataPacket | null;
  ordernote: AssembledOrderNote[];
  surveyresponse: RowDataPacket | null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly customersService: CustomersService,
    private readonly affiliateService: AffiliateService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly auditLogService: AuditLogService,
    private readonly orderNotificationsService: OrderNotificationsService,
    private readonly branchRolesService: BranchRolesService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
  ) {}

  async findAll(ctx: TenantContext, query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const searchTerm = query.search?.trim();
    const searchAsId =
      searchTerm && /^\d+$/.test(searchTerm) ? Number(searchTerm) : undefined;
    const outletId = resolveOutletFilter(ctx, query.outletId);
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'orders.view',
      );
    }

    const conditions = ['o.shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('o.outletId = ?');
      params.push(outletId);
    }
    if (query.statuses?.length) {
      conditions.push(`o.status IN (${query.statuses.map(() => '?').join(', ')})`);
      params.push(...query.statuses);
    } else if (query.status) {
      conditions.push('o.status = ?');
      params.push(query.status);
    }
    if (query.dateFrom) {
      conditions.push('o.createdAt >= ?');
      params.push(new Date(query.dateFrom));
    }
    if (query.dateTo) {
      conditions.push('o.createdAt <= ?');
      params.push(new Date(query.dateTo));
    }
    if (searchTerm) {
      const orParts = ['o.customerName LIKE ?', 'o.customerPhone LIKE ?'];
      const orParams: QueryParam[] = [`%${searchTerm}%`, `%${searchTerm}%`];
      if (searchAsId !== undefined) {
        orParts.push('o.id = ?');
        orParams.push(searchAsId);
      }
      conditions.push(`(${orParts.join(' OR ')})`);
      params.push(...orParams);
    }
    const where = conditions.join(' AND ');

    const [idRows, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT o.id FROM \`order\` o WHERE ${where}
         ORDER BY o.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` o WHERE ${where}`,
        params,
      ),
    ]);
    const ids = idRows.map((r) => r.id as number);
    const orders = await this.loadOrdersWithRelations(ids);

    return {
      data: ids.map((id) => this.toResponse(orders.get(id)!)),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  // The single shared "load + tenant/outlet scope check" every read and
  // write endpoint below goes through — orders.view is checked here, once,
  // for every caller. Uses the fetched order's own outletId, not the
  // pre-fetch filter variable: for an admin, the filter is undefined (no
  // WHERE clause restriction), but the order itself always belongs to one
  // real outlet, and a restrictive override at that specific outlet must
  // still apply. Write endpoints (updateStatus, cancel, etc.) additionally
  // check 'orders.manage' themselves after calling this — a bundle that
  // grants manage without view would still be rejected here first, which
  // is intentional: you can't manage what you can't view.
  async findOne(ctx: TenantContext, id: number) {
    const outletId = resolveOutletFilter(ctx);
    const conditions = ['id = ?', 'shopId = ?'];
    const params: QueryParam[] = [id, ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    const ownRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM \`order\` WHERE ${conditions.join(' AND ')}`,
      params,
    );
    if (ownRows.length === 0) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const orders = await this.loadOrdersWithRelations([id]);
    const order = orders.get(id)!;
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.view',
    );
    return this.toResponse(order);
  }

  // Used by the GET /orders/:id endpoint (order detail modal) — same lookup
  // as findOne but with the richer include plus a computed repeat-customer
  // count, neither of which the internal status/cancel checks need.
  async findOneDetail(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    const details = await this.loadOrderDetailWithRelations(order.id);
    // Repeat-customer count is shop-wide by design — a customer who has
    // ordered from a different branch is still a repeat customer.
    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`order\` WHERE shopId = ? AND customerPhone = ?`,
      [ctx.shopId, order.customerPhone],
    );
    return {
      ...this.toDetailResponse(details),
      customerOrderCount: Number(countRows[0].c),
    };
  }

  // findOne() below is the same tenant/outlet-scoped existence check every
  // other order mutation goes through — a note can't be added to an order
  // outside this shop (or, for a branch user, outside their own outlet).
  async addNote(ctx: TenantContext, orderId: number, dto: CreateOrderNoteDto) {
    const order = await this.findOne(ctx, orderId);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    const result = await this.db.execute(
      `INSERT INTO ordernote (orderId, authorUserId, note) VALUES (?, ?, ?)`,
      [orderId, ctx.userId, dto.note],
    );
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT on1.*, u.id AS authorId, u.name AS authorName
       FROM ordernote on1 JOIN user u ON u.id = on1.authorUserId
       WHERE on1.id = ?`,
      [result.insertId],
    );
    const row = rows[0];
    return {
      id: row.id as number,
      orderId: row.orderId as number,
      authorUserId: row.authorUserId as number,
      note: row.note as string,
      createdAt: row.createdAt as Date,
      author: { id: row.authorId as number, name: row.authorName as string },
    };
  }

  // reserveStock: off by default (admin-entered orders defer stock
  // decrement to the confirm transition — see adjustStockForOrder below),
  // but draft-order completion needs the same immediate atomic reservation
  // storefront checkout uses (see DraftOrdersService.complete) — same
  // CAS-guarded WHERE clause as PublicService.createOrder, just gated
  // behind this flag so the default admin-entered-order path is unchanged.
  async create(
    ctx: TenantContext,
    dto: CreateOrderDto,
    options: { reserveStock?: boolean } = {},
  ) {
    // Branch users are always pinned to their own outlet — any outletId in
    // the request body is ignored, not just validated, so a branch account
    // can never place an order against a different branch by spoofing this
    // field. Admins aren't scoped to one outlet, so they must pick one.
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'orders.manage',
    );

    const resolvedItems = await this.productsService.resolveOrderItems(
      ctx.shopId,
      dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variantId: item.variantId,
        priceOverride: item.priceOverride,
      })),
    );

    let subtotal = 0;
    const itemsData = resolvedItems.map(
      ({ product, variant, quantity, price, autoDiscountAmount, variantLabel }) => {
        subtotal += Number(price) * quantity;
        return {
          productId: product.id as number,
          productName: product.name as string,
          variantId: variant?.id ?? null,
          variantLabel: variantLabel ?? null,
          quantity,
          priceAtPurchase: price,
          autoDiscountAmount,
        };
      },
    );

    // A caller-supplied fee (e.g. 0 for pickup) wins outright; otherwise
    // resolve and snapshot the shop's current default at creation time, same
    // principle as priceAtPurchase on order items — a later change to the
    // shop default must never retroactively change this order's total.
    let deliveryFee: number;
    if (dto.deliveryFee !== undefined) {
      deliveryFee = dto.deliveryFee;
    } else {
      const shopRows = await this.db.query<RowDataPacket[]>(
        `SELECT defaultDeliveryFee FROM shop WHERE id = ?`,
        [ctx.shopId],
      );
      deliveryFee = Number(shopRows[0]?.defaultDeliveryFee ?? 0);
    }

    // Resolved (not yet claimed — see redeem() inside the transaction below)
    // before the customer lookup, same "cheap read before the expensive/
    // stateful part" ordering as affiliate attribution.
    let discount: { id: number; usageLimit: number | null } | null = null;
    let discountAmount = 0;
    let discountCodeSnapshot: string | undefined;
    if (dto.discountCode) {
      const resolved = await this.discountsService.resolveByCode(
        ctx.shopId,
        dto.discountCode,
      );
      const evaluated = await this.discountsService.evaluate(resolved, {
        cartSubtotal: subtotal,
      });
      if (!evaluated.valid) {
        throw new BadRequestException(
          evaluated.message ?? 'This discount code cannot be applied',
        );
      }
      discount = resolved!;
      discountAmount = evaluated.discountAmount ?? 0;
      discountCodeSnapshot = evaluated.code;
      if (evaluated.freeShipping) {
        deliveryFee = 0;
      }
    }

    let total = subtotal + deliveryFee - discountAmount;
    if (total < 0) total = 0;

    const customer = await this.customersService.findOrCreateForOrder(
      ctx.shopId,
      {
        name: dto.customerName,
        phone: dto.customerPhone,
        email: dto.customerEmail,
      },
    );

    const attribution = await this.affiliateService.resolveAttribution(
      ctx.shopId,
      dto.referralCode,
      total,
    );

    const orderId = await this.db.transaction(async (conn) => {
      // Stock reservation only fires alongside an immediate reservation
      // (reserveStock) — a deferred (non-reserveStock) admin order hasn't
      // committed stock yet either; that case is instead covered at the
      // pending->confirmed transition (see OrdersService.adjustStockForOrder).
      // Every product/variant resolves through consumeForOrderItems now
      // (Phase A) — a usesIngredients:false product's own shadow ingredient
      // mirrors its trackInventory flag, so the per-row skip inside
      // consumeForOrderItems already reproduces the old
      // `if (!product.trackInventory) continue` behavior without a
      // redundant filter here.
      let ingredientsConsumed = false;
      if (options.reserveStock) {
        ingredientsConsumed = await this.productsService.consumeForOrderItems(
          conn,
          ctx.shopId,
          outletId,
          resolvedItems
            .filter(({ product }) => !product.isGiftCard)
            .map(({ product, variant, quantity, allowNegative }) => ({
              productId: product.id as number,
              variantId: variant?.id ?? null,
              quantity,
              allowNegative,
            })),
          -1,
          { throwOnInsufficientStock: true, actorUserId: ctx.userId },
        );
      }

      const trackingToken = generateTrackingCode();
      const [result] = await conn.query(
        `INSERT INTO \`order\` (
          shopId, outletId, ingredientsConsumedAt, customerId, customerName, customerPhone, customerEmail,
          customerAddress, emirate, area, deliveryDate, deliveryTimeSlot, deliveryNotes, receiverMessage,
          channel, orderType, deliveryFee, discountId, discountCode, discountAmount, total, trackingToken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          outletId,
          ingredientsConsumed ? new Date() : null,
          customer.id,
          dto.customerName,
          dto.customerPhone,
          dto.customerEmail ?? null,
          dto.customerAddress,
          dto.emirate,
          dto.area ?? null,
          dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          dto.deliveryTimeSlot ?? null,
          dto.deliveryNotes ?? null,
          dto.receiverMessage ?? null,
          dto.channel ?? null,
          dto.orderType ?? null,
          deliveryFee,
          discount?.id ?? null,
          discountCodeSnapshot ?? null,
          discount ? discountAmount : null,
          total,
          trackingToken,
        ],
      );
      const newOrderId = (result as { insertId: number }).insertId;

      if (itemsData.length > 0) {
        const placeholders = itemsData.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO orderitem (orderId, productId, productName, variantId, variantLabel, quantity, priceAtPurchase, autoDiscountAmount)
           VALUES ${placeholders}`,
          itemsData.flatMap((d) => [
            newOrderId,
            d.productId,
            d.productName,
            d.variantId,
            d.variantLabel,
            d.quantity,
            d.priceAtPurchase,
            d.autoDiscountAmount,
          ]),
        );
      }

      if (discount) {
        await this.discountsService.redeem(conn, discount, newOrderId, customer.id);
      }

      return newOrderId;
    });

    if (attribution) {
      await this.affiliateService.recordAttribution(
        this.db.pool,
        ctx.shopId,
        orderId,
        attribution,
      );
    }

    const orders = await this.loadOrdersWithRelations([orderId]);
    const order = this.toResponse(orders.get(orderId)!);

    // Not awaited, deliberately — see the matching comment on the storefront
    // checkout path (PublicService.createOrder) for why: a slow or down
    // email/WhatsApp provider must never delay or fail an already-committed
    // order.
    this.orderNotificationsService
      .notifyOrderConfirmed(ctx.shopId, order)
      .catch((err: unknown) => {
        logger.error(`order #${order.id}: notifyOrderConfirmed failed`, {
          orderId: order.id,
          shopId: ctx.shopId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return order;
  }

  // Editable up to the point fulfillment is effectively done — matches the
  // same cutoff `cancel()` uses (delivered/cancelled are terminal states).
  async updateDeliveryFee(
    ctx: TenantContext,
    id: number,
    dto: UpdateDeliveryFeeDto,
  ) {
    const order = await this.findOne(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot edit delivery fee for an order that is already '${order.status}'`,
      );
    }

    const subtotal = order.orderitem.reduce(
      (sum: number, item: AssembledOrderItem) =>
        sum + Number(item.priceAtPurchase) * item.quantity,
      0,
    );
    const total = subtotal + dto.deliveryFee;

    await this.db.execute(`UPDATE \`order\` SET deliveryFee = ?, total = ? WHERE id = ?`, [
      dto.deliveryFee,
      total,
      id,
    ]);
    const orders = await this.loadOrdersWithRelations([id]);
    return this.toResponse(orders.get(id)!);
  }

  // Marks a cash-on-delivery order's cash as collected — the completion
  // gate in updateStatus below refuses to move the order to 'delivered'
  // until this has been called. Idempotent (a double-click just returns the
  // already-collected state) and a plain UPDATE, not CAS — this isn't a
  // field competing writers race over, unlike order.status.
  async collectCash(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    if (order.paymentMethod !== 'cash_on_delivery') {
      throw new BadRequestException(
        'Cash collection only applies to cash-on-delivery orders',
      );
    }
    if (order.cashCollectedAt === null) {
      await this.db.execute(
        `UPDATE \`order\` SET cashCollectedAt = NOW(3), cashCollectedBy = ? WHERE id = ? AND shopId = ?`,
        [ctx.userId, id, ctx.shopId],
      );
    }
    const orders = await this.loadOrdersWithRelations([id]);
    return this.toResponse(orders.get(id)!);
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
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    if (!isValidStatusTransition(order.status as OrderStatus, dto.status)) {
      throw new BadRequestException(
        `Cannot move order from '${order.status}' to '${dto.status}'`,
      );
    }
    // Plain pre-check, not folded into the CAS WHERE clause below — the CAS
    // failure path throws a generic "refresh and retry" ConflictException,
    // which would be a misleading message for "you forgot to collect cash."
    if (
      dto.status === 'delivered' &&
      order.paymentMethod === 'cash_on_delivery' &&
      order.cashCollectedAt === null
    ) {
      throw new BadRequestException(
        'Mark cash as collected before moving this order to delivered',
      );
    }

    await this.db.transaction(async (conn) => {
      // Compare-and-swap on the status column, not a plain update: the
      // WHERE clause re-checks `order.status` at the moment MySQL takes the
      // row lock, so if two requests race to confirm the same order, only
      // one UPDATE can match — the loser gets affectedRows 0 instead of
      // both decrementing stock. Without this, the `order.status` read
      // above is stale by the time the write happens and the guard below is
      // a no-op under concurrency. The outletId re-check is defense in
      // depth on top of the findOne check above, not load-bearing on its own.
      const [result] = await conn.query(
        `UPDATE \`order\` SET status = ? WHERE id = ? AND shopId = ? AND outletId = ? AND status = ?`,
        [dto.status, id, ctx.shopId, order.outletId, order.status],
      );
      if ((result as { affectedRows: number }).affectedRows === 0) {
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
        await this.adjustStockForOrder(
          conn,
          ctx,
          order.id,
          order.outletId,
          -1,
          false,
        );
      }
    });
    const orders = await this.loadOrdersWithRelations([id]);
    const updated = this.toResponse(orders.get(id)!);

    await this.affiliateService.syncOrderStatus(id, {
      orderStatus: dto.status,
    });
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
    // Not awaited, deliberately — same reasoning as notifyOrderConfirmed's
    // call sites above: a slow or down email/WhatsApp provider must never
    // delay or fail an already-committed status change.
    if (dto.status === 'out_for_delivery') {
      this.orderNotificationsService
        .notifyOutForDelivery(ctx.shopId, updated)
        .catch((err: unknown) => {
          logger.error(`order #${id}: notifyOutForDelivery failed`, {
            orderId: id,
            shopId: ctx.shopId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
    if (dto.status === 'delivered') {
      this.orderNotificationsService
        .notifySurveyRequest(ctx.shopId, updated)
        .catch((err: unknown) => {
          logger.error(`order #${id}: notifySurveyRequest failed`, {
            orderId: id,
            shopId: ctx.shopId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
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
  // create()) and the exact CAS-guarded UPDATE discipline checkout's
  // reserveStock uses for the "need more stock" direction — not a parallel
  // implementation.
  async updateItems(
    ctx: TenantContext,
    orderId: number,
    dto: UpdateOrderItemsDto,
  ) {
    const order = await this.findOne(ctx, orderId);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
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

    let newSubtotal = 0;
    const newItemsData = resolvedItems.map(
      ({ product, variant, quantity, price, autoDiscountAmount, variantLabel }) => {
        newSubtotal += Number(price) * quantity;
        return {
          productId: product.id as number,
          productName: product.name as string,
          variantId: variant?.id ?? null,
          variantLabel: variantLabel ?? null,
          quantity,
          priceAtPurchase: price,
          autoDiscountAmount,
        };
      },
    );

    // Stock is "already reserved" for this order (so a quantity change must
    // adjust it, not just be free to overwrite) whenever either: the
    // channel reserves immediately at creation (storefront/draft_order —
    // see IMMEDIATE_STOCK_RESERVATION_CHANNELS), or the order has already
    // passed the pending->confirmed decrement point. A still-pending,
    // non-immediate-channel order has decremented nothing yet, so editing
    // its items needs no stock adjustment at all — the eventual confirm
    // will decrement whatever the (now-edited) item list says.
    const stockReserved =
      IMMEDIATE_STOCK_RESERVATION_CHANNELS.includes(order.channel ?? '') ||
      order.status === 'confirmed';

    // Re-validate an attached discount against the NEW subtotal/items
    // rather than blindly carrying the old amount over — e.g. a
    // SPECIFIC_PRODUCTS discount whose eligible product just got removed,
    // or a min-purchase threshold the new (smaller) subtotal no longer
    // clears. Dropped (not re-claimed a second time either way — usage was
    // already recorded at original order creation) rather than blocking the
    // edit outright; the caller is told via `discountDropped`.
    let discountAmount = Number(order.discountAmount ?? 0);
    let discountDropped = false;
    if (order.discountId) {
      const discount = await this.discountsService.resolveById(
        ctx.shopId,
        order.discountId,
      );
      const evaluated = await this.discountsService.evaluate(discount, {
        cartSubtotal: newSubtotal,
        productIds: resolvedItems.map((i) => i.product.id as number),
        customerId: order.customerId ?? undefined,
      });
      if (evaluated.valid) {
        discountAmount = evaluated.discountAmount ?? 0;
      } else {
        discountAmount = 0;
        discountDropped = true;
      }
    }

    // Tax and total are recomputed from the new subtotal via the same
    // computeOrderTotals() checkout uses — not "never retroactively
    // change" like deliveryFee's own snapshot: the subtotal itself just
    // materially changed because of this edit, so the tax on it must track
    // that, or the order's numbers stop adding up. deliveryFee is left
    // exactly as it was (it doesn't depend on items in this app's model).
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT taxRate, taxInclusive FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const shop = shopRows[0];
    const deliveryFee = Number(order.deliveryFee ?? 0);
    const { taxAmount, total: totalBeforeDiscount } = computeOrderTotals({
      subtotal: newSubtotal,
      deliveryFee,
      taxRate: Number(shop.taxRate),
      taxInclusive: Boolean(shop.taxInclusive),
    });
    let total = totalBeforeDiscount - discountAmount;
    if (total < 0) total = 0;

    let ingredientStockWarnings: string[] = [];
    await this.db.transaction(async (conn) => {
      if (stockReserved) {
        const [oldItems] = await conn.query<RowDataPacket[]>(
          `SELECT productId, variantId, quantity FROM orderitem WHERE orderId = ?`,
          [orderId],
        );
        const key = (productId: number, variantId: number | null) =>
          `${productId}:${variantId ?? ''}`;
        const oldQtyByKey = new Map(
          oldItems.map((i) => [
            key(i.productId as number, i.variantId as number | null),
            i.quantity as number,
          ]),
        );
        const newQtyByKey = new Map(
          resolvedItems.map((i) => [
            key(i.product.id as number, i.variant?.id ?? null),
            i.quantity,
          ]),
        );
        const allKeys = new Set([...oldQtyByKey.keys(), ...newQtyByKey.keys()]);

        // Stock delta adjustment (Phase A: shadow or real recipe — every
        // product/variant resolves through consumeForOrderItems now, so
        // there's no separate product-stock-vs-BOM-ingredient carve-out
        // anymore) — only for an order that's actually reached 'confirmed'
        // and already consumed ingredients once (see
        // order.ingredientsConsumedAt). A still-pending order (even one
        // whose stock is already reserved via
        // IMMEDIATE_STOCK_RESERVATION_CHANNELS) has never run
        // consumeForOrderItems yet — that only happens at the
        // pending->confirmed transition, see adjustStockForOrder — so it has
        // nothing to adjust by delta here; the eventual confirm will consume
        // stock for whatever the (now-edited) item list says.
        // Adjusted by delta (not recomputed from scratch) to avoid
        // double-deducting what confirm already took.
        if (
          order.status === 'confirmed' &&
          order.ingredientsConsumedAt !== null
        ) {
          // A usesIngredients:true product's recipe consumption must never
          // block the save (going negative is surfaced as a warning
          // instead, see findNegativeIngredientStock below) — the
          // long-established BOM behavior. A usesIngredients:false
          // product's own shadow-ingredient stock instead keeps the old
          // direct-product-stock semantics: a quantity increase beyond
          // available stock is rejected outright (409), same as every
          // other stock-reservation point in this file. This is exactly
          // what consumeForOrderItems's per-item allowNegative flag is
          // for — sourced here from each resolved item's product, not the
          // continueSellingOutOfStock-based rule resolveOrderItems uses for
          // order creation (order-item-edit never had that escape valve).
          const usesIngredientsByProduct = new Map(
            resolvedItems.map((i) => [
              i.product.id as number,
              i.product.usesIngredients as boolean,
            ]),
          );
          const increasedItems: {
            productId: number;
            variantId: number | null;
            quantity: number;
            allowNegative: boolean;
          }[] = [];
          const decreasedItems: {
            productId: number;
            variantId: number | null;
            quantity: number;
          }[] = [];
          for (const k of allKeys) {
            const [productIdStr, variantIdStr] = k.split(':');
            const productId = Number(productIdStr);
            const variantId = variantIdStr ? Number(variantIdStr) : null;
            const delta = (newQtyByKey.get(k) ?? 0) - (oldQtyByKey.get(k) ?? 0);
            if (delta > 0)
              increasedItems.push({
                productId,
                variantId,
                quantity: delta,
                allowNegative: usesIngredientsByProduct.get(productId) ?? false,
              });
            else if (delta < 0)
              decreasedItems.push({ productId, variantId, quantity: -delta });
          }

          if (increasedItems.length > 0) {
            await this.productsService.consumeForOrderItems(
              conn,
              ctx.shopId,
              order.outletId,
              increasedItems,
              -1,
              { throwOnInsufficientStock: true, actorUserId: ctx.userId },
            );
            ingredientStockWarnings = await this.findNegativeIngredientStock(
              conn,
              order.outletId,
              increasedItems.map((i) => i.productId),
            );
          }
          if (decreasedItems.length > 0) {
            await this.productsService.consumeForOrderItems(
              conn,
              ctx.shopId,
              order.outletId,
              decreasedItems,
              1,
              { throwOnInsufficientStock: false, actorUserId: ctx.userId },
            );
          }
        }
      }

      await conn.query(`DELETE FROM orderitem WHERE orderId = ?`, [orderId]);
      if (newItemsData.length > 0) {
        const placeholders = newItemsData.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO orderitem (orderId, productId, productName, variantId, variantLabel, quantity, priceAtPurchase, autoDiscountAmount)
           VALUES ${placeholders}`,
          newItemsData.flatMap((d) => [
            orderId,
            d.productId,
            d.productName,
            d.variantId,
            d.variantLabel,
            d.quantity,
            d.priceAtPurchase,
            d.autoDiscountAmount,
          ]),
        );
      }

      const set = buildSetClause({
        total,
        taxAmount,
        discountAmount,
        ...(discountDropped && { discountId: null, discountCode: null }),
      });
      await conn.query(`UPDATE \`order\` SET ${set!.setClause} WHERE id = ?`, [
        ...set!.params,
        orderId,
      ]);
    });

    const orders = await this.loadOrdersWithRelations([orderId]);
    const updated = this.toResponse(orders.get(orderId)!);

    await this.auditLogService.logCtx(ctx, {
      action: 'order.items_edited',
      entityType: 'order',
      entityId: orderId,
      before: {
        total: order.total,
        itemCount: order.orderitem.length,
      },
      after: { total: String(total), itemCount: newItemsData.length },
      metadata: discountDropped ? { discountDropped: true } : undefined,
    });

    return { ...updated, discountDropped, ingredientStockWarnings };
  }

  // Ingredients whose stock is negative at this outlet, restricted to the
  // recipe ingredients of the given products — called right after an
  // increase-direction consumeForOrderItems (throwOnInsufficientStock:
  // false, so it never blocks) to build the merchant-facing warning list.
  private async findNegativeIngredientStock(
    conn: PoolConnection,
    outletId: number,
    productIds: number[],
  ): Promise<string[]> {
    const [recipeRows] = await conn.query<RowDataPacket[]>(
      `SELECT DISTINCT ingredientId FROM productingredient WHERE productId IN (${productIds.map(() => '?').join(', ')})`,
      productIds,
    );
    const ingredientIds = recipeRows.map((r) => r.ingredientId as number);
    if (ingredientIds.length === 0) return [];
    const [negative] = await conn.query<RowDataPacket[]>(
      `SELECT ing.name AS name FROM outletingredientstock ois
       JOIN ingredient ing ON ing.id = ois.ingredientId
       WHERE ois.outletId = ? AND ois.ingredientId IN (${ingredientIds.map(() => '?').join(', ')}) AND ois.stockQuantity < 0`,
      [outletId, ...ingredientIds],
    );
    return negative.map((r) => r.name as string);
  }

  async cancel(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot cancel an order that is already '${order.status}'`,
      );
    }

    await this.db.transaction(async (conn) => {
      // Two CAS attempts instead of "read status, then decide" — that read
      // is stale by the time we write under concurrency (e.g. a confirm and
      // a cancel racing the same order), and the wrong branch would either
      // skip a needed restock or double-restock. Whichever CAS actually
      // matches the row's current status at lock time is authoritative.
      const [fromPending] = await conn.query(
        `UPDATE \`order\` SET status = 'cancelled' WHERE id = ? AND shopId = ? AND outletId = ? AND status = 'pending'`,
        [id, ctx.shopId, order.outletId],
      );
      if ((fromPending as { affectedRows: number }).affectedRows === 1) {
        // An order from an immediate-reservation channel already reserved
        // stock at creation (decremented while still 'pending', not at
        // confirm — see updateStatus above) — cancelling from 'pending' must
        // restock it here, unlike the deferred-reservation path where
        // nothing was ever decremented yet at this stage.
        if (
          IMMEDIATE_STOCK_RESERVATION_CHANNELS.includes(order.channel ?? '')
        ) {
          await this.adjustStockForOrder(
            conn,
            ctx,
            id,
            order.outletId,
            1,
            order.ingredientsConsumedAt !== null,
          );
        }
        return;
      }

      const [fromStockDecremented] = await conn.query(
        `UPDATE \`order\` SET status = 'cancelled'
         WHERE id = ? AND shopId = ? AND outletId = ? AND status IN ('confirmed', 'preparing', 'out_for_delivery')`,
        [id, ctx.shopId, order.outletId],
      );
      if ((fromStockDecremented as { affectedRows: number }).affectedRows === 1) {
        await this.adjustStockForOrder(
          conn,
          ctx,
          id,
          order.outletId,
          1,
          order.ingredientsConsumedAt !== null,
        );
        return;
      }

      throw new ConflictException(
        'Order status changed before this cancellation could be applied — refresh and retry',
      );
    });

    const orders = await this.loadOrdersWithRelations([id]);
    const cancelled = this.toResponse(orders.get(id)!);

    await this.affiliateService.syncOrderStatus(id, {
      orderStatus: 'cancelled',
    });
    // Was previously missing entirely — updateStatus() logs every other
    // transition (see its own call above), but cancel() is a separate
    // method/endpoint and had no audit trail of its own, which would have
    // silently dropped every cancellation from the order timeline.
    await this.auditLogService.logCtx(ctx, {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      before: { status: order.status },
      after: { status: 'cancelled' },
    });
    return cancelled;
  }

  // Backs the order detail modal's status timeline. Reuses findOne's
  // outlet-scoped lookup (404s a branch user out of an order outside their
  // outlet, same as every other order endpoint) rather than querying
  // auditlog directly off a bare id.
  async getHistory(ctx: TenantContext, id: number) {
    const order = await this.findOne(ctx, id);
    const entries = await this.auditLogService.listForEntity(
      ctx,
      'order',
      id,
      'order.status_changed',
    );
    return [
      // The very first "became pending" moment is the order's own creation,
      // not a logged transition — updateStatus/cancel only ever log a
      // *change*, so this is synthesized rather than duplicated in auditlog.
      { status: 'pending', timestamp: order.createdAt, actorName: null },
      ...entries.map((e) => ({
        status: (e.after as { status?: string } | null)?.status ?? null,
        timestamp: e.createdAt,
        actorName: e.actorName as string,
      })),
    ];
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
    conn: PoolConnection,
    ctx: TenantContext,
    orderId: number,
    outletId: number,
    direction: 1 | -1,
    ingredientsAlreadyConsumed: boolean,
  ) {
    const [items] = await conn.query<RowDataPacket[]>(
      `SELECT oi.productId, oi.variantId, oi.quantity, p.trackInventory, p.usesIngredients
       FROM orderitem oi JOIN product p ON p.id = oi.productId
       WHERE oi.orderId = ?`,
      [orderId],
    );
    // Only a restock (direction 1, i.e. cancellation) can ever cross stock
    // from 0 up to positive — collected here and fired (not awaited, see
    // below) after the loop so a slow email batch never delays the
    // transaction this runs inside. Phase A: reads through each item's own
    // shadow ingredient (mechanical outletstock/outletvariantstock ->
    // outletingredientstock swap, same "before <= 0" check as before) —
    // skipped for a usesIngredients:true item, which has no single stock
    // number across a multi-ingredient recipe to check here.
    const restockNotifyTargets: {
      productId: number;
      variantId: number | null;
    }[] = [];
    if (direction === 1) {
      for (const item of items) {
        if (!Boolean(item.trackInventory) || Boolean(item.usesIngredients))
          continue;
        const [shadowRows] = await conn.query<RowDataPacket[]>(
          item.variantId
            ? `SELECT id FROM ingredient WHERE shadowVariantId = ?`
            : `SELECT id FROM ingredient WHERE shadowProductId = ?`,
          [item.variantId ? item.variantId : item.productId],
        );
        const shadow = shadowRows[0];
        let before = 0;
        if (shadow) {
          const [beforeRows] = await conn.query<RowDataPacket[]>(
            `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
            [outletId, shadow.id],
          );
          before = (beforeRows[0]?.stockQuantity as number | undefined) ?? 0;
        }
        if (before <= 0) {
          restockNotifyTargets.push({
            productId: item.productId as number,
            variantId: item.variantId as number | null,
          });
        }
      }
    }
    for (const target of restockNotifyTargets) {
      this.notifySubscriptionsService
        .triggerForProduct(ctx.shopId, target.productId, target.variantId ?? undefined)
        .catch(() => {});
    }

    // The actual stock adjustment (Phase A: shadow or real recipe, every
    // product/variant now resolves through consumeForOrderItems) — same
    // trigger points as before: the pending->confirmed decrement
    // (direction -1) and every cancel-restock (direction 1, but only when
    // this specific order actually consumed stock in the first place).
    if (direction === -1) {
      const consumed = await this.productsService.consumeForOrderItems(
        conn,
        ctx.shopId,
        outletId,
        items.map((item) => ({
          productId: item.productId as number,
          variantId: item.variantId as number | null,
          quantity: item.quantity as number,
        })),
        -1,
        { throwOnInsufficientStock: false, actorUserId: ctx.userId },
      );
      if (consumed) {
        await conn.query(`UPDATE \`order\` SET ingredientsConsumedAt = ? WHERE id = ?`, [
          new Date(),
          orderId,
        ]);
      }
    } else if (ingredientsAlreadyConsumed) {
      await this.productsService.consumeForOrderItems(
        conn,
        ctx.shopId,
        outletId,
        items.map((item) => ({
          productId: item.productId as number,
          variantId: item.variantId as number | null,
          quantity: item.quantity as number,
        })),
        1,
        { throwOnInsufficientStock: false, actorUserId: ctx.userId },
      );
    }
  }

  // Batch-loads orderitem + the latest paymenttransaction per order — same
  // shape orderInclude used to fetch in one Prisma nested include (list/
  // status-transition responses; see loadOrderDetailWithRelations for the
  // richer single-order variant).
  private async loadOrdersWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledOrder>> {
    const result = new Map<number, AssembledOrder>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const [orders, items, payments] = await Promise.all([
      this.db.query<
        (OrderRow & { cashCollectedByName: string | null } & RowDataPacket)[]
      >(
        `SELECT o.*, u.name AS cashCollectedByName
         FROM \`order\` o LEFT JOIN user u ON u.id = o.cashCollectedBy
         WHERE o.id IN (${idList})`,
        ids,
      ),
      this.db.query<(OrderitemRow & RowDataPacket)[]>(
        `SELECT * FROM orderitem WHERE orderId IN (${idList})`,
        ids,
      ),
      this.loadLatestPaymentTransactions(ids),
    ]);
    const itemsByOrder = new Map<number, AssembledOrderItem[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }
    for (const o of orders) {
      result.set(o.id, {
        ...o,
        orderitem: itemsByOrder.get(o.id) ?? [],
        paymenttransaction: payments.get(o.id) ?? [],
      });
    }
    return result;
  }

  // Richer variant used only by the single-order detail endpoint (the order
  // detail modal) — product thumbnails for item images and the latest
  // payment transaction for payment-mode display, plus externaldelivery/
  // ordernote/surveyresponse. Kept separate from loadOrdersWithRelations so
  // list/status-transition responses don't carry the extra joins.
  private async loadOrderDetailWithRelations(
    id: number,
  ): Promise<AssembledOrderDetail> {
    const [orderRows, items, payments, externalDeliveryRows, noteRows, surveyRows] =
      await Promise.all([
        this.db.query<
          (OrderRow & { cashCollectedByName: string | null } & RowDataPacket)[]
        >(
          `SELECT o.*, u.name AS cashCollectedByName
           FROM \`order\` o LEFT JOIN user u ON u.id = o.cashCollectedBy
           WHERE o.id = ?`,
          [id],
        ),
        this.db.query<RowDataPacket[]>(
          `SELECT oi.*, p.thumbnail AS productThumbnail
           FROM orderitem oi JOIN product p ON p.id = oi.productId
           WHERE oi.orderId = ?`,
          [id],
        ),
        this.loadLatestPaymentTransactions([id]),
        this.db.query<RowDataPacket[]>(
          `SELECT * FROM externaldelivery WHERE orderId = ?`,
          [id],
        ),
        this.db.query<RowDataPacket[]>(
          `SELECT on1.*, u.id AS authorId, u.name AS authorName
           FROM ordernote on1 JOIN user u ON u.id = on1.authorUserId
           WHERE on1.orderId = ?
           ORDER BY on1.createdAt DESC`,
          [id],
        ),
        this.db.query<RowDataPacket[]>(
          `SELECT * FROM surveyresponse WHERE orderId = ?`,
          [id],
        ),
      ]);
    const order = orderRows[0];
    return {
      ...order,
      orderitem: items.map((i) => ({
        ...(i as unknown as OrderitemRow),
        product: { thumbnail: i.productThumbnail as string },
      })),
      paymenttransaction: payments.get(id) ?? [],
      externaldelivery: externalDeliveryRows[0] ?? null,
      ordernote: noteRows.map((n) => ({
        id: n.id,
        orderId: n.orderId,
        authorUserId: n.authorUserId,
        note: n.note,
        createdAt: n.createdAt,
        author: { id: n.authorId, name: n.authorName },
      })),
      surveyresponse: surveyRows[0] ?? null,
    };
  }

  // Deterministic "one row per order" resolution of the most recent
  // paymenttransaction — a plain MAX(createdAt) GROUP BY can return more
  // than one row per order on a createdAt tie, so this ties-breaks on id
  // too via a correlated subquery, matching Prisma's own take:1 exactness.
  private async loadLatestPaymentTransactions(
    orderIds: number[],
  ): Promise<Map<number, RowDataPacket[]>> {
    const result = new Map<number, RowDataPacket[]>();
    if (orderIds.length === 0) return result;
    const idList = orderIds.map(() => '?').join(', ');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT pt.* FROM paymenttransaction pt
       WHERE pt.orderId IN (${idList})
         AND pt.id = (
           SELECT pt2.id FROM paymenttransaction pt2
           WHERE pt2.orderId = pt.orderId
           ORDER BY pt2.createdAt DESC, pt2.id DESC
           LIMIT 1
         )`,
      orderIds,
    );
    for (const row of rows) {
      result.set(row.orderId as number, [row]);
    }
    return result;
  }

  private toResponse(order: AssembledOrder) {
    return {
      ...order,
      deliveryFee: trimDecimal(order.deliveryFee),
      taxAmount: trimDecimal(order.taxAmount),
      discountAmount: trimDecimal(order.discountAmount),
      giftCardAmount: trimDecimal(order.giftCardAmount),
      total: trimDecimal(order.total),
      orderitem: order.orderitem.map((i) => ({
        ...i,
        priceAtPurchase: trimDecimal(i.priceAtPurchase),
        autoDiscountAmount: trimDecimal(i.autoDiscountAmount),
      })),
      paymenttransaction: order.paymenttransaction.map((p) => ({
        ...p,
        amount: trimDecimal(p.amount as string),
      })),
    };
  }

  private toDetailResponse(order: AssembledOrderDetail) {
    return {
      ...this.toResponse(order),
      externaldelivery: order.externaldelivery
        ? { ...order.externaldelivery, price: trimDecimal(order.externaldelivery.price as string) }
        : null,
      ordernote: order.ordernote,
      surveyresponse: order.surveyresponse,
    };
  }
}
