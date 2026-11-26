import { CollectionRulesService } from '../collections/collection-rules.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import {
  assertOrderWithinLimits,
  loadStoredOrderSize,
} from '../common/order-limits';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { DraftorderRow, DraftorderitemRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { ProductsService } from '../products/products.service';
import { DiscountsService } from '../discounts/discounts.service';
import type { ValidateDiscountDto } from '../discounts/dto/validate-discount.dto';
import { OrdersService } from '../orders/orders.service';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { buildVariantLabel } from '../products/variant-generator';
import {
  RegionsService,
  attachRegion,
  type RegionSummary,
} from '../regions/regions.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { JobsService } from '../jobs/jobs.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { storefrontUrl } from '../common/storefront-url';
import {
  PaymentCurrencyNotSupportedException,
  isGatewayCurrencyBlocked,
} from '../payments/blocked-gateway-currencies';
import { resolveOrderReceiver } from '../common/order-receiver';
import type { DraftOrderFieldsDto } from './dto/draft-order-fields.dto';
import type { ListDraftOrdersDto } from './dto/list-draft-orders.dto';
import type { MarkDraftPaidDto } from './dto/mark-paid.dto';
import {
  CONVERSION_LEASE_SECONDS,
  DRAFT_ORDER_FILTERS,
  PAY_LINK_EXPIRY_DAYS,
} from './draft-order-constants';
import {
  type Bill,
  DraftPricingService,
  type NormalisedLine,
  type PricingInput,
  sameMoney,
} from './draft-pricing.service';
import { buildDraftInvoiceEmail } from './draft-invoice-email';

// The priced bill frozen when a payment link is created or re-locked. The pay
// page and the card conversion read THIS, never the live catalogue.
export interface DraftSnapshot {
  v: 1;
  bill: Bill;
  // The lines exactly as the conversion re-sends them: every price fixed.
  lines: {
    productId: number;
    variantId: number | null;
    quantity: number;
    unitPrice: string;
    customName: string | null;
  }[];
  discountCode: string | null;
  fulfilment: {
    orderType: 'delivery' | 'pickup';
    customerName: string;
    customerPhone: string;
    customerAddress: string | null;
    regionName: string | null;
    area: string | null;
    deliveryDate: string | null;
    deliveryTimeSlot: string | null;
    receiverName: string | null;
    receiverPhone: string | null;
    receiverMessage: string | null;
    customerNote: string | null;
    outletName: string;
  };
}

type ConversionMode =
  | { kind: 'cod' }
  | { kind: 'marked_paid'; method: string; reference: string | null }
  | { kind: 'card'; paymentLinkToken: string; expiresAt: Date };

interface AssembledDraftItem extends DraftorderitemRow {
  thumbnail: string;
  optionValue1: string | null;
  optionValue2: string | null;
  optionValue3: string | null;
}

interface AssembledDraft extends DraftorderRow {
  region: RegionSummary | null;
  items: AssembledDraftItem[];
  discountCode: string | null;
  outletName: string;
  createdByName: string | null;
}

@Injectable()
export class DraftOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly ordersService: OrdersService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly regionsService: RegionsService,
    private readonly collectionRules: CollectionRulesService,
    private readonly pricing: DraftPricingService,
    private readonly branchRoles: BranchRolesService,
    private readonly auditLog: AuditLogService,
    private readonly jobs: JobsService,
    private readonly notifications: OrderNotificationsService,
  ) {}

  // ---------------------------------------------------------------- reads

  async findAll(ctx: TenantContext, query: ListDraftOrdersDto = {}) {
    await this.syncStatuses(ctx.shopId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = ['d.shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (query.status) {
      const statuses = DRAFT_ORDER_FILTERS[query.status];
      where.push(`d.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push('(d.customerName LIKE ? OR d.customerPhone LIKE ?)');
      params.push(like, like);
    }
    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM draftorder d WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT d.id FROM draftorder d WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const ids = rows.map((r) => r.id as number);
    const drafts = await this.loadDrafts(ctx.shopId, ids);
    return {
      data: await Promise.all(
        ids.map((id) => this.toListItem(ctx, drafts.get(id)!)),
      ),
      page,
      pageSize,
      total: Number(countRows[0]?.n ?? 0),
    };
  }

  async findOne(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    return this.toDetail(ctx, draft);
  }

  // The builder's live bill split for an unsaved form.
  async preview(ctx: TenantContext, dto: DraftOrderFieldsDto) {
    if (!dto.outletId) throw new BadRequestException('outletId is required');
    await this.assertOutlet(ctx, dto.outletId);
    const items = await this.pricing.normaliseItems(
      ctx.shopId,
      dto.items ?? [],
    );
    return this.pricing.price(
      ctx.shopId,
      this.pricingInput(dto, dto.outletId, items),
      `staff:${ctx.userId}`,
    );
  }

  // ---------------------------------------------------------------- writes

  async create(ctx: TenantContext, dto: DraftOrderFieldsDto) {
    if (!dto.outletId) throw new BadRequestException('outletId is required');
    if (!dto.customerName?.trim())
      throw new BadRequestException('customerName is required');
    if (!dto.customerPhone?.trim())
      throw new BadRequestException('customerPhone is required');
    await this.assertOutlet(ctx, dto.outletId);
    const region = await this.regionsService.resolveForShop(ctx.shopId, dto, {
      required: false,
    });
    this.assertFieldPairs(dto, {});
    const items = dto.items
      ? await this.pricing.normaliseItems(ctx.shopId, dto.items)
      : [];
    // Prices the draft as entered: a bad discount code or a priced-out line is
    // refused now, while staff are looking at it.
    const bill = await this.pricing.price(
      ctx.shopId,
      this.pricingInput(
        { ...dto, regionId: region.regionId ?? undefined },
        dto.outletId,
        items,
      ),
      `staff:${ctx.userId}`,
    );
    const discountId = await this.discountIdFor(ctx.shopId, dto.discountCode);
    const existingCustomer = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM customer WHERE shopId = ? AND phone = ?`,
      [ctx.shopId, dto.customerPhone],
    );

    const newId = await this.db.transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO draftorder (shopId, outletId, customerId, customerName, customerPhone, customerEmail,
           customerAddress, regionId, area, orderType, discountId, notes, customerNote,
           receiverName, receiverPhone, receiverMessage, deliveryDate, deliveryTimeSlot,
           deliveryFeeOverride, deliveryFeeOverrideReason, orderDiscountType, orderDiscountValue,
           orderDiscountReason, createdByUserId, updatedAt, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT currency FROM shop WHERE id = ?))`,
        [
          ctx.shopId,
          dto.outletId,
          (existingCustomer[0]?.id as number | undefined) ?? null,
          dto.customerName!.trim(),
          dto.customerPhone!.trim(),
          dto.customerEmail?.trim() || null,
          dto.customerAddress?.trim() || null,
          region.regionId,
          dto.area?.trim() || null,
          dto.orderType ?? 'delivery',
          discountId,
          dto.notes ?? null,
          dto.customerNote?.trim() || null,
          dto.receiverName?.trim() || null,
          dto.receiverPhone?.trim() || null,
          dto.receiverMessage?.trim() || null,
          dto.deliveryDate ?? null,
          dto.deliveryTimeSlot?.trim() || null,
          dto.deliveryFeeOverride ?? null,
          dto.deliveryFeeOverride != null
            ? dto.deliveryFeeOverrideReason!.trim()
            : null,
          dto.orderDiscountType ?? null,
          dto.orderDiscountType ? (dto.orderDiscountValue ?? 0) : null,
          dto.orderDiscountType ? dto.orderDiscountReason!.trim() : null,
          ctx.userId || null,
          new Date(),
          ctx.shopId,
        ],
      );
      const draftId = (result as { insertId: number }).insertId;
      await this.insertItems(conn, draftId, items, bill);
      return draftId;
    });
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.created',
      entityType: 'draft_order',
      entityId: newId,
      after: {
        total: bill.total,
        currency: bill.currency,
        lines: items.length,
      },
    });
    return this.findOne(ctx, newId);
  }

  // Allowed while OPEN or after the link is sent. After a link: the snapshot is
  // re-locked at the new prices and the same URL keeps working. While the
  // customer is mid-payment (AWAITING_PAYMENT), the pending order is cancelled
  // first, which ends its gateway session: a payment that still lands on it is
  // recorded and flagged for a refund, never applied (F8).
  async update(ctx: TenantContext, id: number, dto: DraftOrderFieldsDto) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (draft.status === 'COMPLETED' || draft.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot edit a draft order that is already '${draft.status}'`,
      );
    }
    const outletId = dto.outletId ?? draft.outletId;
    await this.assertOutlet(ctx, outletId);
    const regionChanged = dto.regionId !== undefined;
    const region = regionChanged
      ? await this.regionsService.resolveForShop(ctx.shopId, dto, {
          required: false,
        })
      : null;
    this.assertFieldPairs(dto, draft);

    const items =
      dto.items !== undefined
        ? await this.pricing.normaliseItems(ctx.shopId, dto.items)
        : this.storedLines(draft);
    const merged = this.mergeFields(draft, dto, region?.regionId);
    const bill = await this.pricing.price(
      ctx.shopId,
      {
        ...this.pricingInput(merged, outletId, items),
        sizeBaseline: await this.storedSize(id),
      },
      `staff:${ctx.userId}`,
    );
    const discountId =
      dto.discountCode === undefined
        ? undefined
        : await this.discountIdFor(ctx.shopId, dto.discountCode);

    if (draft.status === 'AWAITING_PAYMENT' && draft.convertedOrderId) {
      await this.releasePendingOrder(ctx, draft.convertedOrderId);
    }

    const linkLive =
      draft.status === 'INVOICE_SENT' || draft.status === 'AWAITING_PAYMENT';
    if (linkLive && bill.total === null) {
      throw new BadRequestException(
        bill.deliveryError ?? 'Delivery could not be priced',
      );
    }
    // Built before the transaction: nothing inside it may touch the pool.
    const snapshotJson = linkLive
      ? JSON.stringify(
          await this.buildSnapshot(ctx.shopId, merged, outletId, items, bill),
        )
      : null;
    await this.db.transaction(async (conn) => {
      if (dto.items !== undefined) {
        await conn.query(`DELETE FROM draftorderitem WHERE draftOrderId = ?`, [
          id,
        ]);
        await this.insertItems(conn, id, items, bill);
      }
      const set: string[] = [];
      const params: unknown[] = [];
      const put = (col: string, value: unknown) => {
        if (value === undefined) return;
        set.push(`${col} = ?`);
        params.push(value);
      };
      put('outletId', dto.outletId);
      put('customerName', dto.customerName?.trim());
      put('customerPhone', dto.customerPhone?.trim());
      put(
        'customerEmail',
        dto.customerEmail === undefined
          ? undefined
          : dto.customerEmail.trim() || null,
      );
      put(
        'customerAddress',
        dto.customerAddress === undefined
          ? undefined
          : dto.customerAddress.trim() || null,
      );
      if (regionChanged) put('regionId', region!.regionId);
      put('area', dto.area === undefined ? undefined : dto.area.trim() || null);
      put('orderType', dto.orderType);
      put('discountId', discountId);
      put('notes', dto.notes);
      put(
        'customerNote',
        dto.customerNote === undefined
          ? undefined
          : dto.customerNote.trim() || null,
      );
      put(
        'receiverName',
        dto.receiverName === undefined
          ? undefined
          : dto.receiverName.trim() || null,
      );
      put(
        'receiverPhone',
        dto.receiverPhone === undefined
          ? undefined
          : dto.receiverPhone.trim() || null,
      );
      put(
        'receiverMessage',
        dto.receiverMessage === undefined
          ? undefined
          : dto.receiverMessage.trim() || null,
      );
      put('deliveryDate', dto.deliveryDate);
      put(
        'deliveryTimeSlot',
        dto.deliveryTimeSlot === undefined
          ? undefined
          : dto.deliveryTimeSlot.trim() || null,
      );
      if (dto.deliveryFeeOverride !== undefined) {
        put('deliveryFeeOverride', dto.deliveryFeeOverride);
        put(
          'deliveryFeeOverrideReason',
          dto.deliveryFeeOverride === null
            ? null
            : dto.deliveryFeeOverrideReason!.trim(),
        );
      }
      if (dto.orderDiscountType !== undefined) {
        put('orderDiscountType', dto.orderDiscountType);
        put(
          'orderDiscountValue',
          dto.orderDiscountType ? (dto.orderDiscountValue ?? 0) : null,
        );
        put(
          'orderDiscountReason',
          dto.orderDiscountType ? dto.orderDiscountReason!.trim() : null,
        );
      }
      if (linkLive) {
        // Re-lock: the same link now charges the new amount.
        put('snapshotJson', snapshotJson);
        put('snapshotAt', new Date());
        put('status', 'INVOICE_SENT');
      }
      put('updatedAt', new Date());
      await conn.query(
        `UPDATE draftorder SET ${set.join(', ')} WHERE id = ? AND shopId = ?`,
        [...params, id, ctx.shopId],
      );
    });
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.edited',
      entityType: 'draft_order',
      entityId: id,
      after: { total: bill.total, linkRelocked: linkLive },
    });
    return this.findOne(ctx, id);
  }

  async cancel(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (draft.status === 'COMPLETED' || draft.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot cancel a draft order that is already '${draft.status}'`,
      );
    }
    await this.assertPermission(ctx, draft.outletId);
    if (draft.status === 'AWAITING_PAYMENT' && draft.convertedOrderId) {
      await this.releasePendingOrder(ctx, draft.convertedOrderId);
    }
    // The link keeps its token so the customer sees "cancelled", and can no
    // longer pay (the pay page refuses a CANCELLED draft).
    await this.db.execute(
      `UPDATE draftorder SET status = 'CANCELLED', updatedAt = ?
        WHERE id = ? AND shopId = ? AND status <> 'COMPLETED'`,
      [new Date(), id, ctx.shopId],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.cancelled',
      entityType: 'draft_order',
      entityId: id,
      before: { status: draft.status },
    });
    return this.findOne(ctx, id);
  }

  // Creates the payment link (or re-sends the existing one) and freezes the
  // priced snapshot. The draft stays a draft: no order, no stock held.
  async sendLink(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (
      draft.status !== 'OPEN' &&
      draft.status !== 'INVOICE_SENT' &&
      draft.status !== 'AWAITING_PAYMENT'
    ) {
      throw new BadRequestException(
        `Cannot send a payment link for a draft order that is '${draft.status}'`,
      );
    }
    await this.assertPermission(ctx, draft.outletId);
    await this.assertCardAvailable(ctx.shopId);
    const items = this.storedLines(draft);
    if (!items.length) {
      throw new BadRequestException(
        'Add at least one item before sending a payment link',
      );
    }
    this.assertConvertible(draft);
    const bill = await this.pricing.price(
      ctx.shopId,
      {
        ...this.pricingInput(
          this.mergeFields(draft, {}),
          draft.outletId,
          items,
        ),
        sizeBaseline: await this.storedSize(draft.id),
      },
      `staff:${ctx.userId}`,
    );
    if (bill.total === null) {
      throw new BadRequestException(
        bill.deliveryError ?? 'Delivery could not be priced',
      );
    }
    if (Number(bill.total) <= 0) {
      throw new BadRequestException(
        'There is nothing to pay on this order: use Mark as paid',
      );
    }
    const snapshot = await this.buildSnapshot(
      ctx.shopId,
      this.mergeFields(draft, {}),
      draft.outletId,
      items,
      bill,
    );
    const token = draft.payToken ?? randomBytes(16).toString('hex');
    const expiresAt = new Date(
      Date.now() + PAY_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.db.execute(
      `UPDATE draftorder SET payToken = ?, payLinkSentAt = NOW(3), payLinkExpiresAt = ?,
              snapshotJson = ?, snapshotAt = NOW(3),
              status = IF(status = 'AWAITING_PAYMENT', status, 'INVOICE_SENT'), updatedAt = ?
        WHERE id = ? AND shopId = ?`,
      [token, expiresAt, JSON.stringify(snapshot), new Date(), id, ctx.shopId],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.link_sent',
      entityType: 'draft_order',
      entityId: id,
      after: { total: bill.total, currency: bill.currency, expiresAt },
    });
    return this.findOne(ctx, id);
  }

  // The link stops working; the draft goes back to OPEN.
  async cancelLink(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (
      draft.status !== 'INVOICE_SENT' &&
      draft.status !== 'AWAITING_PAYMENT'
    ) {
      throw new BadRequestException('This draft has no active payment link');
    }
    await this.assertPermission(ctx, draft.outletId);
    if (draft.status === 'AWAITING_PAYMENT' && draft.convertedOrderId) {
      await this.releasePendingOrder(ctx, draft.convertedOrderId);
    }
    await this.db.execute(
      `UPDATE draftorder SET payToken = NULL, payLinkExpiresAt = NULL, snapshotJson = NULL,
              status = 'OPEN', updatedAt = ?
        WHERE id = ? AND shopId = ? AND status IN ('INVOICE_SENT', 'AWAITING_PAYMENT')`,
      [new Date(), id, ctx.shopId],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.link_cancelled',
      entityType: 'draft_order',
      entityId: id,
    });
    return this.findOne(ctx, id);
  }

  // Emails the invoice with the Pay button to the customer (existing send_email
  // path). Needs a live link and a customer email.
  async sendEmail(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (
      (draft.status !== 'INVOICE_SENT' &&
        draft.status !== 'AWAITING_PAYMENT') ||
      !draft.payToken
    ) {
      throw new BadRequestException('Create the payment link first');
    }
    if (!draft.customerEmail) {
      throw new BadRequestException('Add the customer email first');
    }
    await this.assertPermission(ctx, draft.outletId);
    const shop = await this.shopRow(ctx.shopId);
    const snapshot = draft.snapshotJson as DraftSnapshot;
    const email = buildDraftInvoiceEmail({
      shopName: (shop.displayName as string | null) || (shop.name as string),
      shopEmail: (shop.email as string | null) ?? null,
      shopPhone: shop.whatsappNumber
        ? `${(shop.whatsappCountryCode as string | null) ?? ''}${shop.whatsappNumber as string}`
        : null,
      payUrl: storefrontUrl(shop as never, `/pay/${draft.payToken}`),
      snapshot,
    });
    await this.jobs.enqueue(
      ctx.shopId,
      'send_email',
      {
        to: draft.customerEmail,
        subject: email.subject,
        bodyText: email.text,
        html: email.html,
        fromName: (shop.displayName as string | null) || (shop.name as string),
      },
      // One per link version: re-sending after a re-lock sends again.
      `draft:${id}:invoice-email:${draft.snapshotAt?.getTime() ?? 0}:${Date.now()}`,
      { sensitive: true },
    );
    await this.auditLog.logCtx(ctx, {
      action: 'draft_order.invoice_emailed',
      entityType: 'draft_order',
      entityId: id,
    });
    return { sent: true };
  }

  // Cash on delivery / pickup: converts now into a normal pending order.
  async convertCod(ctx: TenantContext, id: number) {
    const draft = await this.prepareStaffConversion(ctx, id);
    await this.convert(ctx, draft, { kind: 'cod' });
    return this.findOne(ctx, id);
  }

  // Mark as paid (cash, transfer, card terminal, other): converts now, paid.
  async markPaid(ctx: TenantContext, id: number, dto: MarkDraftPaidDto) {
    const draft = await this.prepareStaffConversion(ctx, id);
    await this.convert(ctx, draft, {
      kind: 'marked_paid',
      method: dto.method,
      reference: dto.reference?.trim() || null,
    });
    return this.findOne(ctx, id);
  }

  // ------------------------------------------------- public pay (DraftPayService)

  // The draft behind /pay/<token> for THIS shop, or null (any mismatch is the
  // same not-found).
  async findByPayToken(shopId: number, token: string) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM draftorder WHERE shopId = ? AND payToken = ?`,
      [shopId, token],
    );
    const id = rows[0]?.id as number | undefined;
    if (!id) return null;
    await this.syncStatuses(shopId, id);
    return this.loadOne(shopId, id);
  }

  // Whether the shop can take a card payment right now: an active card
  // processor that is usable (keys present, not rejected), in a currency it takes.
  async cardAvailable(shopId: number): Promise<boolean> {
    const shop = await this.shopRow(shopId);
    const gateway = shop.paymentGateway as string;
    if (!['nomod', 'stripe'].includes(gateway)) return false;
    if (isGatewayCurrencyBlocked(gateway, shop.currency as string))
      return false;
    return this.paymentSettings.isUsable(shopId, gateway);
  }

  // Pay pressed: the draft becomes exactly one pending unpaid card order (or the
  // pending order from an earlier press is reused). Returns the order's own
  // payment-link token, which the existing pay path charges.
  async convertForPayment(
    shopId: number,
    draftId: number,
  ): Promise<{
    orderToken: string;
    orderId: number;
    trackingToken: string;
    created: boolean;
  }> {
    await this.syncStatuses(shopId, draftId);
    const draft = await this.loadOne(shopId, draftId);
    if (draft.status === 'AWAITING_PAYMENT' && draft.convertedOrderId) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, paymentLinkToken, trackingToken FROM \`order\`
          WHERE id = ? AND shopId = ? AND status = 'pending' AND paymentStatus = 'unpaid'`,
        [draft.convertedOrderId, shopId],
      );
      if (rows[0]?.paymentLinkToken) {
        return {
          orderToken: rows[0].paymentLinkToken as string,
          orderId: rows[0].id as number,
          trackingToken: rows[0].trackingToken as string,
          created: false,
        };
      }
    }
    if (draft.status !== 'INVOICE_SENT') {
      throw new ConflictException('This order cannot be paid now');
    }
    const ctx = await this.systemContext(shopId, draft.createdByUserId);
    const orderToken = randomUUID();
    const order = await this.convert(ctx, draft, {
      kind: 'card',
      paymentLinkToken: orderToken,
      expiresAt:
        draft.payLinkExpiresAt ??
        new Date(Date.now() + PAY_LINK_EXPIRY_DAYS * 86400000),
    });
    return {
      orderToken,
      orderId: order.id,
      trackingToken: order.trackingToken as string,
      created: true,
    };
  }

  // "We received your order" + the merchant alert for a card-link order, once
  // its payment session exists: the storefront card-checkout rule, exactly once
  // per order by the same CAS on order.placedNotifiedAt.
  async announceAfterSession(
    shopId: number,
    orderId: number,
    createdByUserId: number | null,
  ) {
    const res = await this.db.execute(
      `UPDATE \`order\` SET placedNotifiedAt = NOW(3)
        WHERE id = ? AND shopId = ? AND placedNotifiedAt IS NULL`,
      [orderId, shopId],
    );
    if (res.affectedRows !== 1) return;
    const ctx = await this.systemContext(shopId, createdByUserId);
    const order = await this.ordersService.findOne(ctx, orderId);
    this.notifications
      .notifyOrderConfirmed(shopId, order)
      .catch(() =>
        this.db
          .execute(
            `UPDATE \`order\` SET placedNotifiedAt = NULL WHERE id = ? AND shopId = ?`,
            [orderId, shopId],
          )
          .catch(() => undefined),
      );
  }

  // The pending order's gateway call failed: cancel it (stock and discount use
  // are returned) and put the draft back to "link sent" so the link works again.
  async releaseAfterGatewayFailure(
    shopId: number,
    draftId: number,
    orderId: number,
    gateway: string,
  ) {
    await this.ordersService.cancelAfterGatewayFailure(
      shopId,
      orderId,
      gateway,
    );
    await this.syncStatuses(shopId, draftId);
  }

  // ------------------------------------------------------- admin discount check

  // Admin draft-order builder's discount check (POST /shop/discounts/validate,
  // served by DiscountValidationController). Lines are priced by the same
  // resolver order creation uses, so the preview is the charge.
  async validateDiscount(ctx: TenantContext, dto: ValidateDiscountDto) {
    if (!dto.items?.length)
      return this.discountsService.validate(ctx.shopId, dto);
    const resolved = await this.productsService.resolveOrderItems(
      ctx.shopId,
      dto.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        giftCardAmount: i.giftCardAmount,
        priceOverride: i.priceOverride,
      })),
    );
    assertOrderWithinLimits(resolved);
    const lines = await this.discountsService.buildLines(
      ctx.shopId,
      resolved.map((r) => ({
        productId: r.product.id as number,
        price: r.price,
        quantity: r.quantity,
      })),
    );
    return this.discountsService.validate(ctx.shopId, dto, lines);
  }

  // ------------------------------------------------------------- internals

  // A draft whose order was paid becomes COMPLETED; one whose pending order was
  // cancelled (gateway failure, staff) goes back to "link sent" so the same link
  // can be paid again. Lazy, on every read and action: cheap, and correct
  // whichever path paid or cancelled the order.
  private async syncStatuses(shopId: number, draftId?: number) {
    const only = draftId ? ' AND d.id = ?' : '';
    const params = draftId ? [shopId, draftId] : [shopId];
    await this.db.execute(
      `UPDATE draftorder d JOIN \`order\` o ON o.id = d.convertedOrderId AND o.shopId = d.shopId
          SET d.status = 'COMPLETED', d.updatedAt = NOW(3)
        WHERE d.shopId = ?${only} AND d.status = 'AWAITING_PAYMENT' AND o.paymentStatus = 'paid'`,
      params,
    );
    await this.db.execute(
      `UPDATE draftorder d JOIN \`order\` o ON o.id = d.convertedOrderId AND o.shopId = d.shopId
          SET d.status = 'INVOICE_SENT', d.updatedAt = NOW(3)
        WHERE d.shopId = ?${only} AND d.status = 'AWAITING_PAYMENT'
          AND o.status = 'cancelled' AND o.paymentStatus <> 'paid'`,
      params,
    );
  }

  private async prepareStaffConversion(ctx: TenantContext, id: number) {
    await this.syncStatuses(ctx.shopId, id);
    const draft = await this.loadOne(ctx.shopId, id);
    if (draft.status === 'AWAITING_PAYMENT') {
      throw new ConflictException(
        'The customer is paying by card right now. Cancel the payment link first.',
      );
    }
    if (draft.status !== 'OPEN' && draft.status !== 'INVOICE_SENT') {
      throw new BadRequestException(`Draft order is already '${draft.status}'`);
    }
    if (!draft.items.length) {
      throw new BadRequestException('Add at least one item first');
    }
    this.assertConvertible(draft);
    return draft;
  }

  // The one conversion path: exactly once per draft at a time, by a lease on
  // draftorder.convertingAt (a second Pay press or a double click gets a 409),
  // then OrdersService.create, the path every order takes.
  private async convert(
    ctx: TenantContext,
    draft: AssembledDraft,
    mode: ConversionMode,
  ) {
    const allowed =
      mode.kind === 'card' ? ['INVOICE_SENT'] : ['OPEN', 'INVOICE_SENT'];
    const claim = await this.db.execute(
      `UPDATE draftorder SET convertingAt = NOW(3)
        WHERE id = ? AND shopId = ? AND status IN (${allowed.map(() => '?').join(', ')})
          AND (convertingAt IS NULL OR convertingAt < NOW(3) - INTERVAL ${CONVERSION_LEASE_SECONDS} SECOND)`,
      [draft.id, draft.shopId, ...allowed],
    );
    if (claim.affectedRows !== 1) {
      throw new ConflictException(
        'This order is already being processed. Try again in a moment.',
      );
    }
    try {
      const fields = this.mergeFields(draft, {});
      let items: NormalisedLine[];
      let deliveryFee: number;
      let manualDiscountAmount: number | undefined;
      let discountCode: string | undefined;
      let expectedTotal: string | null = null;
      if (mode.kind === 'card') {
        const snapshot = draft.snapshotJson as DraftSnapshot | null;
        if (!snapshot)
          throw new ConflictException('This payment link is not ready');
        items = snapshot.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId ?? undefined,
          quantity: l.quantity,
          priceOverride: Number(l.unitPrice),
          priceReason: null,
          customName: l.customName,
          taxable: null,
        }));
        deliveryFee = Number(snapshot.bill.deliveryFee ?? 0);
        if (snapshot.bill.discount.source === 'manual') {
          manualDiscountAmount = Number(snapshot.bill.discount.amount);
        } else if (snapshot.discountCode) {
          discountCode = snapshot.discountCode;
        }
        expectedTotal = snapshot.bill.total;
      } else {
        items = this.storedLines(draft);
        const bill = await this.pricing.price(
          draft.shopId,
          {
            ...this.pricingInput(fields, draft.outletId, items),
            sizeBaseline: await this.storedSize(draft.id),
          },
          `staff:${ctx.userId}`,
        );
        if (bill.deliveryFee === null) {
          throw new BadRequestException(
            bill.deliveryError ?? 'Delivery could not be priced',
          );
        }
        deliveryFee = Number(bill.deliveryFee);
        if (bill.discount.source === 'manual') {
          manualDiscountAmount = Number(bill.discount.amount);
        } else if (draft.discountCode) {
          discountCode = draft.discountCode;
        }
        expectedTotal = bill.total;
      }
      const pickup = draft.orderType === 'pickup';
      // Re-checked against the shop's own country (it may have changed since the
      // draft was saved); OrdersService.create checks it again.
      const region = await this.regionsService.resolveForShop(
        draft.shopId,
        { regionId: draft.regionId ?? undefined },
        { required: false },
      );
      const outletRegion = await this.db.query<RowDataPacket[]>(
        `SELECT regionId FROM outlet WHERE id = ? AND shopId = ?`,
        [draft.outletId, draft.shopId],
      );
      const order = await this.ordersService.create(
        ctx,
        {
          outletId: draft.outletId,
          customerName: draft.customerName,
          customerPhone: draft.customerPhone,
          customerEmail: draft.customerEmail ?? undefined,
          customerAddress:
            draft.customerAddress || (pickup ? 'Pickup at outlet' : ''),
          regionId:
            (pickup
              ? (region.regionId ??
                (outletRegion[0]?.regionId as number | null | undefined))
              : region.regionId) ?? undefined,
          area: draft.area ?? undefined,
          orderType: draft.orderType ?? 'delivery',
          deliveryDate: draft.deliveryDate ?? undefined,
          deliveryTimeSlot: draft.deliveryTimeSlot ?? undefined,
          deliveryNotes: draft.customerNote ?? undefined,
          receiverMessage: draft.receiverMessage ?? undefined,
          receiverName: draft.receiverName ?? undefined,
          receiverPhone: draft.receiverPhone ?? undefined,
          channel: 'draft_order',
          discountCode,
          deliveryFee,
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            priceOverride: i.priceOverride,
          })),
        },
        {
          reserveStock: true,
          sizeBaseline: await loadStoredOrderSize(
            this.db,
            { table: 'draftorderitem', fk: 'draftOrderId' },
            draft.id,
          ),
          draft: {
            draftOrderId: draft.id,
            createdByUserId: draft.createdByUserId,
            adminSource:
              mode.kind === 'card'
                ? 'payment_link'
                : mode.kind === 'cod'
                  ? 'cod'
                  : 'marked_paid',
            paymentMethod:
              mode.kind === 'card'
                ? 'card_online'
                : mode.kind === 'cod'
                  ? pickup
                    ? 'cash_on_pickup'
                    : 'cash_on_delivery'
                  : null,
            manualPaymentMethod:
              mode.kind === 'marked_paid' ? mode.method : null,
            manualPaymentReference:
              mode.kind === 'marked_paid' ? mode.reference : null,
            markPaid: mode.kind === 'marked_paid',
            manualDiscountAmount,
            lineNames: items.map((i) => i.customName ?? undefined),
            deferNotifications: mode.kind === 'card',
            paymentLinkToken:
              mode.kind === 'card' ? mode.paymentLinkToken : undefined,
            paymentLinkExpiresAt:
              mode.kind === 'card' ? mode.expiresAt : undefined,
          },
        },
      );
      // The card charge is the frozen amount: an order that came out different
      // (a tax class or discount changed since the link) is never charged.
      if (
        mode.kind === 'card' &&
        expectedTotal !== null &&
        !sameMoney(order.total, expectedTotal, draft.currency)
      ) {
        await this.ordersService.cancelAfterGatewayFailure(
          draft.shopId,
          order.id,
          'draft_snapshot',
        );
        throw new ConflictException(
          'The price of this order changed since the link was sent. Please contact the shop.',
        );
      }
      await this.db.execute(
        `UPDATE draftorder SET convertedOrderId = ?, customerId = ?, convertingAt = NULL,
                status = ?, updatedAt = NOW(3)
          WHERE id = ? AND shopId = ?`,
        [
          order.id,
          order.customerId ?? null,
          mode.kind === 'card' ? 'AWAITING_PAYMENT' : 'COMPLETED',
          draft.id,
          draft.shopId,
        ],
      );
      await this.auditLog.logCtx(ctx, {
        action: 'draft_order.converted',
        entityType: 'draft_order',
        entityId: draft.id,
        after: {
          orderId: order.id,
          shopOrderNumber: order.shopOrderNumber,
          via: mode.kind === 'card' ? 'payment_link' : mode.kind,
          total: order.total,
        },
      });
      return order;
    } catch (err) {
      await this.db
        .execute(
          `UPDATE draftorder SET convertingAt = NULL WHERE id = ? AND shopId = ?`,
          [draft.id, draft.shopId],
        )
        .catch(() => undefined);
      throw err;
    }
  }

  // Cancels the pending card order of a draft (edit, link cancel, draft cancel).
  // A paid order is never cancelled here.
  private async releasePendingOrder(ctx: TenantContext, orderId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT status, paymentStatus FROM \`order\` WHERE id = ? AND shopId = ?`,
      [orderId, ctx.shopId],
    );
    const order = rows[0];
    if (!order || order.status === 'cancelled') return;
    if (order.paymentStatus === 'paid') {
      throw new ConflictException('The customer has already paid this order');
    }
    await this.ordersService.cancel(ctx, orderId);
  }

  private assertConvertible(draft: AssembledDraft) {
    if (draft.orderType !== 'pickup' && !draft.customerAddress) {
      throw new BadRequestException('Add the delivery address first');
    }
  }

  private assertFieldPairs(
    dto: DraftOrderFieldsDto,
    current: Partial<Pick<DraftorderRow, 'receiverName' | 'receiverPhone'>>,
  ) {
    resolveOrderReceiver({
      receiverName:
        dto.receiverName !== undefined
          ? dto.receiverName
          : (current.receiverName ?? undefined),
      receiverPhone:
        dto.receiverPhone !== undefined
          ? dto.receiverPhone
          : (current.receiverPhone ?? undefined),
    });
    if (
      dto.deliveryFeeOverride != null &&
      !dto.deliveryFeeOverrideReason?.trim()
    ) {
      throw new BadRequestException(
        'Give a reason for the changed delivery fee',
      );
    }
    if (dto.orderDiscountType && !dto.orderDiscountReason?.trim()) {
      throw new BadRequestException('Give a reason for the discount');
    }
  }

  private async assertOutlet(ctx: TenantContext, outletId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (!rows.length)
      throw new BadRequestException('outletId is invalid for this shop');
    await this.assertPermission(ctx, outletId);
  }

  private assertPermission(ctx: TenantContext, outletId: number) {
    return this.branchRoles.assertPermission(ctx, outletId, 'orders.create');
  }

  private async assertCardAvailable(shopId: number) {
    // A currency the active card processor cannot take keeps its own specific
    // 400 (Stripe and KWD/BHD/OMR), as before custom orders.
    const shop = await this.shopRow(shopId);
    const gateway = shop.paymentGateway as string;
    if (isGatewayCurrencyBlocked(gateway, shop.currency as string)) {
      throw new PaymentCurrencyNotSupportedException(
        gateway,
        shop.currency as string,
      );
    }
    if (!(await this.cardAvailable(shopId))) {
      throw new ForbiddenException(
        'Card payment links need a working card processor. Set up Nomod or Stripe in Integrations > Payments.',
      );
    }
  }

  private async discountIdFor(shopId: number, code: string | null | undefined) {
    if (!code) return null;
    const discount = await this.discountsService.resolveByCode(shopId, code);
    if (!discount) throw new BadRequestException('Invalid discount code');
    return discount.id;
  }

  private async systemContext(
    shopId: number,
    userId: number | null,
  ): Promise<TenantContext> {
    let id = userId;
    if (!id) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
        [shopId],
      );
      id = (rows[0]?.id as number | undefined) ?? null;
    }
    if (!id) throw new ConflictException('This order cannot be paid now');
    return {
      userId: id,
      shopId,
      role: 'admin',
      outletId: null,
      systemActorLabel: 'customer (payment link)',
    };
  }

  private async shopRow(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM shop WHERE id = ?`,
      [shopId],
    );
    return rows[0];
  }

  // The draft's own fields with an update's changes applied (no write).
  private mergeFields(
    draft: AssembledDraft,
    dto: DraftOrderFieldsDto,
    regionId?: number | null,
  ): DraftOrderFieldsDto & { discountCode?: string | null } {
    const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
    return {
      outletId: pick(dto.outletId, draft.outletId),
      customerName: pick(dto.customerName, draft.customerName),
      customerPhone: pick(dto.customerPhone, draft.customerPhone),
      customerEmail: pick(dto.customerEmail, draft.customerEmail ?? undefined),
      customerAddress: pick(
        dto.customerAddress,
        draft.customerAddress ?? undefined,
      ),
      regionId:
        regionId !== undefined
          ? (regionId ?? undefined)
          : (draft.regionId ?? undefined),
      area: pick(dto.area, draft.area ?? undefined),
      orderType: pick(dto.orderType, draft.orderType ?? 'delivery'),
      deliveryDate: pick(dto.deliveryDate, draft.deliveryDate ?? undefined),
      deliveryTimeSlot: pick(
        dto.deliveryTimeSlot,
        draft.deliveryTimeSlot ?? undefined,
      ),
      receiverName: pick(dto.receiverName, draft.receiverName ?? undefined),
      receiverPhone: pick(dto.receiverPhone, draft.receiverPhone ?? undefined),
      receiverMessage: pick(
        dto.receiverMessage,
        draft.receiverMessage ?? undefined,
      ),
      discountCode:
        dto.discountCode !== undefined ? dto.discountCode : draft.discountCode,
      orderDiscountType: pick(
        dto.orderDiscountType,
        (draft.orderDiscountType as 'percent' | 'fixed' | null) ?? null,
      ),
      orderDiscountValue: pick(
        dto.orderDiscountValue,
        draft.orderDiscountValue != null
          ? Number(draft.orderDiscountValue)
          : undefined,
      ),
      orderDiscountReason: pick(
        dto.orderDiscountReason,
        draft.orderDiscountReason ?? undefined,
      ),
      deliveryFeeOverride: pick(
        dto.deliveryFeeOverride,
        draft.deliveryFeeOverride != null
          ? Number(draft.deliveryFeeOverride)
          : null,
      ),
      deliveryFeeOverrideReason: pick(
        dto.deliveryFeeOverrideReason,
        draft.deliveryFeeOverrideReason ?? undefined,
      ),
      notes: pick(dto.notes, draft.notes ?? undefined),
      customerNote: pick(dto.customerNote, draft.customerNote ?? undefined),
    };
  }

  private storedSize(draftId: number) {
    return loadStoredOrderSize(
      this.db,
      { table: 'draftorderitem', fk: 'draftOrderId' },
      draftId,
    );
  }

  private pricingInput(
    f: DraftOrderFieldsDto & { discountCode?: string | null },
    outletId: number,
    items: NormalisedLine[],
  ): PricingInput {
    return {
      outletId,
      orderType: f.orderType ?? 'delivery',
      regionId: f.regionId ?? null,
      area: f.area ?? null,
      customerAddress: f.customerAddress ?? null,
      items,
      discountCode: f.discountCode ?? null,
      orderDiscountType: f.orderDiscountType ?? null,
      orderDiscountValue: f.orderDiscountValue ?? null,
      orderDiscountReason: f.orderDiscountReason ?? null,
      deliveryFeeOverride: f.deliveryFeeOverride ?? null,
    };
  }

  // The stored lines as pricing input: a custom line keeps its price; a
  // catalogue line is re-priced live unless staff overrode it.
  private storedLines(draft: AssembledDraft): NormalisedLine[] {
    return draft.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? undefined,
      quantity: i.quantity,
      priceOverride:
        i.isCustom || i.priceOverrideReason !== null
          ? Number(i.price)
          : undefined,
      priceReason: i.priceOverrideReason,
      customName: i.isCustom ? i.productName : null,
      taxable: i.isCustom ? (i.taxable ?? true) : null,
    }));
  }

  private async insertItems(
    conn: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    draftId: number,
    items: NormalisedLine[],
    bill: Bill,
  ) {
    if (!items.length) return;
    await conn.query(
      `INSERT INTO draftorderitem (draftOrderId, productId, variantId, productName, quantity, price, isCustom, taxable, priceOverrideReason)
       VALUES ${items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      items.flatMap((i, index) => [
        draftId,
        i.productId,
        i.variantId ?? null,
        i.customName ?? bill.lines[index]?.name ?? '',
        i.quantity,
        // The unit price at this save (informational for a live-priced line).
        bill.lines[index]?.unitPrice ?? String(i.priceOverride ?? 0),
        i.customName ? 1 : 0,
        i.customName ? (i.taxable ? 1 : 0) : null,
        i.priceReason,
      ]),
    );
  }

  private async buildSnapshot(
    shopId: number,
    f: DraftOrderFieldsDto & { discountCode?: string | null },
    outletId: number,
    items: NormalisedLine[],
    bill: Bill,
  ): Promise<DraftSnapshot> {
    const [outlet, region] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT name FROM outlet WHERE id = ? AND shopId = ?`,
        [outletId, shopId],
      ),
      f.regionId
        ? this.db.query<RowDataPacket[]>(
            `SELECT nameEn FROM region WHERE id = ?`,
            [f.regionId],
          )
        : Promise.resolve([] as RowDataPacket[]),
    ]);
    const pickup = f.orderType === 'pickup';
    return {
      v: 1,
      bill,
      lines: items.map((i, index) => ({
        productId: i.productId,
        variantId: i.variantId ?? null,
        quantity: i.quantity,
        unitPrice: bill.lines[index].unitPrice,
        customName: i.customName,
      })),
      discountCode:
        bill.discount.source === 'code' ? (f.discountCode ?? null) : null,
      fulfilment: {
        orderType: pickup ? 'pickup' : 'delivery',
        customerName: f.customerName ?? '',
        customerPhone: f.customerPhone ?? '',
        customerAddress: pickup ? null : (f.customerAddress ?? null),
        regionName: pickup
          ? null
          : ((region[0]?.nameEn as string | undefined) ?? null),
        area: pickup ? null : (f.area ?? null),
        deliveryDate: f.deliveryDate ?? null,
        deliveryTimeSlot: f.deliveryTimeSlot ?? null,
        receiverName: f.receiverName ?? null,
        receiverPhone: f.receiverPhone ?? null,
        receiverMessage: f.receiverMessage ?? null,
        customerNote: f.customerNote ?? null,
        outletName: (outlet[0]?.name as string | undefined) ?? '',
      },
    };
  }

  private async loadOne(shopId: number, id: number): Promise<AssembledDraft> {
    const draft = (await this.loadDrafts(shopId, [id])).get(id);
    if (!draft) throw new NotFoundException(`Draft order ${id} not found`);
    return draft;
  }

  private async loadDrafts(
    shopId: number,
    ids: number[],
  ): Promise<Map<number, AssembledDraft>> {
    const result = new Map<number, AssembledDraft>();
    if (!ids.length) return result;
    const idList = ids.map(() => '?').join(', ');
    const [drafts, items] = await Promise.all([
      this.db.query<(DraftorderRow & RowDataPacket)[]>(
        `SELECT d.*, disc.code AS discountCodeValue, o.name AS outletName, u.name AS createdByName
           FROM draftorder d
           JOIN outlet o ON o.id = d.outletId
           LEFT JOIN discount disc ON disc.id = d.discountId
           LEFT JOIN user u ON u.id = d.createdByUserId AND u.shopId = d.shopId
          WHERE d.shopId = ? AND d.id IN (${idList})`,
        [shopId, ...ids],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT di.*, p.thumbnail AS productThumbnail,
                ov1.value AS optionValue1, ov2.value AS optionValue2, ov3.value AS optionValue3
           FROM draftorderitem di
           JOIN draftorder d ON d.id = di.draftOrderId AND d.shopId = ?
           JOIN product p ON p.id = di.productId
           LEFT JOIN productvariant v ON v.id = di.variantId
           LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
           LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
           LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
          WHERE di.draftOrderId IN (${idList})
          ORDER BY di.id`,
        [shopId, ...ids],
      ),
    ]);
    const itemsByDraft = new Map<number, AssembledDraftItem[]>();
    for (const i of items) {
      const list = itemsByDraft.get(i.draftOrderId as number) ?? [];
      list.push({
        id: i.id as number,
        draftOrderId: i.draftOrderId as number,
        productId: i.productId as number,
        variantId: (i.variantId as number | null) ?? null,
        productName: i.productName as string,
        quantity: i.quantity as number,
        price: i.price as string,
        isCustom: Boolean(i.isCustom),
        taxable: i.taxable === null ? null : Boolean(i.taxable),
        priceOverrideReason: (i.priceOverrideReason as string | null) ?? null,
        thumbnail: (i.productThumbnail as string) ?? '',
        optionValue1: i.optionValue1 as string | null,
        optionValue2: i.optionValue2 as string | null,
        optionValue3: i.optionValue3 as string | null,
      });
      itemsByDraft.set(i.draftOrderId as number, list);
    }
    for (const d of await attachRegion(this.db, drafts)) {
      result.set(d.id, {
        ...d,
        items: itemsByDraft.get(d.id) ?? [],
        discountCode: (d.discountCodeValue as string | null) ?? null,
        outletName: d.outletName as string,
        createdByName: (d.createdByName as string | null) ?? null,
      });
    }
    return result;
  }

  private payUrl(shop: RowDataPacket, token: string | null) {
    return token ? storefrontUrl(shop as never, `/pay/${token}`) : null;
  }

  // The bill a draft shows: the frozen snapshot once a link exists, else (while
  // OPEN) the live price; a finished draft without a link shows its order.
  private async billFor(
    ctx: TenantContext,
    d: AssembledDraft,
  ): Promise<{ bill: Bill | null; billError: string | null }> {
    const snapshot = d.snapshotJson as DraftSnapshot | null;
    if (snapshot) return { bill: snapshot.bill, billError: null };
    if (d.status !== 'OPEN') return { bill: null, billError: null };
    try {
      return {
        bill: await this.pricing.price(
          ctx.shopId,
          {
            ...this.pricingInput(
              this.mergeFields(d, {}),
              d.outletId,
              this.storedLines(d),
            ),
            sizeBaseline: await this.storedSize(d.id),
          },
          `staff:${ctx.userId}`,
        ),
        billError: null,
      };
    } catch (err) {
      return {
        bill: null,
        billError:
          err instanceof Error ? err.message : 'This draft could not be priced',
      };
    }
  }

  // The headline figures (numbers, as before custom orders) from a bill; a
  // finished draft without a bill reads its order's total.
  private headline(
    d: AssembledDraft,
    bill: Bill | null,
    orderTotal: string | null,
  ) {
    const stored = d.items.reduce(
      (s, i) => s + Number(i.price) * i.quantity,
      0,
    );
    return {
      subtotal: bill ? Number(bill.subtotal) : stored,
      discountAmount: bill ? Number(bill.discount.amount) : 0,
      total:
        bill?.total != null
          ? Number(bill.total)
          : orderTotal !== null
            ? Number(orderTotal)
            : null,
    };
  }

  private async toListItem(ctx: TenantContext, d: AssembledDraft) {
    const { bill } = await this.billFor(ctx, d);
    const orderRows = d.convertedOrderId
      ? await this.db.query<RowDataPacket[]>(
          `SELECT total FROM \`order\` WHERE id = ? AND shopId = ?`,
          [d.convertedOrderId, ctx.shopId],
        )
      : [];
    return {
      id: d.id,
      status: d.status,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      outlet: { id: d.outletId, name: d.outletName },
      currency: d.currency,
      itemCount: d.items.length,
      ...this.headline(
        d,
        bill,
        (orderRows[0]?.total as string | undefined) ?? null,
      ),
      hasPayLink:
        Boolean(d.payToken) &&
        (d.status === 'INVOICE_SENT' || d.status === 'AWAITING_PAYMENT'),
      convertedOrderId: d.convertedOrderId,
      createdBy: d.createdByUserId
        ? { id: d.createdByUserId, name: d.createdByName }
        : null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private async toDetail(ctx: TenantContext, d: AssembledDraft) {
    const shop = await this.shopRow(ctx.shopId);
    const snapshot = d.snapshotJson as DraftSnapshot | null;
    const { bill, billError } = await this.billFor(ctx, d);
    const history = await this.db.query<RowDataPacket[]>(
      `SELECT id, shopOrderNumber, status, paymentStatus, total, currency, adminSource, trackingToken, createdAt
         FROM \`order\` WHERE shopId = ? AND draftOrderId = ? ORDER BY id DESC`,
      [ctx.shopId, d.id],
    );
    const cardAvailable = await this.cardAvailable(ctx.shopId);
    return {
      id: d.id,
      status: d.status,
      outletId: d.outletId,
      outlet: { id: d.outletId, name: d.outletName },
      currency: d.currency,
      customerId: d.customerId,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerEmail: d.customerEmail,
      customerAddress: d.customerAddress,
      regionId: d.regionId,
      region: d.region,
      area: d.area,
      orderType: d.orderType ?? 'delivery',
      deliveryDate: d.deliveryDate,
      deliveryTimeSlot: d.deliveryTimeSlot,
      receiverName: d.receiverName,
      receiverPhone: d.receiverPhone,
      receiverMessage: d.receiverMessage,
      discountCode: d.discountCode,
      orderDiscountType: d.orderDiscountType,
      orderDiscountValue: trimDecimal(d.orderDiscountValue),
      orderDiscountReason: d.orderDiscountReason,
      deliveryFeeOverride: trimDecimal(d.deliveryFeeOverride),
      deliveryFeeOverrideReason: d.deliveryFeeOverrideReason,
      notes: d.notes,
      customerNote: d.customerNote,
      items: d.items.map((i) => ({
        id: i.id,
        productId: i.isCustom ? null : i.productId,
        productName: i.productName,
        thumbnail: i.isCustom ? null : i.thumbnail,
        variantId: i.variantId,
        variantLabel: i.variantId
          ? buildVariantLabel([i.optionValue1, i.optionValue2, i.optionValue3])
          : null,
        quantity: i.quantity,
        price: trimDecimal(i.price),
        isCustom: i.isCustom,
        taxable: i.taxable,
        priceOverrideReason: i.priceOverrideReason,
      })),
      bill,
      billError,
      billLocked: Boolean(snapshot),
      ...this.headline(
        d,
        bill,
        (history.find((o) => o.id === d.convertedOrderId)?.total as
          string | undefined) ?? null,
      ),
      payLink:
        d.payToken &&
        (d.status === 'INVOICE_SENT' || d.status === 'AWAITING_PAYMENT')
          ? {
              url: this.payUrl(shop, d.payToken),
              sentAt: d.payLinkSentAt,
              expiresAt: d.payLinkExpiresAt,
              lockedAt: d.snapshotAt,
            }
          : null,
      cardAvailable,
      convertedOrderId: d.convertedOrderId,
      // The order the draft currently points at (its latest conversion).
      convertedOrder: (() => {
        const o = history.find((h) => h.id === d.convertedOrderId);
        return o
          ? {
              id: o.id as number,
              shopOrderNumber: o.shopOrderNumber as number,
              status: o.status as string,
              paymentStatus: o.paymentStatus as string,
              total: trimDecimal(o.total as string),
              trackingToken: o.trackingToken as string,
            }
          : null;
      })(),
      orders: history.map((o) => ({
        id: o.id as number,
        shopOrderNumber: o.shopOrderNumber as number,
        status: o.status as string,
        paymentStatus: o.paymentStatus as string,
        total: trimDecimal(o.total as string),
        currency: o.currency as string,
        adminSource: o.adminSource as string | null,
        createdAt: o.createdAt as Date,
      })),
      createdBy: d.createdByUserId
        ? { id: d.createdByUserId, name: d.createdByName }
        : null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }
}
