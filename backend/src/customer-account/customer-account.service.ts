import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { buildSetClause } from '../database/update.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerRow } from '../db/types';
import type { CustomerContext } from '../customer-auth/customer-context';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateOpaqueToken, hashToken } from '../common/token-hash';

// UAE PDPL: max one data-export request per customer per rolling 24h
// window — a courtesy/anti-abuse rate limit, not a hard security boundary,
// so a plain read-then-write check (not a CAS) is enough; the worst case
// under a race is two exports going out within the same narrow window.
const EXPORT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;
// Two-step delete (see requestDeletion/confirmDeletion): short-lived so a
// confirmationToken issued but never acted on can't be replayed much later.
const DELETION_TOKEN_LIFETIME_MINUTES = 10;

export interface CustomerAddress {
  id: string;
  label?: string;
  address: string;
  emirate: string;
  area?: string;
  latitude?: number;
  longitude?: number;
}

interface OrderWithItems extends RowDataPacket {
  id: number;
  status: string;
  orderType: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
  outletName: string;
  deliveryDate: Date | null;
  deliveryTimeSlot: string | null;
  customerAddress: string;
  deliveryFee: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  total: string;
  trackingToken: string | null;
  createdAt: Date;
  orderitem: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceAtPurchase: string;
  }[];
}

