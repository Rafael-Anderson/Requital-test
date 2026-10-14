import type { RowDataPacket } from 'mysql2/promise';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import { TRACKING_TOKEN_SHAPE } from '../common/token-hash';
import { decimalToMinor, minorToDecimal } from '../drivers/cash';
import { amountDueDecimal } from '../common/amount-due';
import { orderIsTaxInclusive } from '../returns/return-refund';
import { ONLINE_PAYMENT_METHODS } from '../reports/attribution-report';

// The ONE shape a customer holding an order's tracking token may read. It is
// built field by field (never by spreading a row) so a column added to `order`
// later cannot leak through it: no notes, cost, staff, attribution, gateway
// session ids, payment-link token, customer phone/email or any other
// customer's data. Mirrored by hand in storefront/lib/types.ts
// (OrderLookupResult).
export interface PublicOrderView {
  // Kept for the tracking page's own "is this mine" check against the
  // customer-scoped endpoint. The number a human is shown is shopOrderNumber.
  id: number;
  shopOrderNumber: number;
  shopName: string;
  outletName: string;
  customerName: string;
  status: string;
  orderType: string | null;
  createdAt: Date;
  // Payment. paymentStatus is the SERVER's word: a query string on the page is
  // never evidence of payment.
  paymentMethod: string | null;
  paymentStatus: string;
  // True when the payment method is an online one (a card/BNPL gateway), so a
  // still-unpaid order is "waiting for the gateway" rather than "pay later".
  onlinePayment: boolean;
  // A gateway reported this order's payment as failed and it is still unpaid.
  paymentFailed: boolean;
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryTimeSlot: string | null;
  estimatedTime: string | null;
  items: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceAtPurchase: string;
    lineTotal: string;
    imageUrl: string | null;
    note: string | null;
  }[];
  // Money: all in `currency`, the ORDER's captured currency.
  currency: string;
  subtotal: string;
  discountCode: string | null;
  discountAmount: string | null;
  deliveryFee: string | null;
  taxAmount: string | null;
  // Inferred from the order's own captured figures (the row records no mode).
  taxInclusive: boolean;
  giftCardAmount: string | null;
  storeCreditAmount: string | null;
  total: string;
  amountDue: string;
  // Where it goes. A delivery order carries the address the customer typed; a
  // pickup order carries the outlet's public location instead.
  deliveryAddress: string | null;
  region: { id: number; nameEn: string; nameAr: string } | null;
  area: string | null;
  pickupLocation: {
    name: string;
    area: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  hasAccount: boolean;
}

