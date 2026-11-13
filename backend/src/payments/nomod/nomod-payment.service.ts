import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { isDuplicateKeyError } from '../../database/mysql-errors';
import { FeaturesService } from '../../features/features.service';
import { OrderNotificationsService } from '../../orders/order-notifications.service';
import { createLogger } from '../../common/logging/logger';
import { amountDueMinor } from '../../common/amount-due';
import { normalizePhoneToE164 } from '../../common/phone';
import { toMinorUnits } from '../../common/currency-minor-units';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
} from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import {
  PaymentCurrencyNotSupportedException,
  isGatewayCurrencyBlocked,
} from '../blocked-gateway-currencies';
import type { NomodcheckoutRow } from '../../db/types';
import {
  NomodApiError,
  NomodClient,
  type NomodCredentials,
} from './nomod-client';
import {
  NomodAmountError,
  type NomodAmounts,
  buildNomodAmounts,
  nomodReferenceId,
  type NomodOrderSnapshot,
} from './nomod-money';
import { exactMinor } from './nomod-events';

const logger = createLogger('NomodPaymentService');

export function nomodCredentials(
  raw: Record<string, string> | null | undefined,
): NomodCredentials | null {
  const apiKey = raw?.apiKey?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: raw?.baseUrl?.trim() || null };
}

// What an observed (webhook or GET) payment is checked against before an order may
// be marked paid. The order's CURRENT amount due must equal what we asked Nomod to
// charge, and Nomod must report that same amount in that same currency.
export type PaymentVerdict = { ok: true } | { ok: false; reason: string };