@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly db: DatabaseService,
    private readonly invoicesService: InvoicesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  getInvoiceHtml(ctx: CustomerContext, orderId: number) {
    return this.invoicesService.renderHtmlForCustomerOrder(
      ctx.shopId,
      ctx.customerId,
      orderId,
    );
  }

  async getProfile(ctx: CustomerContext) {
    const customer = await this.findCustomerOrThrow(ctx.customerId);
    return this.toProfileResponse(customer);
  }

  async updateProfile(ctx: CustomerContext, dto: UpdateProfileDto) {
    try {
      const set = buildSetClause({
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
      });
      if (set) {
        await this.db.execute(`UPDATE customer SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          ctx.customerId,
        ]);
      }
      const customer = await this.findCustomerOrThrow(ctx.customerId);
      return this.toProfileResponse(customer);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'Another account with this phone number already exists',
        );
      }
      throw error;
    }
  }

  // UAE PDPL data export — every piece of PII this shop holds for the
  // requesting customer, strictly scoped to (ctx.customerId, ctx.shopId):
  // the same phone/email on a different shop is a genuinely different
  // customer row (see the [shopId, phone] unique index), never included
  // here. Read-only — never generates or changes anything the customer
  // couldn't already see via the other account endpoints, just bundles it
  // into one downloadable file.
  async exportData(ctx: CustomerContext) {
    const customer = await this.findCustomerOrThrow(ctx.customerId);
    if (
      customer.lastDataExportAt &&
      Date.now() - (customer.lastDataExportAt as Date).getTime() < EXPORT_RATE_LIMIT_MS
    ) {
      const retryAt = new Date(
        (customer.lastDataExportAt as Date).getTime() + EXPORT_RATE_LIMIT_MS,
      );
      throw new BadRequestException(
        `You can request your data once every 24 hours — try again after ${retryAt.toISOString()}`,
      );
    }

    const orders = await this.fetchOrdersWithItems(ctx.customerId, ctx.shopId);

    await this.db.execute(`UPDATE customer SET lastDataExportAt = ? WHERE id = ?`, [
      new Date(),
      ctx.customerId,
    ]);
    await this.logCustomerAction(
      ctx.shopId,
      ctx.customerId,
      'CUSTOMER_DATA_EXPORT',
    );

    return {
      exportedAt: new Date().toISOString(),
      profile: this.toProfileResponse(customer),
      addresses: (customer.addresses as CustomerAddress[] | null) ?? [],
      orders: orders.map((o) => this.toOrderSummary(o, false)),
    };
  }

  // Step 1 of 2 — issues a short-lived confirmationToken rather than
  // deleting immediately, so a single stray/CSRF'd DELETE call can't
  // anonymise an account outright; the caller must present this same token
  // back to confirmDeletion within DELETION_TOKEN_LIFETIME_MINUTES. Reuses
  // `customerauthtoken` (same opaque-token + hash-at-rest + single-use-CAS
  // shape as password-reset) with its own 'account_deletion' purpose,
  // rather than a new table.
  async requestDeletion(ctx: CustomerContext) {
    const customer = await this.findCustomerOrThrow(ctx.customerId);
    if (this.isAnonymised(customer)) {
      return { alreadyDeleted: true as const };
    }

    const raw = generateOpaqueToken();
    await this.db.execute(
      `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        ctx.customerId,
        'account_deletion',
        hashToken(raw),
        new Date(Date.now() + DELETION_TOKEN_LIFETIME_MINUTES * 60 * 1000),
      ],
    );
    return {
      alreadyDeleted: false as const,
      confirmationToken: raw,
      expiresInMinutes: DELETION_TOKEN_LIFETIME_MINUTES,
    };
  }

  // Step 2 of 2 — executes the anonymisation. Idempotent: calling this
  // again on an already-anonymised customer (a second confirm click, a
  // retried request) is a no-op success rather than an error — in practice
  // this is also enforced one layer up by CustomerAuthGuard itself, since
  // anonymisation clears passwordHash and every bearer token for this
  // customer stops authenticating immediately (see anonymiseCustomer's own
  // comment), but this check keeps the service safe to call directly too.
  async confirmDeletion(ctx: CustomerContext, token: string) {
    const customer = await this.findCustomerOrThrow(ctx.customerId);
    if (this.isAnonymised(customer)) {
      return { success: true as const };
    }

    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM customerauthtoken WHERE tokenHash = ?`,
      [hashToken(token)],
    );
    const stored = storedRows[0];
    if (
      !stored ||
      stored.purpose !== 'account_deletion' ||
      stored.customerId !== ctx.customerId ||
      (stored.expiresAt as Date) < new Date()
    ) {
      throw new BadRequestException(
        'This confirmation link is invalid or has expired',
      );
    }
    // Single-use CAS, same pattern as CustomerAuthService.resetPassword —
    // a second delivery of the same token (double-click, retry) can't
    // re-run the anonymisation twice.
    const claimed = await this.db.execute(
      `UPDATE customerauthtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException(
        'This confirmation link has already been used',
      );
    }

    await this.anonymiseCustomer(ctx.shopId, ctx.customerId);
    return { success: true as const };
  }

  private isAnonymised(customer: { email: string | null }): boolean {
    return customer.email?.endsWith('@deleted.requital') ?? false;
  }

  // Anonymises, not hard-deletes — orders/draftorder/giftcard/
  // discountredemption rows keep their real customerId FK pointing at this
  // now-scrubbed row (merchant order-history records are explicitly out of
  // scope for this deletion, per the task), only the customer's own PII is
  // scrubbed.
  private async anonymiseCustomer(shopId: number, customerId: number) {
    await this.db.execute(
      `UPDATE customer SET name = ?, email = ?, phone = ?, birthday = NULL, addresses = NULL, passwordHash = NULL WHERE id = ?`,
      [
        'Deleted User',
        // Derived from the customer's own (globally unique) id, not a
        // fresh randomUUID() per call — this is what makes anonymisation
        // itself idempotent. confirmDeletion already guards against a
        // normal second call via isAnonymised(), but a random value here
        // would still mean two genuinely concurrent writes (e.g. two
        // outstanding confirmationTokens for the same customer, both
        // confirmed around the same moment, both passing the pre-write
        // isAnonymised() check before either has written yet) leave the
        // row in a different final state depending on write order, and
        // double the audit-log entries. A stable, id-derived value means
        // every call — racing or retried — converges on the exact same
        // result.
        `deleted-${customerId}@deleted.requital`,
        // `phone` is NOT NULL and part of the @@unique([shopId, phone])
        // index — a literal null isn't possible without widening the
        // column (a real schema change, out of proportion for this task).
        // customerId is a global autoincrement id (not scoped per shop),
        // so this is guaranteed unique across every shop's [shopId, phone]
        // rows too, same reasoning as the email above.
        `DELETED-${customerId}`,
        customerId,
      ],
    );
    await this.db.execute(
      `UPDATE customerrefreshtoken SET revokedAt = ? WHERE customerId = ? AND revokedAt IS NULL`,
      [new Date(), customerId],
    );
    // Any outstanding password-reset/deletion-confirmation tokens for this
    // customer are dead the moment the account is gone.
    await this.db.execute(
      `UPDATE customerauthtoken SET usedAt = ? WHERE customerId = ? AND usedAt IS NULL`,
      [new Date(), customerId],
    );
    await this.logCustomerAction(shopId, customerId, 'CUSTOMER_DATA_DELETION');
  }

  // AuditLog.actorUserId is a required FK to `user` (staff) — there's no
  // actor-is-a-customer shape in that schema, so a customer-triggered
  // action is attributed to the shop's own admin (every shop always has at
  // least one — the last remaining admin can never be demoted/deleted),
  // same synthesized-system-actor pattern as
  // PaymentsService.applyAdvanceOrderStatus. metadata makes clear in the
  // audit trail that the admin didn't personally do this.
  private async logCustomerAction(
    shopId: number,
    customerId: number,
    action: 'CUSTOMER_DATA_EXPORT' | 'CUSTOMER_DATA_DELETION',
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    const admin = rows[0];
    if (!admin) return;
    await this.auditLogService.log(
      { shopId, actorUserId: admin.id as number },
      {
        action,
        entityType: 'customer',
        entityId: customerId,
        metadata: { triggeredBy: 'customer-self-service' },
      },
    );
  }

  // Not outlet-scoped — a customer's order history spans every branch of
  // this shop they've ordered from, same as the admin CRM's per-customer
  // order list (CustomersService.findOne).
  async listOrders(ctx: CustomerContext) {
    const orders = await this.fetchOrdersWithItems(ctx.customerId, ctx.shopId);
    // One query for every order's invoice existence rather than N+1 —
    // "Download Invoice" only ever renders for the storefront-facing
    // INVOICE type, never PACKING_SLIP (that stays admin/courier-only).
    const invoicedOrderIds = await this.invoicedOrderIds(
      orders.map((o) => o.id),
    );
    return orders.map((o) =>
      this.toOrderSummary(o, invoicedOrderIds.has(o.id)),
    );
  }

  // customerId AND shopId both in the WHERE — an id belonging to another
  // customer (even one in this same shop) or another shop entirely simply
  // doesn't match, and returns the same 404 either way, never leaking which
  // case it was.
  async getOrder(ctx: CustomerContext, id: number) {
    const orders = await this.fetchOrdersWithItems(ctx.customerId, ctx.shopId, id);
    const order = orders[0];
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const invoicedOrderIds = await this.invoicedOrderIds([order.id]);
    return this.toOrderSummary(order, invoicedOrderIds.has(order.id));
  }

  // Two queries (orders+outlet, then their items keyed by orderId) rather
  // than one multi-JOIN — orderitem is a one-to-many relation per order, so
  // joining it directly would fan out the order/outlet columns across
  // however many line items each order has.
  private async fetchOrdersWithItems(
    customerId: number,
    shopId: number,
    onlyOrderId?: number,
  ): Promise<OrderWithItems[]> {
    const conditions = ['o.customerId = ?', 'o.shopId = ?'];
    const params: number[] = [customerId, shopId];
    if (onlyOrderId !== undefined) {
      conditions.push('o.id = ?');
      params.push(onlyOrderId);
    }
    const orders = await this.db.query<RowDataPacket[]>(
      `SELECT o.*, otl.name AS outletName
       FROM \`order\` o
       JOIN outlet otl ON otl.id = o.outletId
       WHERE ${conditions.join(' AND ')}
       ORDER BY o.createdAt DESC`,
      params,
    );
    if (orders.length === 0) return [];

    const orderIds = orders.map((o) => o.id as number);
    const items = await this.db.query<RowDataPacket[]>(
      `SELECT orderId, productName, variantLabel, quantity, priceAtPurchase
       FROM orderitem WHERE orderId IN (${orderIds.map(() => '?').join(', ')})`,
      orderIds,
    );
    const itemsByOrder = new Map<number, OrderWithItems['orderitem']>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orderId as number) ?? [];
      list.push({
        productName: item.productName as string,
        variantLabel: item.variantLabel as string | null,
        quantity: item.quantity as number,
        priceAtPurchase: item.priceAtPurchase as string,
      });
      itemsByOrder.set(item.orderId as number, list);
    }

    return orders.map(
      (o) =>
        ({
          ...o,
          outletName: o.outletName as string,
          orderitem: itemsByOrder.get(o.id as number) ?? [],
        }) as OrderWithItems,
    );
  }

  private async invoicedOrderIds(orderIds: number[]): Promise<Set<number>> {
    if (orderIds.length === 0) return new Set();
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT orderId FROM invoice WHERE orderId IN (${orderIds.map(() => '?').join(', ')}) AND type = 'INVOICE'`,
      orderIds,
    );
    return new Set(rows.map((r) => r.orderId as number));
  }

  async listAddresses(ctx: CustomerContext): Promise<CustomerAddress[]> {
    const customer = await this.findCustomerOrThrow(ctx.customerId);
    return (customer.addresses as CustomerAddress[] | null) ?? [];
  }

  async createAddress(
    ctx: CustomerContext,
    dto: SaveAddressDto,
  ): Promise<CustomerAddress> {
    const addresses = await this.listAddresses(ctx);
    const address: CustomerAddress = { id: randomUUID().slice(0, 8), ...dto };
    await this.db.execute(`UPDATE customer SET addresses = ? WHERE id = ?`, [
      JSON.stringify([...addresses, address]),
      ctx.customerId,
    ]);
    return address;
  }

  async updateAddress(
    ctx: CustomerContext,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<CustomerAddress> {
    const addresses = await this.listAddresses(ctx);
    const index = addresses.findIndex((a) => a.id === addressId);
    if (index === -1) {
      throw new NotFoundException(`Address ${addressId} not found`);
    }
    const updated: CustomerAddress = { ...addresses[index], ...dto };
    addresses[index] = updated;
    await this.db.execute(`UPDATE customer SET addresses = ? WHERE id = ?`, [
      JSON.stringify(addresses),
      ctx.customerId,
    ]);
    return updated;
  }

  async deleteAddress(ctx: CustomerContext, addressId: string) {
    const addresses = await this.listAddresses(ctx);
    if (!addresses.some((a) => a.id === addressId)) {
      throw new NotFoundException(`Address ${addressId} not found`);
    }
    const next = addresses.filter((a) => a.id !== addressId);
    await this.db.execute(`UPDATE customer SET addresses = ? WHERE id = ?`, [
      JSON.stringify(next),
      ctx.customerId,
    ]);
    return { id: addressId, deleted: true };
  }

  private async findCustomerOrThrow(
    customerId: number,
  ): Promise<CustomerRow & RowDataPacket> {
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ?`,
      [customerId],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    return rows[0];
  }

  private toProfileResponse(customer: {
    id: number;
    shopId: number;
    name: string;
    phone: string;
    email: string | null;
    emailVerified: boolean;
    registeredAt: Date | null;
    createdAt: Date;
  }) {
    const {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified,
      registeredAt,
      createdAt,
    } = customer;
    return {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified,
      registeredAt,
      createdAt,
    };
  }

  private toOrderSummary(order: OrderWithItems, hasInvoice: boolean) {
    return {
      id: order.id,
      status: order.status,
      orderType: order.orderType,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      outletName: order.outletName,
      deliveryDate: order.deliveryDate,
      deliveryTimeSlot: order.deliveryTimeSlot,
      customerAddress: order.customerAddress,
      items: order.orderitem,
      deliveryFee: order.deliveryFee,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      total: order.total,
      trackingToken: order.trackingToken,
      createdAt: order.createdAt,
      hasInvoice,
    };
  }
}
