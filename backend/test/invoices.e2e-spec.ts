import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AdminAuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface CustomerAuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderCreateResponse {
  order: { id: number };
}
interface InvoiceRow {
  id: number;
  orderId: number;
  shopId: number;
  type: 'INVOICE' | 'PACKING_SLIP';
  invoiceNumber: string;
  subtotal: string;
  taxAmount: string;
  total: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Several tests spin up two shops (two real signup calls, each firing a
// real verification-email network request) plus several order/invoice
// round trips — same reasoning as scan.e2e-spec.ts's own jest.setTimeout(30000).
jest.setTimeout(30000);

describe('Invoices & packing slips (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const shopSlug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${shopSlug}@test.com`,
        password: 'password123',
        shopName: `${shopSlug} Shop`,
        subdomain: shopSlug,
      })
      .expect(201);
    const adminToken = body<AdminAuthResponse>(signup).accessToken;
    await verifySignupEmail(app.getHttpServer(), body<AdminAuthResponse>(signup).devVerificationLink);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Invoice Test Product',
        price: 100,
        thumbnail: 'https://example.com/x.jpg',
        sku: `INV-PROD-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, productId };
  }

  function createOrder(
    shopSlug: string,
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Shopper',
        customerPhone: '0501234567',
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        items: [{ productId, quantity: 2 }],
        ...overrides,
      })
      .expect(201);
  }

  describe('generate + idempotency', () => {
    it('generates an invoice with subtotal/tax/total snapshotted from the order, and is idempotent on a second call', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('inv-generate');
      const order = body<OrderCreateResponse>(
        await createOrder(shopSlug, outletId, productId),
      ).order;

      const first = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order.id, type: 'INVOICE' })
        .expect(201);
      const invoice = body<InvoiceRow>(first);
      expect(invoice.orderId).toBe(order.id);
      expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}$/);
      expect(Number(invoice.subtotal)).toBe(200); // 2 * 100
      expect(Number(invoice.total)).toBeGreaterThanOrEqual(200);

      const second = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order.id, type: 'INVOICE' })
        .expect(201);
      expect(body<InvoiceRow>(second).id).toBe(invoice.id); // same row, not a duplicate

      const rows = await prisma.invoice.findMany({
        where: { orderId: order.id, type: 'INVOICE' },
      });
      expect(rows).toHaveLength(1);
    });

    it('a packing slip is a separate row from an invoice for the same order', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('inv-packing-slip');
      const order = body<OrderCreateResponse>(
        await createOrder(shopSlug, outletId, productId),
      ).order;

      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order.id, type: 'INVOICE' })
        .expect(201);
      const slip = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ orderId: order.id, type: 'PACKING_SLIP' })
          .expect(201),
      );
      expect(slip.invoiceNumber).toMatch(/^PS-\d{4}$/);

      const list = body<InvoiceRow[]>(
        await request(app.getHttpServer())
          .get(`/invoices?orderId=${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(list).toHaveLength(2);
    });

    it('concurrent generate calls for the same order produce exactly one invoice', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('inv-race');
      const order = body<OrderCreateResponse>(
        await createOrder(shopSlug, outletId, productId),
      ).order;

      const attempt = () =>
        request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ orderId: order.id, type: 'INVOICE' });

      const [a, b] = await Promise.all([attempt(), attempt()]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(body<InvoiceRow>(a).id).toBe(body<InvoiceRow>(b).id);

      const rows = await prisma.invoice.findMany({
        where: { orderId: order.id, type: 'INVOICE' },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('invoiceNumber sequencing', () => {
    it('increments independently per shop — shop B starts at INV-0001 even after shop A has issued several', async () => {
      const shopA = await setupShop('inv-seq-a');
      const shopB = await setupShop('inv-seq-b');

      const orderA1 = body<OrderCreateResponse>(
        await createOrder(shopA.shopSlug, shopA.outletId, shopA.productId),
      ).order;
      const orderA2 = body<OrderCreateResponse>(
        await createOrder(shopA.shopSlug, shopA.outletId, shopA.productId),
      ).order;
      const orderB1 = body<OrderCreateResponse>(
        await createOrder(shopB.shopSlug, shopB.outletId, shopB.productId),
      ).order;

      const invA1 = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shopA.adminToken}`)
          .send({ orderId: orderA1.id, type: 'INVOICE' })
          .expect(201),
      );
      const invA2 = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shopA.adminToken}`)
          .send({ orderId: orderA2.id, type: 'INVOICE' })
          .expect(201),
      );
      const invB1 = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shopB.adminToken}`)
          .send({ orderId: orderB1.id, type: 'INVOICE' })
          .expect(201),
      );

      expect(invA1.invoiceNumber).toBe('INV-0001');
      expect(invA2.invoiceNumber).toBe('INV-0002');
      expect(invB1.invoiceNumber).toBe('INV-0001'); // shop B's own sequence, unaffected by shop A's
    });
  });

  describe('tenant isolation', () => {
    it("shop A cannot fetch shop B's invoice via a spoofed id", async () => {
      const shopA = await setupShop('inv-iso-a');
      const shopB = await setupShop('inv-iso-b');
      const orderB = body<OrderCreateResponse>(
        await createOrder(shopB.shopSlug, shopB.outletId, shopB.productId),
      ).order;
      const invoiceB = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shopB.adminToken}`)
          .send({ orderId: orderB.id, type: 'INVOICE' })
          .expect(201),
      );

      const jsonRes = await request(app.getHttpServer())
        .get(`/invoices/${invoiceB.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(404);
      // The 404 body itself must never carry any of shop B's real invoice
      // data — just the generic NotFoundException shape.
      expect(JSON.stringify(jsonRes.body)).not.toContain(invoiceB.invoiceNumber);
      expect(jsonRes.body).not.toHaveProperty('invoiceNumber');
      expect(jsonRes.body).not.toHaveProperty('subtotal');
      expect(jsonRes.body).not.toHaveProperty('total');

      const pdfRes = await request(app.getHttpServer())
        .get(`/invoices/${invoiceB.id}/pdf`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(404);
      // Same check against the /pdf route's own response — even though its
      // success shape is text/html, an unauthorized 404 must not fall back
      // to rendering (any part of) the real document.
      expect(pdfRes.text).not.toContain(invoiceB.invoiceNumber);
    });

    it("cannot generate an invoice against another shop's orderId — the order simply isn't found in this shop's scope", async () => {
      const shopA = await setupShop('inv-iso-gen-a');
      const shopB = await setupShop('inv-iso-gen-b');
      const orderB = body<OrderCreateResponse>(
        await createOrder(shopB.shopSlug, shopB.outletId, shopB.productId),
      ).order;

      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ orderId: orderB.id, type: 'INVOICE' })
        .expect(404);

      const leaked = await prisma.invoice.findFirst({
        where: { orderId: orderB.id },
      });
      expect(leaked).toBeNull();
    });

    it('an unauthenticated request is rejected', async () => {
      await request(app.getHttpServer()).get('/invoices?orderId=1').expect(401);
    });
  });

  // Regression coverage for a real bug: InvoicesService.findOne only
  // checked shopId, not outlet — a branch user pinned to one outlet could
  // read (and download the PDF of) an invoice belonging to a sibling
  // outlet's order in the same shop, even though they're blocked from the
  // order itself via /orders/:id.
  describe('cross-outlet isolation within a shop', () => {
    it("a branch user pinned to outlet A cannot fetch (JSON or PDF) an invoice belonging to outlet B's order in the same shop", async () => {
      const shop = await setupShop('inv-outlet-iso');

      const outletBRes = await request(app.getHttpServer())
        .post('/outlets')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Outlet B' })
        .expect(201);
      const outletBId = body<IdRow>(outletBRes).id;
      await request(app.getHttpServer())
        .patch(`/outlets/${outletBId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
        .expect(200);

      const branchEmail = `inv-branch-${runId}@test.com`;
      const branchRes = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch A',
          email: branchEmail,
          password: 'password123',
          outletId: shop.outletId,
        })
        .expect(201);
      expect(body<{ outletId: number }>(branchRes).outletId).toBe(
        shop.outletId,
      );
      const branchLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AdminAuthResponse>(branchLogin).accessToken;

      const orderB = body<OrderCreateResponse>(
        await createOrder(shop.shopSlug, outletBId, shop.productId),
      ).order;
      const invoiceB = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ orderId: orderB.id, type: 'INVOICE' })
          .expect(201),
      );

      const jsonRes = await request(app.getHttpServer())
        .get(`/invoices/${invoiceB.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(404);
      expect(JSON.stringify(jsonRes.body)).not.toContain(
        invoiceB.invoiceNumber,
      );

      const pdfRes = await request(app.getHttpServer())
        .get(`/invoices/${invoiceB.id}/pdf`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(404);
      expect(pdfRes.text).not.toContain(invoiceB.invoiceNumber);

      // The same branch user's own outlet's invoice still works normally —
      // this isn't a blanket regression on invoice access.
      const orderA = body<OrderCreateResponse>(
        await createOrder(shop.shopSlug, shop.outletId, shop.productId),
      ).order;
      const invoiceA = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ orderId: orderA.id, type: 'INVOICE' })
          .expect(201),
      );
      const ownRes = await request(app.getHttpServer())
        .get(`/invoices/${invoiceA.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);
      expect(body<InvoiceRow>(ownRes).id).toBe(invoiceA.id);
    });
  });

  describe('PDF/HTML endpoint', () => {
    it('returns a styled HTML document (no PDF library installed, so text/html is the real content type)', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('inv-html');
      const order = body<OrderCreateResponse>(
        await createOrder(shopSlug, outletId, productId),
      ).order;
      const invoice = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ orderId: order.id, type: 'INVOICE' })
          .expect(201),
      );

      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(invoice.invoiceNumber);
      expect(res.text).toContain(`Order #${order.id}`);
    });
  });

  describe('storefront customer download', () => {
    async function registerCustomer(shopSlug: string, phone: string) {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/register`)
        .send({
          name: 'Invoice Customer',
          phone,
          email: `inv-cust-${runId}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          password: 'password123',
        })
        .expect(201);
      return body<CustomerAuthResponse>(res).accessToken;
    }

    it('a logged-in customer can download the invoice for their own order once the merchant has generated one, and not before', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('inv-cust-dl');
      const phone = '0509998888';
      const order = body<OrderCreateResponse>(
        await createOrder(shopSlug, outletId, productId, {
          customerPhone: phone,
        }),
      ).order;
      const customerToken = await registerCustomer(shopSlug, phone);

      // Not generated yet — the customer-facing endpoint never generates,
      // only downloads.
      await request(app.getHttpServer())
        .get(`/public/${shopSlug}/account/orders/${order.id}/invoice`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(404);

      const invoice = body<InvoiceRow>(
        await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ orderId: order.id, type: 'INVOICE' })
          .expect(201),
      );

      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/account/orders/${order.id}/invoice`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(invoice.invoiceNumber);

      // The order summary in the customer's own order list/detail reflects
      // this, driving the storefront's "only show the link if it exists"
      // rule.
      const detail = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/account/orders/${order.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(body<{ hasInvoice: boolean }>(detail).hasInvoice).toBe(true);
    });

    it("a customer from shop B cannot download shop A's order invoice by spoofing the orderId, and a merchant JWT is rejected on this endpoint", async () => {
      const shopA = await setupShop('inv-cust-iso-a');
      const shopB = await setupShop('inv-cust-iso-b');
      const phoneA = '0501112222';
      const orderA = body<OrderCreateResponse>(
        await createOrder(shopA.shopSlug, shopA.outletId, shopA.productId, {
          customerPhone: phoneA,
        }),
      ).order;
      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ orderId: orderA.id, type: 'INVOICE' })
        .expect(201);

      const customerBToken = await registerCustomer(
        shopB.shopSlug,
        '0503334444',
      );
      // Shop B's own customer-account route can't even resolve shop A's
      // order id — CustomerAuthGuard ties the token to shop B via
      // :shopSlug, and the lookup is additionally scoped by shopId.
      const crossShopRes = await request(app.getHttpServer())
        .get(`/public/${shopB.shopSlug}/account/orders/${orderA.id}/invoice`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(404);
      // No fragment of shop A's real invoice HTML leaks into the 404 body
      // — a real success response is a full HTML document containing the
      // invoice number, neither of which should appear here.
      expect(crossShopRes.text).not.toContain('INV-');
      expect(crossShopRes.text).not.toContain('<html');

      // A staff (merchant) token is a different token type entirely — the
      // customer-account routes require typ: 'customer'.
      await request(app.getHttpServer())
        .get(`/public/${shopA.shopSlug}/account/orders/${orderA.id}/invoice`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(401);
    });
  });
});
