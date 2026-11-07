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
  slug?: string;
}
interface Preview {
  total: number;
  data: { id: number; name: string }[];
}
interface PublicCollection {
  products: { id: number }[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Automated collections (e2e)', () => {
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

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Rules Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = (outlets.body as { id: number }[])[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const manual = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Manual ${slug}` })
      .expect(201);
    return { slug, token, manualId: body<IdRow>(manual).id };
  }

  async function publish(shop: { token: string }) {
    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ published: true });
    expect(res.status).toBe(200);
  }

  type Shop = Awaited<ReturnType<typeof setupShop>>;

  async function addProduct(shop: Shop, data: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `S-${runId}-${Math.random().toString(36).slice(2, 9)}`,
        collectionIds: [shop.manualId],
        ...data,
      });
    expect(res.status).toBe(201);
    return body<IdRow>(res).id;
  }

  function preview(
    shop: Shop,
    matchMode: string,
    rules: Record<string, unknown>[],
  ) {
    return request(app.getHttpServer())
      .post('/collections/rules/preview')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ matchMode, rules });
  }

  async function createAutomated(
    shop: Shop,
    name: string,
    matchMode: string,
    rules: Record<string, unknown>[],
  ) {
    const res = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ name, collectionType: 'automated', matchMode, rules });
    return res;
  }

  let a: Shop;
  let b: Shop;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    a = await setupShop('rules-a');
    b = await setupShop('rules-b');
    ids.rose = await addProduct(a, {
      name: 'Red Rose Bouquet',
      price: 50,
      compareAtPrice: 80,
      tags: ['romantic'],
      productType: 'Bouquet',
    });
    ids.tulip = await addProduct(a, {
      name: 'Tulip Box',
      price: 20,
      tags: ['spring'],
      status: 'Unavailable',
    });
    ids.pct = await addProduct(a, { name: '100% Cotton_Card', price: 5 });
    // Same name in another shop: must never match shop A rules.
    ids.otherRose = await addProduct(b, { name: 'Red Rose Bouquet', price: 50 });
    await publish(a);
    await publish(b);
  });

  it('existing/default collections stay manual with no rules', async () => {
    const res = await request(app.getHttpServer())
      .get(`/collections/${a.manualId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    const row = body<{ collectionType: string; matchMode: string; rules: unknown[] }>(res);
    expect(row.collectionType).toBe('manual');
    expect(row.rules).toEqual([]);
  });

  it('all vs any, text and number operators', async () => {
    const allRes = await preview(a, 'all', [
      { field: 'title', operator: 'contains', value: 'rose' },
      { field: 'price', operator: 'gt', value: '20' },
    ]).expect(201);
    expect(body<Preview>(allRes).data.map((p) => p.id)).toEqual([ids.rose]);

    const anyRes = await preview(a, 'any', [
      { field: 'title', operator: 'starts_with', value: 'tulip' },
      { field: 'title', operator: 'ends_with', value: 'bouquet' },
    ]).expect(201);
    expect(body<Preview>(anyRes).data.map((p) => p.id)).toEqual([
      ids.rose,
      ids.tulip,
    ]);
  });

  it('tag, status, type and compare-at set/not set', async () => {
    const tag = await preview(a, 'all', [
      { field: 'tag', operator: 'eq', value: 'spring' },
    ]).expect(201);
    expect(body<Preview>(tag).data.map((p) => p.id)).toEqual([ids.tulip]);

    const status = await preview(a, 'all', [
      { field: 'status', operator: 'neq', value: 'Unavailable' },
      { field: 'product_type', operator: 'eq', value: 'Bouquet' },
    ]).expect(201);
    expect(body<Preview>(status).data.map((p) => p.id)).toEqual([ids.rose]);

    const set = await preview(a, 'all', [
      { field: 'compare_at_price', operator: 'is_set' },
    ]).expect(201);
    expect(body<Preview>(set).data.map((p) => p.id)).toEqual([ids.rose]);
    const notSet = await preview(a, 'all', [
      { field: 'compare_at_price', operator: 'is_not_set' },
    ]).expect(201);
    expect(body<Preview>(notSet).data.map((p) => p.id)).toEqual([
      ids.tulip,
      ids.pct,
    ]);
  });

  it('NULL is unknown: a comparison on a missing value never matches', async () => {
    // tulip and pct have no compare-at price; "not equal to 1" must not match them.
    const res = await preview(a, 'all', [
      { field: 'compare_at_price', operator: 'neq', value: '1' },
    ]).expect(201);
    expect(body<Preview>(res).data.map((p) => p.id)).toEqual([ids.rose]);
    // Untracked stock is unknown, not 0.
    const stock = await preview(a, 'all', [
      { field: 'stock', operator: 'lt', value: '5' },
    ]).expect(201);
    expect(body<Preview>(stock).total).toBe(0);
    // Vendor (brand) missing: not equal never matches.
    const vendor = await preview(a, 'all', [
      { field: 'vendor', operator: 'neq', value: 'Acme' },
    ]).expect(201);
    expect(body<Preview>(vendor).total).toBe(0);
  });

  it('values are parameters: injection strings and LIKE wildcards are literal', async () => {
    const inj = await preview(a, 'all', [
      { field: 'title', operator: 'eq', value: "x' OR '1'='1" },
    ]).expect(201);
    expect(body<Preview>(inj).total).toBe(0);
    const drop = await preview(a, 'all', [
      { field: 'title', operator: 'contains', value: "'; DROP TABLE product; --" },
    ]).expect(201);
    expect(body<Preview>(drop).total).toBe(0);
    // % and _ are escaped, so "%" matches only the title that really contains it.
    const pct = await preview(a, 'all', [
      { field: 'title', operator: 'contains', value: '%' },
    ]).expect(201);
    expect(body<Preview>(pct).data.map((p) => p.id)).toEqual([ids.pct]);
    const us = await preview(a, 'all', [
      { field: 'title', operator: 'contains', value: 'n_C' },
    ]).expect(201);
    expect(body<Preview>(us).data.map((p) => p.id)).toEqual([ids.pct]);
    // Still alive.
    await preview(a, 'all', []).expect(201);
  });

  it('rejects anything outside the allowlist', async () => {
    await preview(a, 'all', [
      { field: 'name; DROP TABLE x', operator: 'eq', value: 'a' },
    ]).expect(400);
    await preview(a, 'all', [{ field: 'title', operator: 'gt', value: '1' }]).expect(400);
    await preview(a, 'all', [{ field: 'price', operator: 'gt', value: '1 OR 1=1' }]).expect(400);
    await preview(a, 'all', [{ field: 'price', operator: 'gt' }]).expect(400);
    await preview(a, 'all', [{ field: 'status', operator: 'eq', value: 'Gone' }]).expect(400);
    await preview(a, 'all', [
      { field: 'title', operator: 'eq', value: 'x'.repeat(256) },
    ]).expect(400);
    await preview(a, 'all', [
      { field: 'title', operator: 'eq', value: 'x', extra: 1 },
    ]).expect(400);
    const many = Array.from({ length: 21 }, () => ({
      field: 'title',
      operator: 'contains',
      value: 'a',
    }));
    await preview(a, 'all', many).expect(400);
    await preview(a, 'bogus', []).expect(400);
  });

  it('cross-tenant: other shops never match, and a Category rule needs an own manual collection', async () => {
    // Shop B has a product with the same name; A's preview still sees only A's.
    const res = await preview(a, 'all', [
      { field: 'title', operator: 'eq', value: 'Red Rose Bouquet' },
    ]).expect(201);
    expect(body<Preview>(res).data.map((p) => p.id)).toEqual([ids.rose]);
    const resB = await preview(b, 'all', [
      { field: 'title', operator: 'eq', value: 'Red Rose Bouquet' },
    ]).expect(201);
    expect(body<Preview>(resB).data.map((p) => p.id)).toEqual([ids.otherRose]);

    // B cannot use A's collection as a Category.
    await preview(b, 'all', [
      { field: 'category', operator: 'eq', value: String(a.manualId) },
    ]).expect(400);
    // Own manual collection works.
    const own = await preview(a, 'all', [
      { field: 'category', operator: 'eq', value: String(a.manualId) },
    ]).expect(201);
    expect(body<Preview>(own).total).toBe(3);
  });

  it('automated collection: storefront shows only Available matches; edits and delete work', async () => {
    const created = await createAutomated(a, 'Roses and tulips', 'any', [
      { field: 'title', operator: 'contains', value: 'rose' },
      { field: 'title', operator: 'contains', value: 'tulip' },
    ]);
    expect(created.status).toBe(201);
    const col = body<IdRow>(created);

    const pub = await request(app.getHttpServer())
      .get(`/public/${a.slug}/collections/${col.slug}`)
      .expect(200);
    // tulip is Unavailable, so it is not shown.
    expect(body<PublicCollection>(pub).products.map((p) => p.id)).toEqual([ids.rose]);

    const got = await request(app.getHttpServer())
      .get(`/collections/${col.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(body<{ rules: unknown[] }>(got).rules).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/collections/${col.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ matchMode: 'all' })
      .expect(200);
    const pub2 = await request(app.getHttpServer())
      .get(`/public/${a.slug}/collections/${col.slug}`)
      .expect(200);
    expect(body<PublicCollection>(pub2).products).toHaveLength(0);

    await request(app.getHttpServer())
      .delete(`/collections/${col.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
  });

  it('a manual collection is untouched by the new fields', async () => {
    await addProduct(a, { name: 'Manual member', price: 1 });
    const pub = await request(app.getHttpServer())
      .get(`/public/${a.slug}/collections/${a.manualId}`);
    // slug lookup, not id: fall back to listing through products?collectionId
    expect([200, 404]).toContain(pub.status);
    const list = await request(app.getHttpServer())
      .get(`/public/${a.slug}/products`)
      .query({ collectionId: a.manualId })
      .expect(200);
    expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});
