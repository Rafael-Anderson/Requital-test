import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface DraftOrderRow {
  id: number;
  status: string;
  subtotal: number;
  discountAmount: number;
  total: number;
  convertedOrderId: number | null;
  items: { id: number; productId: number; quantity: number; price: string }[];
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

const OUTLET_LAT = 25.2048;
const OUTLET_LON = 55.2708;

describe('Draft Orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Draft Orders Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: true,
        emirate: 'Dubai',
        deliveryEnabled: true,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
        deliveryRadiusKm: 5,
      })
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
        name: `Draft Item ${Math.random()}`,
        price: 80,
        thumbnail: 'https://example.com/item.jpg',
        sku: `DRAFT-${slug}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        trackInventory: true,
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    return { adminToken, outletId, categoryId, productId, slug };
  }

  function draftPayload(outletId: number, productId: number, overrides: Record<string, unknown> = {}) {
    return {
      outletId,
      customerName: 'Phone Customer',
      customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
      customerAddress: '1 Main St',
      emirate: 'Dubai',
      orderType: 'delivery',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  async function setStock(adminToken: string, outletId: number, productId: number, delta: number) {
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId, adjustments: [{ productId, delta }] })
      .expect(200);
  }

  describe('CRUD', () => {
    it('creates a draft order OPEN with correct subtotal, updates it while open, and blocks editing once converted', async () => {
      const { adminToken, outletId, productId } = await setupShop('crud');
      await setStock(adminToken, outletId, productId, 10);
      const res = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId, { items: [{ productId, quantity: 2 }] }))
        .expect(201);
      const draft = body<DraftOrderRow>(res);
      expect(draft.status).toBe('OPEN');
      expect(draft.subtotal).toBe(160);
      expect(draft.total).toBe(160);

      const updated = await request(app.getHttpServer())
        .patch(`/shop/draft-orders/${draft.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Call before delivery' })
        .expect(200);
      expect(body<DraftOrderRow & { notes: string }>(updated).notes).toBe('Call before delivery');

      await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/shop/draft-orders/${draft.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'too late' })
        .expect(400);
    });

    it('lists and gets draft orders scoped to the shop', async () => {
      const { adminToken, outletId, productId } = await setupShop('list');
      const created = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId))
        .expect(201);
      const draft = body<DraftOrderRow>(created);

      const list = await request(app.getHttpServer())
        .get('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<DraftOrderRow[]>(list).some((d) => d.id === draft.id)).toBe(true);

      await request(app.getHttpServer())
        .get(`/shop/draft-orders/${draft.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('complete() — mark as paid, reuses OrdersService.create with reserveStock', () => {
    it('converts to a real Order, reserves stock atomically, and marks it paid', async () => {
      const { adminToken, outletId, productId } = await setupShop('complete');
      await setStock(adminToken, outletId, productId, 5);

      const created = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId, { items: [{ productId, quantity: 3 }] }))
        .expect(201);
      const draft = body<DraftOrderRow>(created);

      const completed = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const result = body<DraftOrderRow & { convertedOrderId: number }>(completed);
      expect(result.status).toBe('COMPLETED');
      expect(result.convertedOrderId).toBeTruthy();

      const order = await prisma.order.findUnique({ where: { id: result.convertedOrderId } });
      expect(order?.paymentStatus).toBe('paid');
      expect(order?.channel).toBe('draft_order');

      const stock = await prisma.outletstock.findUnique({
        where: { outletId_productId: { outletId, productId } },
      });
      expect(stock?.stockQuantity).toBe(2); // 5 - 3, reserved immediately, same as storefront checkout
    });

    it('rejects completing a draft with no items', async () => {
      const { adminToken, outletId, productId } = await setupShop('complete-empty');
      const created = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId, { items: undefined }))
        .expect(201);
      const draft = body<DraftOrderRow>(created);
      const res = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(messageContains(res, 'at least one item')).toBe(true);
    });

    it('matches regular checkout\'s atomicity guarantee: only one of two competing completions succeeds when stock is 1', async () => {
      const { adminToken, outletId, productId } = await setupShop('complete-race');
      await setStock(adminToken, outletId, productId, 1);

      const draftA = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(draftPayload(outletId, productId, { items: [{ productId, quantity: 1 }] }))
          .expect(201),
      );
      const draftB = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(draftPayload(outletId, productId, { items: [{ productId, quantity: 1 }] }))
          .expect(201),
      );

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/shop/draft-orders/${draftA.id}/complete`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer())
          .post(`/shop/draft-orders/${draftB.id}/complete`)
          .set('Authorization', `Bearer ${adminToken}`),
      ]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const finalStock = await prisma.outletstock.findUnique({
        where: { outletId_productId: { outletId, productId } },
      });
      expect(finalStock?.stockQuantity).toBe(0);
    });
  });

  describe('sendInvoice()', () => {
    it('converts to an unpaid Order, generates a payment link, and complete() afterward reuses the same order', async () => {
      const { adminToken, outletId, productId } = await setupShop('invoice');
      await setStock(adminToken, outletId, productId, 5);

      const created = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId))
        .expect(201);
      const draft = body<DraftOrderRow>(created);

      const sent = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/send-invoice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const { draftOrder, paymentLink } = body<{
        draftOrder: DraftOrderRow;
        paymentLink: { url: string; token: string };
      }>(sent);
      expect(draftOrder.status).toBe('INVOICE_SENT');
      expect(draftOrder.convertedOrderId).toBeTruthy();
      expect(paymentLink.url).toContain(paymentLink.token);

      const orderAfterInvoice = await prisma.order.findUnique({ where: { id: draftOrder.convertedOrderId! } });
      expect(orderAfterInvoice?.paymentStatus).toBe('unpaid');
      expect(orderAfterInvoice?.paymentLinkToken).toBe(paymentLink.token);

      // Customer pays by cash instead of using the link — mark complete;
      // must reuse the SAME converted order, not create a second one.
      const completed = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const result = body<DraftOrderRow>(completed);
      expect(result.status).toBe('COMPLETED');
      expect(result.convertedOrderId).toBe(draftOrder.convertedOrderId);

      const finalOrder = await prisma.order.findUnique({ where: { id: draftOrder.convertedOrderId! } });
      expect(finalOrder?.paymentStatus).toBe('paid');

      const allOrdersForDraft = await prisma.order.count({ where: { draftorder: { id: draft.id } } });
      expect(allOrdersForDraft).toBe(1);
    });
  });

  describe('cancel()', () => {
    it('cancels an OPEN draft directly', async () => {
      const { adminToken, outletId, productId } = await setupShop('cancel-open');
      const draft = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(draftPayload(outletId, productId))
          .expect(201),
      );
      const res = await request(app.getHttpServer())
        .patch(`/shop/draft-orders/${draft.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<DraftOrderRow>(res).status).toBe('CANCELLED');
    });

    it('cancelling an INVOICE_SENT draft also cancels and restocks the underlying order', async () => {
      const { adminToken, outletId, productId } = await setupShop('cancel-invoiced');
      await setStock(adminToken, outletId, productId, 5);
      const draft = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(draftPayload(outletId, productId, { items: [{ productId, quantity: 2 }] }))
          .expect(201),
      );
      const sent = body<{ draftOrder: DraftOrderRow }>(
        await request(app.getHttpServer())
          .post(`/shop/draft-orders/${draft.id}/send-invoice`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201),
      );
      const orderId = sent.draftOrder.convertedOrderId!;

      const stockAfterReserve = await prisma.outletstock.findUnique({
        where: { outletId_productId: { outletId, productId } },
      });
      expect(stockAfterReserve?.stockQuantity).toBe(3); // 5 - 2

      await request(app.getHttpServer())
        .patch(`/shop/draft-orders/${draft.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('cancelled');

      const stockAfterCancel = await prisma.outletstock.findUnique({
        where: { outletId_productId: { outletId, productId } },
      });
      expect(stockAfterCancel?.stockQuantity).toBe(5); // restocked
    });
  });

  describe('discount interaction', () => {
    it('applying a discount to a draft and completing it decrements the discount usage count', async () => {
      const { adminToken, outletId, productId } = await setupShop('discount');
      await setStock(adminToken, outletId, productId, 5);

      const discountRes = await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `DRAFT${Math.random().toString(36).slice(2, 6).toUpperCase()}`, type: 'FIXED_AMOUNT', value: 20, usageLimit: 1 })
        .expect(201);
      const discount = body<{ id: number; code: string; timesUsed: number }>(discountRes);

      const draft = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(draftPayload(outletId, productId, { discountCode: discount.code }))
          .expect(201),
      );
      expect(draft.discountAmount).toBe(20);
      expect(draft.total).toBe(60); // 80 - 20

      const completed = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const result = body<DraftOrderRow & { convertedOrderId: number }>(completed);

      const order = await prisma.order.findUnique({ where: { id: result.convertedOrderId } });
      expect(order?.discountCode).toBe(discount.code);
      expect(Number(order?.discountAmount)).toBe(20);

      const updatedDiscount = await prisma.discount.findUnique({ where: { id: discount.id } });
      expect(updatedDiscount?.timesUsed).toBe(1);

      // A second draft against the same (now-exhausted) code is rejected at
      // build time — the same validate/evaluate path checkout itself uses.
      const rejectedRes = await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(draftPayload(outletId, productId, { discountCode: discount.code }))
        .expect(400);
      expect(messageContains(rejectedRes, 'usage limit')).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('a draft order from shop A is invisible/uneditable/uncompletable from shop B', async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const draft = body<DraftOrderRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${shopA.adminToken}`)
          .send(draftPayload(shopA.outletId, shopA.productId))
          .expect(201),
      );

      await request(app.getHttpServer())
        .get(`/shop/draft-orders/${draft.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/shop/draft-orders/${draft.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ notes: 'hijack attempt' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
    });
  });
});
