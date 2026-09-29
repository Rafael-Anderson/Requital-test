import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
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
  shopId: number;
  name: string;
  rate: string;
  type: string;
  isDefault: boolean;
}
interface ProductResponse {
  id: number;
  taxClassId: number | null;
  chargeTax: boolean;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

describe('Tax classes (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
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
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Tax Admin',
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
    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    // Every product needs at least one collection - collectionIds is
    // @ArrayNotEmpty on the DTO.
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Taxable goods' })
      .expect(201);
    return {
      adminToken,
      slug,
      shopId: shopRows[0].id as number,
      collectionId: body<IdRow>(collection).id,
    };
  }

  function createProduct(
    shop: { adminToken: string; collectionId: number },
    sku: string,
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: `Taxed ${sku}`,
        price: 100,
        thumbnail: 'https://example.com/t.jpg',
        sku,
        collectionIds: [shop.collectionId],
        ...extra,
      });
  }

  // Migration 20260929120000 seeded every EXISTING shop. A shop created after it
  // needs the same two classes, or a product with no class of its own has no
  // default to resolve through.
  it('a newly signed-up shop already has a default standard class and a zero class', async () => {
    const shop = await setupShop('tax-seed');
    const res = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);

    const classes = body<TaxClass[]>(res);
    expect(classes).toHaveLength(2);
    // Default first, per findAll's ordering.
    expect(classes[0].isDefault).toBe(true);
    expect(classes[0].type).toBe('standard');
    expect(classes.map((c) => c.type).sort()).toEqual(['standard', 'zero']);
    expect(Number(classes.find((c) => c.type === 'zero')!.rate)).toBe(0);
    for (const c of classes) expect(c.shopId).toBe(shop.shopId);
  });

  it('rejects a non-zero rate on a zero-rated class', async () => {
    const shop = await setupShop('tax-badrate');
    await request(app.getHttpServer())
      .post('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Bad zero', rate: 5, type: 'zero' })
      .expect(400);
  });

  it('rejects an unknown type outright', async () => {
    const shop = await setupShop('tax-badtype');
    await request(app.getHttpServer())
      .post('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Nonsense', rate: 0, type: 'reduced' })
      .expect(400);
  });

  it('moving the default clears the previous one, leaving exactly one', async () => {
    const shop = await setupShop('tax-default');
    const created = await request(app.getHttpServer())
      .post('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Exempt goods', rate: 0, type: 'exempt', isDefault: true })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const defaults = body<TaxClass[]>(res).filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(body<IdRow>(created).id);
  });

  it('refuses to delete the default class, and refuses to clear the flag', async () => {
    const shop = await setupShop('tax-nodelete');
    const res = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const def = body<TaxClass[]>(res).find((c) => c.isDefault)!;

    await request(app.getHttpServer())
      .delete(`/tax-classes/${def.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/tax-classes/${def.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ isDefault: false })
      .expect(400);
  });

  it('deleting a class unassigns its products instead of deleting them', async () => {
    const shop = await setupShop('tax-unassign');
    const listed = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const zero = body<TaxClass[]>(listed).find((c) => c.type === 'zero')!;

    const product = await createProduct(shop, `TAX-UN-${runId}`, {
      taxClassId: zero.id,
    }).expect(201);
    const productId = body<ProductResponse>(product).id;

    const del = await request(app.getHttpServer())
      .delete(`/tax-classes/${zero.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<{ productsUnassigned: number }>(del).productsUnassigned).toBe(1);

    // The product survives with a NULL class, not deleted and not pointing at a
    // dangling id.
    const after = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<ProductResponse>(after).taxClassId).toBeNull();
  });

  it('assigns and reassigns a class on a product', async () => {
    const shop = await setupShop('tax-assign');
    const listed = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const classes = body<TaxClass[]>(listed);
    const standard = classes.find((c) => c.type === 'standard')!;
    const zero = classes.find((c) => c.type === 'zero')!;

    const created = await createProduct(shop, `TAX-AS-${runId}`, {
      taxClassId: standard.id,
    }).expect(201);
    const productId = body<ProductResponse>(created).id;
    expect(body<ProductResponse>(created).taxClassId).toBe(standard.id);

    const patched = await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxClassId: zero.id })
      .expect(200);
    expect(body<ProductResponse>(patched).taxClassId).toBe(zero.id);

    // null is a real state: "no class of its own", resolved through the shop
    // default by the per-line computation.
    const cleared = await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxClassId: null })
      .expect(200);
    expect(body<ProductResponse>(cleared).taxClassId).toBeNull();
  });

  it('a duplicated product inherits the tax class', async () => {
    const shop = await setupShop('tax-dup');
    const listed = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const zero = body<TaxClass[]>(listed).find((c) => c.type === 'zero')!;

    const created = await createProduct(shop, `TAX-DUP-${runId}`, {
      taxClassId: zero.id,
    }).expect(201);
    const duplicate = await request(app.getHttpServer())
      .post(`/products/${body<ProductResponse>(created).id}/duplicate`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/products/${body<IdRow>(duplicate).id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<ProductResponse>(fetched).taxClassId).toBe(zero.id);
  });

  // The tenant-isolation case: a crafted taxClassId from another shop must never
  // attach, the same discipline every outletId-taking write follows.
  it('rejects another shop tax class id on create and on update', async () => {
    const mine = await setupShop('tax-mine');
    const theirs = await setupShop('tax-theirs');

    const theirClasses = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${theirs.adminToken}`)
      .expect(200);
    const foreignId = body<TaxClass[]>(theirClasses)[0].id;

    await createProduct(mine, `TAX-X1-${runId}`, {
      taxClassId: foreignId,
    }).expect(404);

    const ok = await createProduct(mine, `TAX-X2-${runId}`).expect(
      201,
    );
    await request(app.getHttpServer())
      .patch(`/products/${body<ProductResponse>(ok).id}`)
      .set('Authorization', `Bearer ${mine.adminToken}`)
      .send({ taxClassId: foreignId })
      .expect(404);

    // And the class itself is unreachable across shops.
    await request(app.getHttpServer())
      .get(`/tax-classes/${foreignId}`)
      .set('Authorization', `Bearer ${mine.adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/tax-classes/${foreignId}`)
      .set('Authorization', `Bearer ${mine.adminToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/tax-classes/${foreignId}`)
      .set('Authorization', `Bearer ${mine.adminToken}`)
      .expect(404);
  });

  it('a duplicate class name in one shop conflicts, but the same name in another shop does not', async () => {
    const a = await setupShop('tax-dupname-a');
    const b = await setupShop('tax-dupname-b');
    await request(app.getHttpServer())
      .post('/tax-classes')
      .set('Authorization', `Bearer ${a.adminToken}`)
      .send({ name: 'Standard', rate: 5, type: 'standard' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/tax-classes')
      .set('Authorization', `Bearer ${b.adminToken}`)
      .send({ name: 'Exempt', rate: 0, type: 'exempt' })
      .expect(201);
  });

  it('shop.taxOnDelivery round-trips and defaults to false', async () => {
    const shop = await setupShop('tax-delivery');
    const before = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<{ taxOnDelivery: boolean }>(before).taxOnDelivery).toBe(false);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxOnDelivery: true })
      .expect(200);
    const after = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<{ taxOnDelivery: boolean }>(after).taxOnDelivery).toBe(true);
  });

  // B1 is schema and assignment only. The per-line computation is B2, so nothing
  // here may move a price yet — this is the guard against that leaking early.
  it('assigning a tax class does NOT change what an order charges', async () => {
    const shop = await setupShop('tax-noprice');
    const listed = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const zero = body<TaxClass[]>(listed).find((c) => c.type === 'zero')!;

    // A 10% shop rate, so a tax change would be unmistakable in the total.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxRate: 10, taxInclusive: false })
      .expect(200);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Taxable' })
      .expect(201);
    const product = await createProduct(shop, `TAX-NP-${runId}`, {
      collectionIds: [body<IdRow>(collection).id],
    }).expect(201);
    const productId = body<ProductResponse>(product).id;
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);

    function order() {
      return request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId,
          customerName: 'Tax Customer',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          emirate: 'Dubai',
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          items: [{ productId, quantity: 1 }],
        })
        .expect(201);
    }

    const first = await order();
    const baseline = body<{ order: { total: string; taxAmount: string } }>(
      first,
    ).order;

    // Put the product on the ZERO class and order the same thing again.
    await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxClassId: zero.id })
      .expect(200);

    const second = await order();
    const after = body<{ order: { total: string; taxAmount: string } }>(second)
      .order;

    expect(Number(after.total)).toBeCloseTo(Number(baseline.total), 6);
    expect(Number(after.taxAmount)).toBeCloseTo(Number(baseline.taxAmount), 6);
  });
});
