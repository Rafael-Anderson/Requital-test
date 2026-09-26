import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderRow {
  id: number;
  total: string;
  taxAmount: string | null;
  deliveryFee: string | null;
  discountAmount: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Each test stands up its own shop so it can pick its own tax rate, and a
// couple of them walk a full create -> edit sequence. Same reasoning as
// order-items-edit.e2e-spec.ts's own bump.
jest.setTimeout(45000);

// The two bugs this file exists for, both in OrdersService:
//
//  1. `create` computed `subtotal + deliveryFee - discountAmount` and omitted
//     taxAmount from its INSERT entirely, so an order taken by phone was
//     charged 0% VAT while the same basket through the storefront was charged
//     the shop's rate. The storefront path was always correct, so nothing in
//     the suite noticed - there was no test asserting an ADMIN-created order's
//     tax at all, which is precisely how it survived.
//
//  2. `updateDeliveryFee` recomputed `subtotal + dto.deliveryFee`, dropping the
//     order's discount AND its tax. Editing the delivery fee on a discounted
//     order therefore deleted the discount from the total, overcharging by
//     exactly the discount amount.
//
// Both assert real numbers rather than "a tax field exists": the un-fixed code
// produced a plausible-looking total in both cases, which is why only the
// arithmetic catches it.
describe('Admin order totals: tax and discount (e2e)', () => {
  let app: INestApplication<App>;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(
    prefix: string,
    shopSettings: Record<string, unknown> = {},
  ) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Totals Admin',
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

    if (Object.keys(shopSettings).length > 0) {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(shopSettings)
        .expect(200);
    }

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Totals Collection' })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Totals Rose',
        price: 100,
        thumbnail: 'https://example.com/t.jpg',
        sku: `TOT-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    return { adminToken, outletId, productId: body<IdRow>(product).id };
  }

  function createOrder(
    shop: { adminToken: string; outletId: number; productId: number },
    overrides: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Totals Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'pickup',
        outletId: shop.outletId,
        deliveryFee: 0,
        items: [{ productId: shop.productId, quantity: 1 }],
        ...overrides,
      });
  }

  describe('tax on admin-created orders', () => {
    it('charges the shop tax rate, matching what the storefront would charge', async () => {
      const shop = await setupShop('tot-tax-excl', {
        taxRate: 5,
        taxInclusive: false,
      });
      const order = body<OrderRow>(await createOrder(shop).expect(201));

      // 100 goods, 5% exclusive -> 5 tax, 105 total. The un-fixed code stored
      // taxAmount NULL and total 100.
      expect(Number(order.taxAmount)).toBeCloseTo(5, 2);
      expect(Number(order.total)).toBeCloseTo(105, 2);
    });

    it('backs tax out of the price on a tax-inclusive shop rather than adding it', async () => {
      const shop = await setupShop('tot-tax-incl', {
        taxRate: 5,
        taxInclusive: true,
      });
      const order = body<OrderRow>(await createOrder(shop).expect(201));

      // Inclusive: the 100 already contains the tax, so the total stays 100 and
      // the tax is 100 - 100/1.05. Guards against "fixed" meaning "added tax on
      // top everywhere", which would have charged this customer 105.
      expect(Number(order.total)).toBeCloseTo(100, 2);
      expect(Number(order.taxAmount)).toBeCloseTo(4.76, 2);
    });

    it('taxes the discounted subtotal, not the list price', async () => {
      const shop = await setupShop('tot-tax-disc', {
        taxRate: 10,
        taxInclusive: false,
      });
      const discount = body<IdRow & { code: string }>(
        await request(app.getHttpServer())
          .post('/shop/discounts')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ code: `TOTDISC${runId % 100000}`, type: 'FIXED_AMOUNT', value: 20 })
          .expect(201),
      );

      const order = body<OrderRow>(
        await createOrder(shop, { discountCode: discount.code }).expect(201),
      );

      // 100 - 20 = 80 taxable, 10% -> 8 tax, 88 total. Taxing the pre-discount
      // 100 would give 10 and 90.
      expect(Number(order.taxAmount)).toBeCloseTo(8, 2);
      expect(Number(order.total)).toBeCloseTo(88, 2);
    });

    it('a draft order converted to a real order carries tax too', async () => {
      const shop = await setupShop('tot-tax-draft', {
        taxRate: 5,
        taxInclusive: false,
      });
      const draft = body<IdRow>(
        await request(app.getHttpServer())
          .post('/shop/draft-orders')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({
            customerName: 'Draft Customer',
            customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
            customerAddress: '2 Draft St',
            emirate: 'Dubai',
            outletId: shop.outletId,
            orderType: 'delivery',
            items: [{ productId: shop.productId, quantity: 1 }],
          })
          .expect(201),
      );

      const completed = await request(app.getHttpServer())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);
      const convertedOrderId = body<{ convertedOrderId: number }>(completed)
        .convertedOrderId;

      const order = body<OrderRow>(
        await request(app.getHttpServer())
          .get(`/orders/${convertedOrderId}`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );

      // Draft completion routes through OrdersService.create, so it inherited
      // the same missing-tax bug — quotes and merchant-issued invoices carried
      // no VAT at all.
      expect(Number(order.taxAmount)).toBeCloseTo(5, 2);
      expect(Number(order.total)).toBeCloseTo(105, 2);
    });
  });

  describe('editing the delivery fee', () => {
    it('preserves the discount — the total is not rebuilt from the subtotal alone', async () => {
      const shop = await setupShop('tot-fee-disc', {
        taxRate: 0,
        taxInclusive: false,
      });
      const discount = body<IdRow & { code: string }>(
        await request(app.getHttpServer())
          .post('/shop/discounts')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ code: `FEEDISC${runId % 100000}`, type: 'FIXED_AMOUNT', value: 30 })
          .expect(201),
      );

      const order = body<OrderRow>(
        await createOrder(shop, {
          orderType: 'delivery',
          discountCode: discount.code,
        }).expect(201),
      );
      expect(Number(order.total)).toBeCloseTo(70, 2); // 100 - 30

      const updated = body<OrderRow>(
        await request(app.getHttpServer())
          .patch(`/orders/${order.id}/delivery-fee`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ deliveryFee: 25 })
          .expect(200),
      );

      // 100 - 30 discount + 25 fee = 95. The un-fixed code computed
      // `subtotal + deliveryFee` = 125, overcharging by exactly the 30
      // discount. Asserting 95 (not merely "changed") is what catches it.
      expect(Number(updated.total)).toBeCloseTo(95, 2);
      expect(Number(updated.deliveryFee)).toBeCloseTo(25, 2);
      expect(Number(updated.discountAmount)).toBeCloseTo(30, 2);
    });

    it('keeps tax in the total on a tax-exclusive shop', async () => {
      const shop = await setupShop('tot-fee-tax', {
        taxRate: 5,
        taxInclusive: false,
      });
      const order = body<OrderRow>(
        await createOrder(shop, { orderType: 'delivery' }).expect(201),
      );

      const updated = body<OrderRow>(
        await request(app.getHttpServer())
          .patch(`/orders/${order.id}/delivery-fee`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ deliveryFee: 10 })
          .expect(200),
      );

      // Delivery is deliberately not taxed (order-pricing.ts's header comment),
      // so tax stays 5 on the 100 of goods and the total is 100 + 5 + 10.
      // The un-fixed code produced 110 — the tax silently vanished from the
      // total while order.taxAmount still said 5, so the order stopped adding
      // up against its own stored figures.
      expect(Number(updated.taxAmount)).toBeCloseTo(5, 2);
      expect(Number(updated.total)).toBeCloseTo(115, 2);
    });

    it('leaves the tax figure alone when items are edited but unchanged', async () => {
      const shop = await setupShop('tot-edit-noop', {
        taxRate: 5,
        taxInclusive: false,
      });
      const order = body<OrderRow>(await createOrder(shop).expect(201));
      const taxBefore = Number(order.taxAmount);

      const updated = body<OrderRow>(
        await request(app.getHttpServer())
          .patch(`/orders/${order.id}/items`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ items: [{ productId: shop.productId, quantity: 1 }] })
          .expect(200),
      );

      // updateItems recomputes tax from the new subtotal, which is correct —
      // but it used to be the only path that wrote tax at all, so it silently
      // MATERIALISED tax on an order created without any. Re-submitting the
      // same basket must now be a no-op on the figure.
      expect(Number(updated.taxAmount)).toBeCloseTo(taxBefore, 2);
      expect(Number(updated.total)).toBeCloseTo(Number(order.total), 2);
    });
  });
});
