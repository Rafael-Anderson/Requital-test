import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AbandonedCartsService } from '../src/abandoned-carts/abandoned-carts.service';

interface AuthResponse {
  accessToken: string;
}
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface AbandonedCartRow {
  id: number;
  customerName: string;
  customerPhone: string;
  cartValue: string;
  recoveryEmailSentAt: string | null;
  recoveredOrderId: number | null;
}
interface OrderCreateResponse {
  order: { id: number };
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Abandoned Cart Recovery (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let abandonedCartsService: AbandonedCartsService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    abandonedCartsService = app.get(AbandonedCartsService);
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
    const adminToken = body<AuthResponse>(signup).accessToken;

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
        name: 'Test Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `ABC-${runId}-${Math.random().toString(36).slice(2, 8)}`,
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

  function captureCart(shopSlug: string, phone: string, productId: number, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/abandoned-carts`)
      .send({
        customerName: 'Almost Buyer',
        customerPhone: phone,
        customerEmail: `almost-${runId}-${Math.random().toString(36).slice(2, 6)}@test.com`,
        cartItems: [{ productId, name: 'Test Product', price: 50, quantity: 1, thumbnail: 'https://example.com/x.jpg' }],
        ...overrides,
      });
  }

  function guestCheckout(shopSlug: string, outletId: number, productId: number, phone: string) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Almost Buyer',
        customerPhone: phone,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        items: [{ productId, quantity: 1 }],
      });
  }

  it('captures a cart on contact-info entry and it shows up on the admin list', async () => {
    const { shopSlug, adminToken, productId } = await setupShop('ac-capture');
    const phone = '0511111111';
    await captureCart(shopSlug, phone, productId).expect(201);

    const list = await request(app.getHttpServer())
      .get('/abandoned-carts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rows = body<AbandonedCartRow[]>(list);
    expect(rows.some((r) => r.customerPhone === phone && r.cartValue === '50')).toBe(true);
  });

  it('re-capturing the same still-open cart refreshes contents without resetting capturedAt or creating a duplicate row', async () => {
    const { shopSlug, adminToken, productId } = await setupShop('ac-refresh');
    const phone = '0512222222';
    await captureCart(shopSlug, phone, productId).expect(201);
    await captureCart(shopSlug, phone, productId, {
      cartItems: [{ productId, name: 'Test Product', price: 50, quantity: 2, thumbnail: 'https://example.com/x.jpg' }],
    }).expect(201);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { subdomain: shopSlug } });
    const rows = await prisma.abandonedcart.findMany({ where: { shopId: shop.id, customerPhone: phone } });
    expect(rows).toHaveLength(1);
    expect(rows[0].cartValue.toString()).toBe('100'); // 50 * 2, refreshed

    const list = await request(app.getHttpServer())
      .get('/abandoned-carts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<AbandonedCartRow[]>(list).filter((r) => r.customerPhone === phone)).toHaveLength(1);
  });

  it('an order completing for the same phone marks the cart recovered', async () => {
    const { shopSlug, outletId, productId } = await setupShop('ac-recover');
    const phone = '0513333333';
    await captureCart(shopSlug, phone, productId).expect(201);

    const order = await guestCheckout(shopSlug, outletId, productId, phone).expect(201);
    const orderId = body<OrderCreateResponse>(order).order.id;

    const shop = await prisma.shop.findUniqueOrThrow({ where: { subdomain: shopSlug } });
    const cart = await prisma.abandonedcart.findUniqueOrThrow({
      where: { shopId_customerPhone: { shopId: shop.id, customerPhone: phone } },
    });
    expect(cart.recoveredOrderId).toBe(orderId);
  });

  it("recovery email fires exactly once per cart and respects the shop's opt-in toggle", async () => {
    const { shopSlug, adminToken, productId } = await setupShop('ac-toggle');
    const phone = '0514444444';
    await captureCart(shopSlug, phone, productId).expect(201);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { subdomain: shopSlug } });

    // Toggle off (default) — no send even though the "window" already elapsed.
    let sent = await abandonedCartsService.sendDueForShop(shop.id, shop.name, shopSlug, 0);
    expect(sent).toBe(0);
    let cart = await prisma.abandonedcart.findUniqueOrThrow({
      where: { shopId_customerPhone: { shopId: shop.id, customerPhone: phone } },
    });
    expect(cart.recoveryEmailSentAt).toBeNull();

    // Opt in, then it sends.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyAbandonedCart: true })
      .expect(200);
    sent = await abandonedCartsService.sendDueForShop(shop.id, shop.name, shopSlug, 0);
    expect(sent).toBe(1);
    cart = await prisma.abandonedcart.findUniqueOrThrow({
      where: { shopId_customerPhone: { shopId: shop.id, customerPhone: phone } },
    });
    expect(cart.recoveryEmailSentAt).not.toBeNull();

    // Calling it again must not send a second time for the same episode.
    sent = await abandonedCartsService.sendDueForShop(shop.id, shop.name, shopSlug, 0);
    expect(sent).toBe(0);
  });

  it('a completion happening before the recovery job runs (same-window race) results in zero emails, not a stale send', async () => {
    const { shopSlug, adminToken, outletId, productId } = await setupShop('ac-race');
    const phone = '0515555555';
    await captureCart(shopSlug, phone, productId).expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyAbandonedCart: true })
      .expect(200);

    // The completion lands first — this is the race outcome that must never
    // result in a recovery email for a since-completed cart.
    await guestCheckout(shopSlug, outletId, productId, phone).expect(201);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { subdomain: shopSlug } });
    const sent = await abandonedCartsService.sendDueForShop(shop.id, shop.name, shopSlug, 0);
    expect(sent).toBe(0);
    const cart = await prisma.abandonedcart.findUniqueOrThrow({
      where: { shopId_customerPhone: { shopId: shop.id, customerPhone: phone } },
    });
    expect(cart.recoveryEmailSentAt).toBeNull();
    expect(cart.recoveredOrderId).not.toBeNull();
  });

  it("abandoned carts are isolated per shop — shop A's carts never appear on shop B's admin list", async () => {
    const shopA = await setupShop('ac-iso-a');
    const shopB = await setupShop('ac-iso-b');
    await captureCart(shopA.shopSlug, '0516666666', shopA.productId).expect(201);

    const listB = await request(app.getHttpServer())
      .get('/abandoned-carts')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<AbandonedCartRow[]>(listB).some((r) => r.customerPhone === '0516666666')).toBe(false);
  });

  it('the recovery link returns the cart snapshot by token, and stops working once the cart is recovered', async () => {
    const { shopSlug, outletId, productId } = await setupShop('ac-token');
    const phone = '0517777777';
    await captureCart(shopSlug, phone, productId).expect(201);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { subdomain: shopSlug } });
    const cart = await prisma.abandonedcart.findUniqueOrThrow({
      where: { shopId_customerPhone: { shopId: shop.id, customerPhone: phone } },
    });

    const recovered = await request(app.getHttpServer())
      .get(`/public/abandoned-carts/recover?token=${cart.recoverToken}`)
      .expect(200);
    expect(body<{ cartItems: { productId: number }[] }>(recovered).cartItems[0].productId).toBe(productId);

    await guestCheckout(shopSlug, outletId, productId, phone).expect(201);

    await request(app.getHttpServer()).get(`/public/abandoned-carts/recover?token=${cart.recoverToken}`).expect(404);
  });
});