// Not shop-scoped by design when `shopSlug` is absent: trackingToken is
// globally unique, so the token alone identifies the order. When a slug IS
// given (the storefront's confirmation page always sends its own), an order of
// a different shop is exactly the same 404 as an unknown token, so a token is
// not readable through another shop's storefront.
export async function lookupOrderView(
  db: DatabaseService,
  token?: string,
  shopSlug?: string,
): Promise<PublicOrderView> {
  // Query params can arrive as arrays (?token=a&token=b); only a string counts.
  if (typeof token !== 'string' || !token.trim()) {
    throw new BadRequestException('A tracking code is required');
  }
  if (shopSlug !== undefined && typeof shopSlug !== 'string') {
    throw new NotFoundException('No order found for that tracking code');
  }
  // Only the two issued shapes (32 hex, or the legacy 10 hex) can match; any
  // other string (including a sequential numeric order id) gets the same 404 as
  // an unknown token, with no DB query.
  const rows = TRACKING_TOKEN_SHAPE.test(token)
    ? await db.query<RowDataPacket[]>(
        `SELECT o.id, o.shopId, o.shopOrderNumber, o.outletId, o.customerId,
                o.customerName, o.customerAddress, o.regionId, o.area,
                DATE_FORMAT(o.deliveryDate, '%Y-%m-%d') AS deliveryDate,
                o.deliveryTimeSlot, o.orderType, o.paymentMethod, o.status,
                o.paymentStatus, o.deliveryFee, o.taxAmount, o.discountCode,
                o.discountAmount, o.giftCardAmount, o.storeCreditAmount,
                o.total, o.currency, o.createdAt,
                s.name AS shopName, s.estimatedDeliveryTimeFrom,
                s.estimatedDeliveryTimeTo, s.estimatedDeliveryTimeUnit,
                s.pickupPreparationTimeMinutes
           FROM \`order\` o JOIN shop s ON s.id = o.shopId
          WHERE o.trackingToken = ? ${shopSlug === undefined ? '' : 'AND s.subdomain = ?'}
          LIMIT 1`,
        shopSlug === undefined ? [token] : [token, shopSlug],
      )
    : [];
  const order = rows[0];
  if (!order) {
    throw new NotFoundException('No order found for that tracking code');
  }
  const shopId = order.shopId as number;
  const currency = order.currency as string;

  const [items, outletRows, customerRows, regionRows, failedRows] =
    await Promise.all([
      // The image is the variant's own when it has one, else the product's
      // first. productimage has no shopId, so the shop is pinned through the
      // product (and the order item can only point at its own shop's product).
      db.query<RowDataPacket[]>(
        `SELECT oi.productName, oi.variantLabel, oi.quantity, oi.priceAtPurchase, oi.note,
                oi.taxRate, oi.taxAmount,
                COALESCE(
                  (SELECT pi.url FROM productvariant pv
                     JOIN product pp ON pp.id = pv.productId AND pp.shopId = ?
                     JOIN productimage pi ON pi.id = pv.imageId AND pi.productId = pv.productId
                    WHERE pv.id = oi.variantId AND pv.productId = oi.productId LIMIT 1),
                  (SELECT pi2.url FROM productimage pi2
                     JOIN product p ON p.id = pi2.productId AND p.shopId = ?
                    WHERE pi2.productId = oi.productId
                    ORDER BY pi2.\`order\` ASC, pi2.id ASC LIMIT 1)
                ) AS imageUrl
           FROM orderitem oi WHERE oi.orderId = ? ORDER BY oi.id ASC`,
        [shopId, shopId, order.id],
      ),
      db.query<RowDataPacket[]>(
        `SELECT name, area, phone, latitude, longitude FROM outlet WHERE id = ? AND shopId = ?`,
        [order.outletId, shopId],
      ),
      // Only for `hasAccount` - never the hash itself, just whether one is set.
      order.customerId !== null
        ? db.query<RowDataPacket[]>(
            `SELECT passwordHash FROM customer WHERE id = ? AND shopId = ?`,
            [order.customerId, shopId],
          )
        : Promise.resolve([] as RowDataPacket[]),
      order.regionId !== null
        ? db.query<RowDataPacket[]>(
            `SELECT id, nameEn, nameAr FROM region WHERE id = ?`,
            [order.regionId],
          )
        : Promise.resolve([] as RowDataPacket[]),
      order.paymentStatus === 'unpaid'
        ? db.query<RowDataPacket[]>(
            `SELECT status FROM paymenttransaction WHERE orderId = ? ORDER BY id DESC LIMIT 1`,
            [order.id],
          )
        : Promise.resolve([] as RowDataPacket[]),
    ]);
  const outlet = outletRows[0];
  const region = regionRows[0];
  const isPickup = order.orderType === 'pickup';
  // A legacy 10-hex (40-bit) token must not unlock the richer data this view
  // added: no address, region/area, item notes, customer name or discount code. Status, items and totals stay.
  const legacyToken = token.length === 10;

  // Exact line totals in minor units of the order's own currency.
  const lineMinor = items.map(
    (i) =>
      (decimalToMinor(i.priceAtPurchase as string, currency) ?? 0) *
      (i.quantity as number),
  );
  const subtotalMinor = lineMinor.reduce((a, b) => a + b, 0);

  const estimatedTime =
    order.orderType === 'delivery'
      ? `${order.estimatedDeliveryTimeFrom}-${order.estimatedDeliveryTimeTo} ${order.estimatedDeliveryTimeUnit}`
      : isPickup
        ? `${order.pickupPreparationTimeMinutes} minutes`
        : null;

  return {
    id: order.id as number,
    // The number the customer is shown (the global id is not).
    shopOrderNumber: order.shopOrderNumber as number,
    shopName: order.shopName as string,
    outletName: (outlet?.name ?? '') as string,
    // Withheld for a legacy token, like the address and item notes.
    customerName: legacyToken ? '' : (order.customerName as string),
    status: order.status as string,
    orderType: order.orderType as string | null,
    createdAt: order.createdAt as Date,
    paymentMethod: order.paymentMethod as string | null,
    paymentStatus: order.paymentStatus as string,
    onlinePayment: ONLINE_PAYMENT_METHODS.includes(
      order.paymentMethod as string,
    ),
    // Only the LATEST gateway report counts: a failure followed by a retry is
    // not a failed order.
    paymentFailed: failedRows[0]?.status === 'failed',
    deliveryDate: order.deliveryDate as string | null,
    deliveryTimeSlot: order.deliveryTimeSlot as string | null,
    estimatedTime,
    items: items.map((i, idx) => ({
      productName: i.productName as string,
      variantLabel: i.variantLabel as string | null,
      quantity: i.quantity as number,
      priceAtPurchase: trimDecimal(i.priceAtPurchase as string),
      lineTotal: trimDecimal(minorToDecimal(lineMinor[idx], currency)),
      imageUrl: (i.imageUrl as string | null) ?? null,
      note: legacyToken ? null : ((i.note as string | null) ?? null),
    })),
    currency,
    subtotal: trimDecimal(minorToDecimal(subtotalMinor, currency)),
    discountCode: legacyToken ? null : (order.discountCode as string | null),
    discountAmount: trimDecimal(order.discountAmount as string | null),
    deliveryFee: trimDecimal(order.deliveryFee as string | null),
    taxAmount: trimDecimal(order.taxAmount as string | null),
    taxInclusive: orderIsTaxInclusive(
      {
        total: order.total as string,
        deliveryFee: order.deliveryFee as string | null,
        discountAmount: order.discountAmount as string | null,
        taxAmount: order.taxAmount as string | null,
      },
      items.map((i) => ({
        id: 0,
        priceAtPurchase: i.priceAtPurchase as string,
        quantity: i.quantity as number,
        taxAmount: i.taxAmount as string | null,
        taxRate: i.taxRate as string | null,
      })),
    ),
    giftCardAmount: trimDecimal(order.giftCardAmount as string | null),
    storeCreditAmount: trimDecimal(order.storeCreditAmount as string | null),
    total: trimDecimal(order.total as string),
    amountDue: trimDecimal(amountDueDecimal(order)),
    deliveryAddress:
      isPickup || legacyToken ? null : (order.customerAddress as string),
    region:
      region && !legacyToken
        ? {
            id: region.id as number,
            nameEn: region.nameEn as string,
            nameAr: region.nameAr as string,
          }
        : null,
    area: legacyToken ? null : ((order.area as string | null) ?? null),
    pickupLocation:
      isPickup && outlet
        ? {
            name: outlet.name as string,
            area: (outlet.area as string | null) ?? null,
            phone: (outlet.phone as string | null) ?? null,
            latitude: (outlet.latitude as number | null) ?? null,
            longitude: (outlet.longitude as number | null) ?? null,
          }
        : null,
    hasAccount: (customerRows[0]?.passwordHash ?? null) != null,
  };
}