export function verifyObservedPayment(
  row: Pick<NomodcheckoutRow, 'amountMinor' | 'currency'>,
  order: Record<string, unknown>,
  observed: { currency: string | null; totalMinor: number | null },
): PaymentVerdict {
  const rowCurrency = row.currency.toUpperCase();
  const orderCurrency = String(
    (order.currency as string | null | undefined) ?? '',
  ).toUpperCase();
  if (rowCurrency !== orderCurrency) {
    return { ok: false, reason: 'order_currency_changed' };
  }
  if (!observed.currency) return { ok: false, reason: 'currency_missing' };
  if (observed.currency.toUpperCase() !== rowCurrency) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (observed.totalMinor === null)
    return { ok: false, reason: 'amount_missing' };
  // The row's amount is a BIGINT: mysql2 may hand it back as a string.
  const asked = Number(row.amountMinor);
  if (observed.totalMinor !== asked)
    return { ok: false, reason: 'amount_mismatch' };
  if (amountDueMinor(order) !== asked) {
    return { ok: false, reason: 'order_amount_changed' };
  }
  return { ok: true };
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: 'Customer', last: '-' };
  if (parts.length === 1) return { first: parts[0], last: '-' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Adds a flag to a return URL without disturbing what is already in it.
export function withQuery(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}

@Injectable()
export class NomodPaymentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    private readonly notifications: OrderNotificationsService,
    private readonly client: NomodClient,
  ) {}

  // Creates a Nomod hosted checkout for an order and records it. Called by the
  // provider (and so by both the storefront checkout and the payment-link path),
  // never in a transaction. Throws on any failure; the caller releases its lease.
  async createCheckout(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    const creds = nomodCredentials(params.credentials);
    if (!creds || !params.credentials?.webhookSecret?.trim()) {
      throw new PaymentProviderNotConfiguredException('Nomod');
    }
    if (isGatewayCurrencyBlocked('nomod', params.currency)) {
      throw new PaymentCurrencyNotSupportedException('nomod', params.currency);
    }
    const shopId = params.shopId;
    if (!shopId) {
      throw new InternalServerErrorException('Nomod checkout needs a shop');
    }
    // The platform grant. Checked here, inside the provider path, so no caller can
    // reach Nomod around it.
    if (!(await this.features.isEnabled(shopId, 'nomod_payments'))) {
      throw new PaymentProviderNotConfiguredException('Nomod');
    }

    const { snapshot, customer } = await this.loadSnapshot(
      shopId,
      params.orderId,
    );
    let amounts: NomodAmounts;
    try {
      amounts = buildNomodAmounts(snapshot);
    } catch (err) {
      if (err instanceof NomodAmountError) {
        logger.error('nomod amounts could not be reconciled', {
          orderId: params.orderId,
          shopId,
          reason: err.message,
        });
        throw new InternalServerErrorException(
          'The payment could not be prepared for this order',
        );
      }
      throw err;
    }
    // The amount the caller is asking for and the amount we are about to send must
    // be the same figure, to the minor unit. Never send a mismatched amount.
    if (
      snapshot.currency.toUpperCase() !== params.currency.toUpperCase() ||
      amounts.amountMinor !== toMinorUnits(params.amount, params.currency)
    ) {
      logger.error('nomod amount differs from the amount requested', {
        orderId: params.orderId,
        shopId,
      });
      throw new InternalServerErrorException(
        'The payment could not be prepared for this order',
      );
    }

    const row = await this.reserveCheckout(
      shopId,
      params.orderId,
      amounts.amountMinor,
      amounts.currency,
    );

    try {
      const res = await this.client.createCheckout(
        creds,
        {
          referenceId: row.referenceId,
          amounts,
          customer,
          successUrl: params.successUrl,
          failureUrl: withQuery(params.cancelUrl, 'payment', 'failed'),
          cancelledUrl: withQuery(params.cancelUrl, 'payment', 'cancelled'),
          metadata: {
            orderid: String(params.orderId),
            ordernumber: String(params.orderNumber),
          },
        },
        params.signal,
      );
      await this.db.execute(
        `UPDATE nomodcheckout SET checkoutId = ?, status = 'created' WHERE id = ? AND shopId = ?`,
        [res.id, row.id, shopId],
      );
      return { providerReference: res.id, checkoutUrl: res.url };
    } catch (err) {
      // An ambiguous failure (timeout, 5xx) may have created the checkout on Nomod's
      // side; the row stays so a payment on it can still be matched by reference.
      // A definite refusal is closed.
      const ambiguous = !(err instanceof NomodApiError) || err.ambiguous;
      await this.db
        .execute(
          `UPDATE nomodcheckout SET status = ? WHERE id = ? AND shopId = ? AND status = 'creating'`,
          [ambiguous ? 'creating' : 'failed', row.id, shopId],
        )
        .catch(() => undefined);
      logger.warn('nomod checkout creation failed', {
        orderId: params.orderId,
        shopId,
        status: err instanceof NomodApiError ? err.status : null,
        ambiguous,
      });
      throw err;
    }
  }

  // Reserves the next reference_id for an order. The unique (shopId, referenceId)
  // index is the arbiter: two concurrent creators cannot get the same one.
  private async reserveCheckout(
    shopId: number,
    orderId: number,
    amountMinor: number,
    currency: string,
  ): Promise<NomodcheckoutRow> {
    for (let i = 0; i < 4; i++) {
      const last = await this.db.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(attempt), 0) AS n FROM nomodcheckout WHERE shopId = ? AND orderId = ?`,
        [shopId, orderId],
      );
      const attempt = Number(last[0].n) + 1;
      const referenceId = nomodReferenceId(orderId, attempt);
      try {
        const res = await this.db.execute(
          `INSERT INTO nomodcheckout (shopId, orderId, attempt, referenceId, amountMinor, currency, status)
           VALUES (?, ?, ?, ?, ?, ?, 'creating')`,
          [shopId, orderId, attempt, referenceId, amountMinor, currency],
        );
        return {
          id: res.insertId,
          shopId,
          orderId,
          attempt,
          referenceId,
          checkoutId: null,
          amountMinor,
          currency,
          status: 'creating',
        } as NomodcheckoutRow;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
      }
    }
    throw new InternalServerErrorException(
      'Could not reserve a Nomod reference',
    );
  }

  // The order's frozen figures and its customer, shop-scoped.
  async loadSnapshot(
    shopId: number,
    orderId: number,
  ): Promise<{
    snapshot: NomodOrderSnapshot;
    customer: Record<string, string>;
  }> {
    const orders = await this.db.query<RowDataPacket[]>(
      `SELECT o.currency, o.total, o.deliveryFee, o.taxAmount, o.discountAmount,
              o.giftCardAmount, o.storeCreditAmount, o.customerName, o.customerEmail,
              o.customerPhone, s.countryCode
         FROM \`order\` o JOIN shop s ON s.id = o.shopId
        WHERE o.id = ? AND o.shopId = ?`,
      [orderId, shopId],
    );
    const o = orders[0];
    if (!o) {
      throw new InternalServerErrorException('Order not found for payment');
    }
    const lines = await this.db.query<RowDataPacket[]>(
      `SELECT id, productName, variantLabel, quantity, priceAtPurchase
         FROM orderitem WHERE orderId = ? ORDER BY id ASC`,
      [orderId],
    );
    const snapshot: NomodOrderSnapshot = {
      currency: o.currency as string,
      total: String(o.total),
      deliveryFee: o.deliveryFee === null ? null : String(o.deliveryFee),
      taxAmount: o.taxAmount === null ? null : String(o.taxAmount),
      discountAmount:
        o.discountAmount === null ? null : String(o.discountAmount),
      giftCardAmount:
        o.giftCardAmount === null ? null : String(o.giftCardAmount),
      storeCreditAmount:
        o.storeCreditAmount === null ? null : String(o.storeCreditAmount),
      lines: lines.map((l) => ({
        id: l.id as number,
        name: l.variantLabel
          ? `${l.productName as string} - ${l.variantLabel as string}`
          : (l.productName as string),
        quantity: l.quantity as number,
        unitPrice: String(l.priceAtPurchase),
      })),
    };

    const { first, last } = splitName((o.customerName as string) ?? '');
    const customer: Record<string, string> = {
      first_name: first,
      last_name: last,
    };
    const email = (o.customerEmail as string | null)?.trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      customer.email = email;
    }
    // Only a number that normalises to E.164 is sent: a malformed phone must never
    // be the reason a checkout is refused.
    const phone = o.customerPhone
      ? normalizePhoneToE164(
          o.customerPhone as string,
          o.countryCode as string | null,
        )
      : null;
    if (phone) customer.phone_number = phone;
    return { snapshot, customer };
  }

  async findByReference(
    shopId: number,
    referenceId: string,
  ): Promise<NomodcheckoutRow | null> {
    const rows = await this.db.query<(NomodcheckoutRow & RowDataPacket)[]>(
      `SELECT * FROM nomodcheckout WHERE shopId = ? AND referenceId = ?`,
      [shopId, referenceId],
    );
    return rows[0] ?? null;
  }

  async findByCheckoutId(checkoutId: string): Promise<NomodcheckoutRow | null> {
    const rows = await this.db.query<(NomodcheckoutRow & RowDataPacket)[]>(
      `SELECT * FROM nomodcheckout WHERE checkoutId = ? ORDER BY id DESC LIMIT 1`,
      [checkoutId],
    );
    return rows[0] ?? null;
  }

  async loadOrderForVerification(
    shopId: number,
    orderId: number,
  ): Promise<RowDataPacket | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, shopId, status, paymentStatus, currency, total, giftCardAmount, storeCreditAmount
         FROM \`order\` WHERE id = ? AND shopId = ?`,
      [orderId, shopId],
    );
    return rows[0] ?? null;
  }

  // Parks a payment that did not match the order: the order is NOT marked paid, the
  // row says why, and the merchant is told once.
  async markReview(row: NomodcheckoutRow, reason: string): Promise<void> {
    await this.db.execute(
      `UPDATE nomodcheckout SET status = 'review', reviewReason = ? WHERE id = ? AND shopId = ? AND status <> 'paid'`,
      [reason.slice(0, 100), row.id, row.shopId],
    );
    logger.error('nomod payment needs review, order not marked paid', {
      orderId: row.orderId,
      shopId: row.shopId,
      reason,
    });
    await this.notifications
      .alertPaymentNeedsReview(row.shopId, row.orderId, reason)
      .catch(() => undefined);
  }

  // Asks Nomod what became of a checkout (GET /v1/checkout/{id}) and checks a PAID
  // answer against the order. The shared core of the return-page confirmation, the
  // reconciliation sweep and the webhook fallback.
  async inspect(
    row: NomodcheckoutRow,
    rawCredentials: Record<string, string> | null,
  ): Promise<
    | { kind: 'paid' }
    | { kind: 'unpaid' }
    | { kind: 'expired' }
    | { kind: 'cancelled' }
    | { kind: 'review'; reason: string }
  > {
    const creds = nomodCredentials(rawCredentials);
    if (!creds || !row.checkoutId) return { kind: 'unpaid' };
    const res = await this.client.getCheckout(creds, row.checkoutId);
    await this.db
      .execute(`UPDATE nomodcheckout SET lastCheckedAt = NOW(3) WHERE id = ?`, [
        row.id,
      ])
      .catch(() => undefined);
    const status = (res.status ?? '').toLowerCase();
    if (status === 'paid') {
      const order = await this.loadOrderForVerification(
        row.shopId,
        row.orderId,
      );
      if (!order) return { kind: 'unpaid' };
      const currency = res.currency ? res.currency.toUpperCase() : null;
      const verdict = verifyObservedPayment(row, order, {
        currency,
        totalMinor: exactMinor(res.amount, currency),
      });
      if (!verdict.ok) {
        await this.markReview(row, verdict.reason);
        return { kind: 'review', reason: verdict.reason };
      }
      return { kind: 'paid' };
    }
    if (status === 'expired') return { kind: 'expired' };
    if (status === 'cancelled') return { kind: 'cancelled' };
    return { kind: 'unpaid' };
  }
}
