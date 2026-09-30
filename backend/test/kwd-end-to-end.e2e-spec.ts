import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
} from '../src/payments/payment-provider.interface';
import { toMinorUnits } from '../src/common/currency-minor-units';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface TaxClass {
  id: number;
  type: string;
  rate: string;
  isDefault: boolean;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(240000);

// THE proof for Phase 2a/A6.
//
// Every money change in A1-A5, B1-B3 and C1-C2 has been correct in tests while
// every real shop stayed on AED at 0% - so the three-decimal branches, the rate
// freeze, and the currency threading have never actually been exercised
// end to end by anything but unit fixtures. A6 removes the AED-only lock, which
// makes those branches reachable by a real merchant. This walks one KWD order
// through the whole system and checks the number at every place it surfaces.
//
// KWD matters specifically because it has 1000 minor units, not 100. A codebase
// that assumes 2 decimals anywhere produces a charge that disagrees with the
// stored total by a factor of ten, and the third decimal is exactly what gets
// silently dropped.
//
// The arithmetic, fixed once here so every assertion below refers to it:
//   price        10.505 KWD  (a third decimal that 2dp rounding would destroy)
//   quantity     3           -> line 31.515
//   tax          5% exclusive -> 1.57575, rounded at persist to 1.576
//   total        31.515 + 1.57575 = 33.09075, rounded at persist to 33.091
//   Stripe       33.091 x 1000 = 33091 minor units   (x100 would be 3309)
const PRICE = 10.505;
const QTY = 3;
const LINE = 31.515;
const TAX = 1.576;
const TOTAL = 33.091;
const MINOR = 33091;

class CapturingStripe implements PaymentProvider {
  readonly name = 'stripe';
  readonly calls: CreateCheckoutSessionParams[] = [];
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.calls.push(params);
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `stub_kwd_${this.calls.length}`,
    });
  }
  parseWebhookEvent() {
    return null;
  }
}

