import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';
import { emailAssetUrl } from '../common/email-asset-url';
import { storefrontUrl } from '../common/storefront-url';
import type { OrderEmailData } from './order-email';

// Everything a customer order email needs, read from the order's own captured
// columns. Every query is pinned by shopId (and the order id), so a caller can
// never load another shop's order through this path. Returns null when the order
// is not this shop's.
//
// TRACKING LINK. The Track button points at the storefront confirmation page
// /orders/<trackingToken>. The token is the order's 128-bit random
// trackingToken (never the sequential id or the per-shop number), the page needs
// no login, and the URL is built by storefrontUrl() so it is the shop's own
// subdomain or its VERIFIED custom domain. An order with no token gets no link.

// The one place the Track URL is built. Only a token of the shape the order
// lookup itself accepts (32 hex, or a legacy 10 hex) is linked; anything else
// yields no link rather than a URL that cannot work.
export function trackingLink(
  token: string | null,
  shop: {
    subdomain: string;
    domainType: string | null;
    customDomain: string | null;
    customDomainStatus: string | null;
  },
): string | null {
  if (typeof token !== 'string') return null;
  if (!/^[0-9A-Fa-f]{10}$|^[0-9A-Fa-f]{32}$/.test(token)) return null;
  return storefrontUrl(shop, `/orders/${token}`);
}

function formatDateTime(date: Date, timeZone: string, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
      date,
    );
  }
}

