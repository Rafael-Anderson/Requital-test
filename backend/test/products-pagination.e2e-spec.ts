import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface ProductRow {
  id: number;
  name: string;
  sku: string;
}
interface ProductPage {
  data: ProductRow[];
  page: number;
  pageSize: number;
  total: number;
}
function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(180000);

describe('GET /products pagination (e2e)', () => {
  let app: INestApplication<App>;
  const runId = Date.now();

  interface Shop {
    token: string;
    ids: number[];
    collectionId: number;
    inCollection: number[];
  }
  let shopA: Shop;
  let shopB: Shop;

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
    shopA = await seed('pg-a', 45);
    shopB = await seed('pg-b', 5);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seed(prefix: string, count: number): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Page Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    await verifySignupEmail(
      app.getHttpServer(),
      (signup.body as { devVerificationLink?: string }).devVerificationLink,
    );
    const token = (signup.body as { accessToken: string }).accessToken;
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cut flowers' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;
    // A product must have a collection: everything is in General, every fifth
    // product is ALSO in Cut flowers (the one the filter test looks at).
    const general = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'General' })
      .expect(201);
    const generalId = body<IdRow>(general).id;
    const ids: number[] = [];
    const inCollection: number[] = [];
    for (let i = 1; i <= count; i++) {
      const inCol = i % 5 === 0;
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send({
          // Equal names on purpose: ordering must not depend on the name.
          name: i % 2 === 0 ? 'Same name' : `Unique ${i}`,
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `${prefix.toUpperCase()}-${runId}-${i}`,
          collectionIds: inCol ? [generalId, collectionId] : [generalId],
          trackInventory: false,
        })
        .expect(201);
      ids.push(body<IdRow>(res).id);
      if (inCol) inCollection.push(body<IdRow>(res).id);
    }
    return { token, ids, collectionId, inCollection };
  }

  const get = (shop: Shop, query: string) =>
    request(app.getHttpServer())
      .get(`/products${query}`)
      .set('Authorization', `Bearer ${shop.token}`);

  it('returns one page of 20 by default, with the total', async () => {
    const res = await get(shopA, '?page=1').expect(200);
    const page = body<ProductPage>(res);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.total).toBe(45);
    expect(page.data).toHaveLength(20);
  });

  it('pages are contiguous, ordered by id, and together hold every product exactly once', async () => {
    const seen: number[] = [];
    for (const p of [1, 2, 3]) {
      const page = body<ProductPage>(
        (await get(shopA, `?page=${p}&pageSize=20`).expect(200)) as Response,
      );
      expect(page.total).toBe(45);
      seen.push(...page.data.map((r) => r.id));
    }
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen).toEqual(shopA.ids);
  });

  it('ordering is stable across repeated calls even when names are equal', async () => {
    const a = body<ProductPage>((await get(shopA, '?page=2&pageSize=10').expect(200)) as Response);
    const b = body<ProductPage>((await get(shopA, '?page=2&pageSize=10').expect(200)) as Response);
    expect(a.data.map((r) => r.id)).toEqual(b.data.map((r) => r.id));
  });

  it('honours 50 and 100, and a page past the end is empty with the same total', async () => {
    expect(
      body<ProductPage>((await get(shopA, '?pageSize=50').expect(200)) as Response).data,
    ).toHaveLength(45);
    expect(
      body<ProductPage>((await get(shopA, '?pageSize=100').expect(200)) as Response).data,
    ).toHaveLength(45);
    const past = body<ProductPage>(
      (await get(shopA, '?page=9&pageSize=20').expect(200)) as Response,
    );
    expect(past.data).toEqual([]);
    expect(past.total).toBe(45);
  });

  it('rejects a page size over the cap and nonsense values', async () => {
    await get(shopA, '?pageSize=101').expect(400);
    await get(shopA, '?pageSize=0').expect(400);
    await get(shopA, '?page=0').expect(400);
    await get(shopA, '?page=abc').expect(400);
  });

  it('is shop scoped: the other shop sees only its own rows and its own total', async () => {
    const b = body<ProductPage>((await get(shopB, '?page=1').expect(200)) as Response);
    expect(b.total).toBe(5);
    expect(b.data.map((r) => r.id).sort((x, y) => x - y)).toEqual(shopB.ids);
    expect(b.data.some((r) => shopA.ids.includes(r.id))).toBe(false);
  });

  it('filters by collection, counted over the filter, and a foreign collection matches nothing', async () => {
    const own = body<ProductPage>(
      (await get(shopA, `?page=1&collectionId=${shopA.collectionId}`).expect(200)) as Response,
    );
    expect(own.total).toBe(shopA.inCollection.length);
    expect(own.data.map((r) => r.id)).toEqual(shopA.inCollection);
    const foreign = body<ProductPage>(
      (await get(shopA, `?page=1&collectionId=${shopB.collectionId}`).expect(200)) as Response,
    );
    expect(foreign.total).toBe(0);
    expect(foreign.data).toEqual([]);
  });

  it('searches name and SKU, treating % and _ literally', async () => {
    const bySku = body<ProductPage>(
      (await get(shopA, `?page=1&search=PG-A-${runId}-7`.toLowerCase().replace('pg-a', 'PG-A')).expect(200)) as Response,
    );
    expect(bySku.data.map((r) => r.id)).toContain(shopA.ids[6]);
    const byName = body<ProductPage>(
      (await get(shopA, '?page=1&search=Same%20name').expect(200)) as Response,
    );
    expect(byName.total).toBe(22);
    const wildcard = body<ProductPage>(
      (await get(shopA, '?page=1&search=%25').expect(200)) as Response,
    );
    expect(wildcard.total).toBe(0);
  });

  it('without page or pageSize the whole catalogue is still an array (pickers and exports)', async () => {
    const res = await get(shopA, '').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as ProductRow[]).length).toBe(45);
  });
});
