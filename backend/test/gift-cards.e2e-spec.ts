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
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface GiftCardRow {
  id: number;
  code: string;
  initialValue: string;
  remainingBalance: string;
  status: string;
}
interface OrderCreateResponse {
  order: {
    id: number;
    total: string;
    giftCardId: number | null;
    giftCardCode: string | null;
    giftCardAmount: string | null;
    paymentStatus: string;
  };
  checkoutUrl: string | null;
}
interface ValidateGiftCardResponse {
  valid: boolean;
  message?: string;
  giftCardId?: number;
  code?: string;
  remainingBalance?: number;
}
interface OrderReturnResponse {
  id: number;
  refundAmount: string;
  giftCardRefundAmount: string;
  refundMethod: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Gift Cards (e2e)', () => {
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
        name: 'Regular Product',
        price: 80,
        thumbnail: 'https://example.com/x.jpg',
        sku: `GC-PROD-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    const giftCardProduct = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Gift Card',
        price: 1, // placeholder — ignored for a gift-card product, see CreateProductDto's comment
        thumbnail: 'https://example.com/gift.jpg',
        sku: `GC-CARD-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        isGiftCard: true,
        giftCardDenominations: [100, 200],
      })
      .expect(201);
    const giftCardProductId = body<IdRow>(giftCardProduct).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, productId, giftCardProductId };
  }

  function orderPayload(
    outletId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'Shopper',
      customerPhone: '0531111111',
      customerAddress: 'N/A',
      emirate: 'Dubai',
      ...overrides,
    };
  }

  describe('purchase path', () => {
    it('buying a gift-card product creates a real GiftCard with the chosen amount as both initial value and balance', async () => {
      const { shopSlug, outletId, giftCardProductId } =
        await setupShop('gc-purchase');
      const email = `buyer-${runId}@test.com`;
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            customerEmail: email,
            items: [
              {
                productId: giftCardProductId,
                quantity: 1,
                giftCardAmount: 200,
              },
            ],
          }),
        )
        .expect(201);
      const orderId = body<OrderCreateResponse>(res).order.id;

      const shop = await prisma.shop.findUniqueOrThrow({
        where: { subdomain: shopSlug },
      });
      const cards = await prisma.giftcard.findMany({
        where: { shopId: shop.id, purchaseOrderId: orderId },
      });
      expect(cards).toHaveLength(1);
      expect(cards[0].initialValue.toString()).toBe('200');
      expect(cards[0].remainingBalance.toString()).toBe('200');
      expect(cards[0].status).toBe('active');
      expect(cards[0].purchasedByCustomerId).not.toBeNull();
    });

    it('quantity > 1 issues that many independent cards, each with its own code and full balance', async () => {
      const { shopSlug, outletId, giftCardProductId } =
        await setupShop('gc-purchase-qty');
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            items: [
              {
                productId: giftCardProductId,
                quantity: 3,
                giftCardAmount: 100,
              },
            ],
          }),
        )
        .expect(201);
      const orderId = body<OrderCreateResponse>(res).order.id;

      const shop = await prisma.shop.findUniqueOrThrow({
        where: { subdomain: shopSlug },
      });
      const cards = await prisma.giftcard.findMany({
        where: { shopId: shop.id, purchaseOrderId: orderId },
      });
      expect(cards).toHaveLength(3);
      expect(new Set(cards.map((c) => c.code)).size).toBe(3); // all distinct
      expect(cards.every((c) => c.remainingBalance.toString() === '100')).toBe(
        true,
      );
    });

    it('rejects an amount that is neither a configured denomination nor within a custom range', async () => {
      const { shopSlug, outletId, giftCardProductId } = await setupShop(
        'gc-purchase-bad-amount',
      );
      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            items: [
              {
                productId: giftCardProductId,
                quantity: 1,
                giftCardAmount: 137,
              },
            ],
          }),
        )
        .expect(400);
    });

    it('never decrements any stock row for a gift-card product', async () => {
      const { shopSlug, outletId, giftCardProductId } = await setupShop(
        'gc-purchase-no-stock',
      );
      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            items: [
              {
                productId: giftCardProductId,
                quantity: 1,
                giftCardAmount: 100,
              },
            ],
          }),
        )
        .expect(201);
      const stockRow = await prisma.outletstock.findUnique({
        where: {
          outletId_productId: { outletId, productId: giftCardProductId },
        },
      });
      expect(stockRow).toBeNull();
    });
  });

  describe('admin-issued cards', () => {
    it('an admin can issue, disable, and re-enable a card', async () => {
      const { adminToken } = await setupShop('gc-admin-crud');
      const created = await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ initialValue: 150 })
        .expect(201);
      const card = body<GiftCardRow>(created);
      expect(card.status).toBe('active');
      expect(card.remainingBalance).toBe('150');

      const disabled = await request(app.getHttpServer())
        .patch(`/gift-cards/${card.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' })
        .expect(200);
      expect(body<GiftCardRow>(disabled).status).toBe('disabled');

      const reEnabled = await request(app.getHttpServer())
        .patch(`/gift-cards/${card.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
      expect(body<GiftCardRow>(reEnabled).status).toBe('active');
    });
  });

  describe('redemption at checkout', () => {
    async function issueCard(adminToken: string, value: number) {
      const res = await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ initialValue: value })
        .expect(201);
      return body<GiftCardRow>(res);
    }

    it('a code that fully covers the order draws down the exact amount, needs no other payment, and marks the order paid', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('gc-redeem-full');
      const card = await issueCard(adminToken, 500); // product is 80 AED

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            giftCardCode: card.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const order = body<OrderCreateResponse>(res).order;
      expect(order.giftCardId).not.toBeNull();
      expect(Number(order.giftCardAmount)).toBe(Number(order.total));
      expect(order.paymentStatus).toBe('paid');

      const updatedCard = await prisma.giftcard.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(Number(updatedCard.remainingBalance)).toBe(
        500 - Number(order.total),
      );
    });

    it('a code with less balance than the order combines with the selected payment method for the remainder', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('gc-redeem-partial');
      const card = await issueCard(adminToken, 30); // product is 80 AED, gift card only covers part

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            giftCardCode: card.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const order = body<OrderCreateResponse>(res).order;
      expect(Number(order.giftCardAmount)).toBe(30);
      expect(Number(order.total)).toBeGreaterThan(30);
      // Not fully covered — still needs the selected payment method for the rest.
      expect(order.paymentStatus).not.toBe('paid');

      const updatedCard = await prisma.giftcard.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(Number(updatedCard.remainingBalance)).toBe(0);
      expect(updatedCard.status).toBe('redeemed');
    });

    it('validate endpoint reflects the live balance and rejects a disabled card', async () => {
      const { shopSlug, adminToken } = await setupShop('gc-validate');
      const card = await issueCard(adminToken, 75);

      const ok = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/gift-cards/validate`)
        .send({ code: card.code })
        .expect(201);
      expect(body<ValidateGiftCardResponse>(ok)).toMatchObject({
        valid: true,
        remainingBalance: 75,
      });

      await request(app.getHttpServer())
        .patch(`/gift-cards/${card.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' })
        .expect(200);

      const rejected = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/gift-cards/validate`)
        .send({ code: card.code })
        .expect(201);
      expect(body<ValidateGiftCardResponse>(rejected).valid).toBe(false);
    });

    it('two concurrent orders racing to spend a balance smaller than either order never both succeed in overdrawing it', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('gc-redeem-race');
      const card = await issueCard(adminToken, 80); // exactly one order's worth

      const attempt = () =>
        request(app.getHttpServer())
          .post(`/public/${shopSlug}/orders`)
          .send(
            orderPayload(outletId, {
              giftCardCode: card.code,
              items: [{ productId, quantity: 1 }],
            }),
          );

      const [a, b] = await Promise.all([attempt(), attempt()]);
      const statuses = [a.status, b.status].sort();
      // One succeeds (full balance applied), the other either fails outright
      // or succeeds with $0 applied from this card — either way, the
      // balance must never go negative.
      expect(statuses[0]).toBe(201);

      const updatedCard = await prisma.giftcard.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(Number(updatedCard.remainingBalance)).toBeGreaterThanOrEqual(0);
      expect(Number(updatedCard.remainingBalance)).toBeLessThanOrEqual(80);
    });
  });

  describe('refund credits back to the gift card, not the payment provider', () => {
    it('a full refund on a fully-gift-card-paid order credits the whole amount back and never calls a provider', async () => {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop('gc-refund-full');
      const issued = await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ initialValue: 500 })
        .expect(201);
      const card = body<GiftCardRow>(issued);

      const orderRes = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            giftCardCode: card.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const order = body<OrderCreateResponse>(orderRes).order;

      const balanceAfterPurchaseRedemption =
        await prisma.giftcard.findUniqueOrThrow({ where: { id: card.id } });

      // Deliver then return it in full.
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'delivered' },
      });
      const orderDetail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const orderItemId = body<{ orderitem: { id: number }[] }>(orderDetail)
        .orderitem[0].id;

      const returnRes = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'changed_mind',
          items: [{ orderItemId, quantity: 1 }],
          restock: false,
        })
        .expect(201);
      const orderReturn = body<OrderReturnResponse>(returnRes);
      expect(orderReturn.refundMethod).toBe('manual'); // nothing charged to a provider
      expect(Number(orderReturn.giftCardRefundAmount)).toBe(
        Number(orderReturn.refundAmount),
      );

      const finalCard = await prisma.giftcard.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(Number(finalCard.remainingBalance)).toBe(
        Number(balanceAfterPurchaseRedemption.remainingBalance) +
          Number(orderReturn.giftCardRefundAmount),
      );
      expect(finalCard.status).toBe('active'); // back above 0, auto-reactivated
    });

    it('does not double-credit on a second, separate partial return — cumulative credits stay within what was actually paid by the card', async () => {
      const { shopSlug, adminToken, outletId, productId } = await setupShop(
        'gc-refund-partial-twice',
      );
      // Two units so there are two separate order items to return separately.
      const issued = await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ initialValue: 500 })
        .expect(201);
      const card = body<GiftCardRow>(issued);

      const orderRes = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          orderPayload(outletId, {
            giftCardCode: card.code,
            items: [{ productId, quantity: 2 }],
          }),
        )
        .expect(201);
      const order = body<OrderCreateResponse>(orderRes).order;

      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'delivered' },
      });
      const orderDetail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const orderItemId = body<{
        orderitem: { id: number; quantity: number }[];
      }>(orderDetail).orderitem[0].id;

      const return1 = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'changed_mind',
          items: [{ orderItemId, quantity: 1 }],
          restock: false,
        })
        .expect(201);
      const return2 = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'other',
          items: [{ orderItemId, quantity: 1 }],
          restock: false,
        })
        .expect(201);

      const totalGiftCardRefunded =
        Number(body<OrderReturnResponse>(return1).giftCardRefundAmount) +
        Number(body<OrderReturnResponse>(return2).giftCardRefundAmount);
      // The whole order was paid via gift card — cumulative refund-to-card
      // across both returns must equal exactly what was originally charged
      // to it (order.giftCardAmount), never more.
      expect(totalGiftCardRefunded).toBeCloseTo(
        Number(order.giftCardAmount),
        5,
      );
    });
  });

  describe('tenant isolation', () => {
    it("shop A's gift card code cannot be validated or redeemed against shop B", async () => {
      const shopA = await setupShop('gc-iso-a');
      const shopB = await setupShop('gc-iso-b');
      const issued = await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ initialValue: 100 })
        .expect(201);
      const card = body<GiftCardRow>(issued);

      const validateAgainstB = await request(app.getHttpServer())
        .post(`/public/${shopB.shopSlug}/gift-cards/validate`)
        .send({ code: card.code })
        .expect(201);
      expect(body<ValidateGiftCardResponse>(validateAgainstB).valid).toBe(
        false,
      );

      const orderAgainstB = await request(app.getHttpServer())
        .post(`/public/${shopB.shopSlug}/orders`)
        .send(
          orderPayload(shopB.outletId, {
            giftCardCode: card.code,
            items: [{ productId: shopB.productId, quantity: 1 }],
          }),
        );
      expect(orderAgainstB.status).toBe(400);

      // Shop B never sees shop A's card in its own admin list.
      const listB = await request(app.getHttpServer())
        .get('/gift-cards')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<GiftCardRow[]>(listB).some((c) => c.code === card.code)).toBe(
        false,
      );

      // Shop B cannot fetch/update shop A's card by id either.
      await request(app.getHttpServer())
        .get(`/gift-cards/${card.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
    });
  });
});