function formatDateKey(key: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export async function loadOrderEmailData(
  db: Pick<DatabaseService, 'query'>,
  shopId: number,
  orderId: number,
): Promise<OrderEmailData | null> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT o.id, o.shopId, o.shopOrderNumber, o.outletId, o.customerName,
            o.customerPhone, o.customerEmail, o.receiverName, o.receiverPhone, o.customerAddress, o.regionId,
            o.area, DATE_FORMAT(o.deliveryDate, '%Y-%m-%d') AS deliveryDate,
            o.deliveryTimeSlot, o.deliveryNotes, o.receiverMessage,
            o.orderType, o.paymentMethod, o.paymentStatus, o.deliveryFee,
            o.taxAmount, o.discountCode, o.discountAmount, o.giftCardAmount,
            o.storeCreditAmount, o.total, o.currency, o.createdAt,
            o.trackingToken,
            s.name AS shopName, s.displayName, s.email AS shopEmail,
            s.logoUrl AS shopLogoUrl, s.whatsappCountryCode, s.whatsappNumber,
            s.timezone, s.defaultLanguage, s.subdomain, s.domainType,
            s.customDomain, s.customDomainStatus,
            (SELECT t.logoUrl FROM themesettings t WHERE t.shopId = s.id LIMIT 1) AS themeLogoUrl
       FROM \`order\` o JOIN shop s ON s.id = o.shopId
      WHERE o.id = ? AND o.shopId = ?
      LIMIT 1`,
    [orderId, shopId],
  );
  const o = rows[0];
  if (!o) return null;

  const rtl = o.defaultLanguage === 'ar';
  const locale = rtl ? 'ar-AE-u-nu-latn' : 'en-GB';

  const [items, outletRows, regionRows] = await Promise.all([
    // The image is the variant's own when it has one, else the product's first;
    // productimage has no shopId, so the shop is pinned through the product.
    db.query<RowDataPacket[]>(
      `SELECT oi.productName, oi.variantLabel, oi.quantity, oi.priceAtPurchase, oi.note,
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
      [shopId, shopId, orderId],
    ),
    o.orderType === 'pickup'
      ? db.query<RowDataPacket[]>(
          `SELECT name, nameAr FROM outlet WHERE id = ? AND shopId = ?`,
          [o.outletId, shopId],
        )
      : Promise.resolve([] as RowDataPacket[]),
    o.regionId !== null
      ? db.query<RowDataPacket[]>(
          `SELECT nameEn, nameAr FROM region WHERE id = ?`,
          [o.regionId],
        )
      : Promise.resolve([] as RowDataPacket[]),
  ]);

  const trackUrl = trackingLink(o.trackingToken as string | null, {
    subdomain: o.subdomain as string,
    domainType: o.domainType as string | null,
    customDomain: o.customDomain as string | null,
    customDomainStatus: o.customDomainStatus as string | null,
  });

  const cc = (o.whatsappCountryCode as string | null) ?? '';
  const num = (o.whatsappNumber as string | null) ?? '';
  const shopPhone =
    cc && num ? `+${cc.replace(/\D/g, '')}${num.replace(/\D/g, '')}` : null;
  const region = regionRows[0];
  const outlet = outletRows[0];
  const timeZone = (o.timezone as string | null) ?? 'UTC';

  return {
    orderNumber: o.shopOrderNumber as number,
    createdAtText: formatDateTime(o.createdAt as Date, timeZone, locale),
    currency: o.currency as string,
    orderType: o.orderType as string | null,
    paymentMethod: o.paymentMethod as string | null,
    paymentStatus: o.paymentStatus as string,
    customerName: o.customerName as string,
    customerEmail: o.customerEmail as string | null,
    customerPhone: o.customerPhone as string,
    receiverName: (o.receiverName as string | null) ?? null,
    receiverPhone: (o.receiverPhone as string | null) ?? null,
    address: o.customerAddress as string | null,
    area: o.area as string | null,
    regionName: region
      ? ((rtl ? region.nameAr : region.nameEn) as string | null) ??
        (region.nameEn as string)
      : null,
    deliveryDateText: o.deliveryDate
      ? formatDateKey(o.deliveryDate as string, locale)
      : null,
    deliveryTimeSlot: o.deliveryTimeSlot as string | null,
    deliveryNotes: o.deliveryNotes as string | null,
    giftMessage: o.receiverMessage as string | null,
    pickupOutletName: outlet
      ? ((rtl ? outlet.nameAr : outlet.name) as string | null) ??
        (outlet.name as string)
      : null,
    lines: items.map((i) => ({
      name: i.productName as string,
      variantLabel: i.variantLabel as string | null,
      quantity: i.quantity as number,
      unitPrice: i.priceAtPurchase as string,
      note: i.note as string | null,
      imageUrl: emailAssetUrl(i.imageUrl as string | null),
    })),
    deliveryFee: o.deliveryFee as string | null,
    taxAmount: o.taxAmount as string | null,
    discountAmount: o.discountAmount as string | null,
    discountCode: o.discountCode as string | null,
    giftCardAmount: o.giftCardAmount as string | null,
    storeCreditAmount: o.storeCreditAmount as string | null,
    total: o.total as string,
    shopName: (o.displayName as string | null) ?? (o.shopName as string),
    shopLogoUrl: emailAssetUrl(
      (o.themeLogoUrl as string | null) ?? (o.shopLogoUrl as string | null),
    ),
    shopEmail: o.shopEmail as string | null,
    shopPhone,
    trackUrl,
    rtl,
  };
}

// Just the Track your order URL for an order (the status emails), pinned by shop
// like everything else here. Null when the order is not this shop's or has no
// usable tracking token.
export async function loadTrackUrl(
  db: Pick<DatabaseService, 'query'>,
  shopId: number,
  orderId: number,
): Promise<string | null> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT o.trackingToken, s.subdomain, s.domainType, s.customDomain, s.customDomainStatus
       FROM \`order\` o JOIN shop s ON s.id = o.shopId
      WHERE o.id = ? AND o.shopId = ? LIMIT 1`,
    [orderId, shopId],
  );
  const r = rows[0];
  if (!r) return null;
  return trackingLink(
    r.trackingToken as string | null,
    {
      subdomain: r.subdomain as string,
      domainType: r.domainType as string | null,
      customDomain: r.customDomain as string | null,
      customDomainStatus: r.customDomainStatus as string | null,
    },
  );
}

// The receiver of an order (NULL/NULL = the customer), shop-scoped, for the status
// emails that are not built from the full OrderEmailData.
export async function loadOrderReceiver(
  db: Pick<DatabaseService, 'query'>,
  shopId: number,
  orderId: number,
): Promise<{ receiverName: string | null; receiverPhone: string | null }> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT receiverName, receiverPhone FROM \`order\` WHERE id = ? AND shopId = ? LIMIT 1`,
    [orderId, shopId],
  );
  const r = rows[0];
  return {
    receiverName: (r?.receiverName as string | null) ?? null,
    receiverPhone: (r?.receiverPhone as string | null) ?? null,
  };
}