describe('KWD end to end (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const stripe = new CapturingStripe();
  let shop: {
    adminToken: string;
    slug: string;
    shopId: number;
    outletId: number;
    productId: number;
  };
  let orderId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    // Registered under the real provider's own name, so PublicService resolves
    // it exactly as it would Stripe. No key, no network, no charge.
    app.get(PaymentProviderRegistry).register(stripe);

    const slug = `kwd-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'KWD Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    // A6: this is the line that was rejected with 400 before the lock was
    // widened. Everything below depends on it.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'KWD', taxRate: 5, taxInclusive: false })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'KWD Goods' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'KWD Bouquet',
        price: PRICE,
        costPrice: 4.25,
        thumbnail: 'https://example.com/k.jpg',
        sku: `KWD-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    shop = {
      adminToken,
      slug,
      shopId: shopRows[0].id as number,
      outletId,
      productId: body<IdRow>(product).id,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  // ── the lock is actually off ──────────────────────────────────────────────
  it('stores KWD on the shop, which the DTO rejected before A6', async () => {
    const res = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<{ currency: string }>(res).currency).toBe('KWD');
  });

  // B1/B2's rate sync has to work in KWD too: the class seeded at signup carried
  // the shop's then-rate of 0, and setting 5% must re-rate it or the order below
  // would be charged 0% tax.
  it('re-rated the default tax class to 5% when the shop rate was set', async () => {
    const res = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const def = body<TaxClass[]>(res).find((c) => c.isDefault)!;
    expect(def.type).toBe('standard');
    expect(Number(def.rate)).toBeCloseTo(5, 2);
  });

  // ── what the cart and checkout read ───────────────────────────────────────
  it('the public shop payload the cart/checkout render from carries KWD', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/${shop.slug}`)
      .expect(200);
    const payload = body<{
      currency: string;
      taxRate: string;
      taxInclusive: boolean;
    }>(res);
    expect(payload.currency).toBe('KWD');
    // The storefront's own tax quote (lib/order-tax.ts) is driven by these two
    // plus the per-product rate below.
    expect(Number(payload.taxRate)).toBeCloseTo(5, 2);
    expect(payload.taxInclusive).toBe(false);
  });

  it('the public product carries its three-decimal price and its resolved rate', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/${shop.slug}/products`)
      .expect(200);
    const product = body<{ id: number; price: string; taxRate: number }[]>(
      res,
    ).find((p) => p.id === shop.productId)!;
    // The third decimal survives the response, which is what the cart multiplies.
    expect(Number(product.price)).toBeCloseTo(PRICE, 3);
    expect(product.taxRate).toBeCloseTo(5, 2);
  });

  // ── the order ─────────────────────────────────────────────────────────────
  it('creates the order with three-decimal money and a frozen KWD rate', async () => {
    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'KWD Customer',
        customerPhone: '0501112222',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'card_online',
        items: [{ productId: shop.productId, quantity: QTY }],
      })
      .expect(201);
    orderId = body<{ order: IdRow }>(res).order.id;

    const rows = await db.query<RowDataPacket[]>(
      `SELECT currency, total, taxAmount, rateBaseCurrency, exchangeRate
         FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const order = rows[0];
    expect(order.currency).toBe('KWD');
    // Rounded at persist to the currency's REAL precision. At 2 decimals these
    // would be 1.58 and 33.09 - both wrong, and wrong in a way no AED test can see.
    expect(Number(order.taxAmount)).toBeCloseTo(TAX, 3);
    expect(Number(order.total)).toBeCloseTo(TOTAL, 3);
    // A2's rate freeze, in a non-base currency for the first time.
    expect(order.rateBaseCurrency).toBe('USD');
    expect(Number(order.exchangeRate)).toBeCloseTo(0.307, 6);
  });

  it('captured the per-line tax against the KWD rate', async () => {
    const lines = await db.query<RowDataPacket[]>(
      `SELECT priceAtPurchase, quantity, taxRate, taxAmount, unitCost, unitCostCurrency
         FROM orderitem WHERE orderId = ?`,
      [orderId],
    );
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].priceAtPurchase)).toBeCloseTo(PRICE, 3);
    expect(Number(lines[0].taxRate)).toBeCloseTo(5, 2);
    // Rounded per line at persist, to 3 decimals.
    expect(Number(lines[0].taxAmount)).toBeCloseTo(TAX, 3);
    expect(Number(lines[0].unitCost)).toBeCloseTo(4.25, 3);
  });

  // ── the charge ────────────────────────────────────────────────────────────
  // The one that would have been wrong by a factor of ten.
  it('hands the gateway KWD, and x1000 is the integer Stripe would receive', () => {
    expect(stripe.calls).toHaveLength(1);
    const call = stripe.calls[0];
    expect(call.currency).toBe('KWD');
    expect(call.amount).toBeCloseTo(TOTAL, 3);
    // toMinorUnits is the exact function StripePaymentProvider applies to
    // params.amount before sending it (see its unit_amount / amount fields), so
    // this is what the real gateway would be charged.
    expect(toMinorUnits(call.amount, call.currency)).toBe(MINOR);
    // The bug this guards: a hardcoded x100 sends a tenth of the money.
    expect(toMinorUnits(call.amount, call.currency)).not.toBe(
      Math.round(TOTAL * 100),
    );
  });

  // ── admin order detail ────────────────────────────────────────────────────
  it('admin order detail reports KWD and keeps three decimals', async () => {
    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const order = body<{
      currency: string;
      total: string;
      taxAmount: string;
      orderitem: { priceAtPurchase: string }[];
    }>(res);
    expect(order.currency).toBe('KWD');
    expect(Number(order.total)).toBeCloseTo(TOTAL, 3);
    expect(Number(order.taxAmount)).toBeCloseTo(TAX, 3);
    expect(Number(order.orderitem[0].priceAtPurchase)).toBeCloseTo(PRICE, 3);
    // Not truncated to 2dp anywhere in the response shaping.
    expect(String(order.total)).toContain('33.091');
  });

  // ── the invoice ───────────────────────────────────────────────────────────
  it('the invoice prints KWD with three decimals, and its column adds up', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ orderId, type: 'INVOICE' })
      .expect(201);
    const invoiceId = body<IdRow>(invoice).id;

    const stored = await db.query<RowDataPacket[]>(
      `SELECT currency, subtotal, taxAmount, total, snapshotVersion FROM invoice WHERE id = ?`,
      [invoiceId],
    );
    expect(stored[0].currency).toBe('KWD');
    expect(Number(stored[0].total)).toBeCloseTo(TOTAL, 3);
    // C1's snapshot, captured in a non-AED currency.
    expect(stored[0].snapshotVersion).toBe(1);

    const html = (
      await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}/pdf`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200)
    ).text;

    // Denominated in the order's own currency, three decimals throughout.
    expect(html).toContain('KWD');
    expect(html).not.toContain('AED');
    expect(html).toContain('31.515');
    expect(html).toContain('33.091');
    // B3's per-line column and breakdown, in KWD.
    expect(html).toContain('<th class="num">Tax</th>');
    expect(html).toContain('Tax summary');
    expect(html).toContain('Taxable at 5%');
    // Subtotal + tax = total, printed (exclusive shop, no delivery/discount).
    expect(Number((LINE + TAX).toFixed(3))).toBeCloseTo(TOTAL, 3);
  });

  // ── the exports ───────────────────────────────────────────────────────────
  it('the orders CSV export carries KWD and three-decimal money', async () => {
    const csv = (
      await request(app.getHttpServer())
        .get('/exports/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200)
    ).text;
    const row = csv
      .split('\n')
      .find((line) => line.includes(`KWD Customer`));
    expect(row).toBeDefined();
    expect(row).toContain('KWD');
    // toMajorUnitString renders to the currency's own decimals, not a fixed 2.
    expect(row).toContain('33.091');
  });

  it('the margin export carries three-decimal cost and revenue', async () => {
    const csv = (
      await request(app.getHttpServer())
        .get('/exports/margin')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200)
    ).text;
    const row = csv.split('\n').find((line) => line.includes('KWD Bouquet'));
    expect(row).toBeDefined();
    // 3 x 10.505 revenue and 3 x 4.25 cost, both in KWD precision.
    expect(row).toContain('31.515');
    expect(row).toContain('12.750');
  });

  it('the margin report totals in KWD without losing the third decimal', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/margin/summary')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const summary = body<{ revenue: number | string; cost: number | string }>(
      res,
    );
    expect(Number(summary.revenue)).toBeCloseTo(LINE, 3);
    expect(Number(summary.cost)).toBeCloseTo(12.75, 3);
  });

  // ── the refund path ───────────────────────────────────────────────────────
  // A4: a refund is denominated in the currency of the charge it reverses, read
  // from paymenttransaction.currency rather than from the shop or the order.
  it('a recorded payment carries KWD, which is what a refund would reverse', async () => {
    await db.execute(
      `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference,
        providerChargeReference, amount, status, currency)
       VALUES (?, 'stripe', ?, ?, ?, 'paid', ?)`,
      [orderId, `evt_kwd_${runId}`, `pi_kwd_${runId}`, TOTAL, 'KWD'],
    );
    const rows = await db.query<RowDataPacket[]>(
      `SELECT amount, currency FROM paymenttransaction WHERE orderId = ?`,
      [orderId],
    );
    expect(rows[0].currency).toBe('KWD');
    expect(Number(rows[0].amount)).toBeCloseTo(TOTAL, 3);
    // And the gateway conversion for that refund is the 3-decimal one.
    expect(toMinorUnits(Number(rows[0].amount), rows[0].currency as string)).toBe(
      MINOR,
    );
  });
});
