import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
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
interface PreviewResponse {
  total: number;
  page: number;
  pageSize: number;
  products: { id: number; name: string }[];
}
interface PublicCollection {
  products: { id: number; name: string }[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Automated collections: every attribute against a real database, NULL = unknown,
// hostile values, cross-tenant isolation, pagination, and the storefront read.
describe('Automated collections (e2e)', () => {
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

  const http = () => app.getHttpServer();

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'Auto Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(http(), body<AuthResponse>(signup).devVerificationLink);
    const outlets = await request(http())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(http())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const manual = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Flowers' })
      .expect(201);
    await db.execute(`UPDATE shop SET published = 1 WHERE subdomain = ?`, [slug]);
    return { token, outletId, manualId: body<IdRow>(manual).id, slug };
  }

  async function mkProduct(
    token: string,
    collectionId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(http())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Item',
        price: 50,
        thumbnail: 'https://example.com/i.jpg',
        sku: `AU-${runId}-${Math.random().toString(36).slice(2, 9)}`,
        collectionIds: [collectionId],
        ...overrides,
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  function preview(
    token: string,
    rules: { field: string; operator: string; value?: string }[],
    matchMode = 'all',
    extra: Record<string, unknown> = {},
  ) {
    return request(http())
      .post('/collections/preview-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ matchMode, rules, ...extra });
  }

  async function ids(
    token: string,
    rules: { field: string; operator: string; value?: string }[],
    matchMode = 'all',
  ) {
    const res = await preview(token, rules, matchMode, { pageSize: 100 }).expect(201);
    return body<PreviewResponse>(res).products.map((p) => p.id).sort((a, b) => a - b);
  }

  let shop: Awaited<ReturnType<typeof setupShop>>;
  let rose: number, tulip: number, lily: number, plain: number;
  let brandAcme: number;

  beforeAll(async () => {
    shop = await setupShop('auto-main');
    const { token, manualId } = shop;
    const brand = await request(http())
      .post('/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Florals' })
      .expect(201);
    brandAcme = body<IdRow>(brand).id;
    rose = await mkProduct(token, manualId, {
      name: 'Red Rose Bouquet',
      price: 80,
      compareAtPrice: 100,
      brandId: brandAcme,
      productType: 'Bouquet',
      tags: ['romantic', 'red'],
      weight: 500,
      weightUnit: 'g',
    });
    tulip = await mkProduct(token, manualId, {
      name: 'Tulip Box',
      price: 30,
      productType: 'Box',
      tags: ['spring'],
      weight: 2,
      weightUnit: 'kg',
    });
    lily = await mkProduct(token, manualId, {
      name: 'Lily 100% Pure_Gift',
      price: 120,
      status: 'Unavailable',
      weight: 1,
      weightUnit: 'lb',
    });
    plain = await mkProduct(token, manualId, { name: 'Plain Vase', price: 80 });
    // tracked stock for rose = 4 (shadow ingredient, one outlet), tulip untracked
    await request(http())
      .patch(`/products/${rose}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ trackInventory: true })
      .expect(200);
    const ing = await db.query<{ id: number }[] & import('mysql2').RowDataPacket[]>(
      `SELECT id FROM ingredient WHERE shadowProductId = ? AND shopId = ?`,
      [rose, await shopIdOf(token)],
    );
    await db.execute(
      `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity) VALUES (?, ?, 4)
       ON DUPLICATE KEY UPDATE stockQuantity = 4`,
      [shop.outletId, ing[0].id],
    );
    // a variant on tulip: "Small / Pink"
    await request(http())
      .put(`/products/${tulip}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ options: [{ name: 'Size', values: ['Small'] }, { name: 'Colour', values: ['Pink'] }] })
      .expect(200);
  });

  async function shopIdOf(token: string): Promise<number> {
    const me = await request(http()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    return (me.body as { shopId: number }).shopId;
  }

  it('manual collections are untouched: default type, no conditions, productcollection still decides', async () => {
    const res = await request(http())
      .get(`/collections/${shop.manualId}`)
      .set('Authorization', `Bearer ${shop.token}`)
      .expect(200);
    expect(res.body).toMatchObject({ collectionType: 'manual', matchMode: 'all', rules: [] });
  });

  it('Title: contains / starts / ends / equals / not contains, and % and _ are literals', async () => {
    const t = shop.token;
    expect(await ids(t, [{ field: 'title', operator: 'contains', value: 'rose' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'title', operator: 'starts_with', value: 'tulip' }])).toEqual([tulip]);
    expect(await ids(t, [{ field: 'title', operator: 'ends_with', value: 'vase' }])).toEqual([plain]);
    expect(await ids(t, [{ field: 'title', operator: 'equals', value: 'plain vase' }])).toEqual([plain]);
    expect(await ids(t, [{ field: 'title', operator: 'not_contains', value: 'o' }])).toEqual([lily, plain].sort((a, b) => a - b));
    // "%" and "_" must match the literal character, not everything / any char
    expect(await ids(t, [{ field: 'title', operator: 'contains', value: '%' }])).toEqual([lily]);
    expect(await ids(t, [{ field: 'title', operator: 'contains', value: 'e_G' }])).toEqual([lily]);
  });

  it('Price and Compare at price: decimal comparison, NULL compare-at never matches a comparison', async () => {
    const t = shop.token;
    expect(await ids(t, [{ field: 'price', operator: 'gt', value: '79.99' }])).toEqual([rose, lily, plain].sort((a, b) => a - b));
    expect(await ids(t, [{ field: 'price', operator: 'equals', value: '80' }])).toEqual([rose, plain].sort((a, b) => a - b));
    expect(await ids(t, [{ field: 'price', operator: 'lt', value: '80' }])).toEqual([tulip]);
    expect(await ids(t, [{ field: 'compare_at_price', operator: 'gt', value: '50' }])).toEqual([rose]);
    // unknown (NULL) compare-at: "is not equal to" must NOT match the three products without one
    expect(await ids(t, [{ field: 'compare_at_price', operator: 'not_equals', value: '1' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'compare_at_price', operator: 'is_set' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'compare_at_price', operator: 'is_not_set' }])).toEqual([tulip, lily, plain].sort((a, b) => a - b));
  });

  it('Status, Tag, Category, Type, Vendor(brand), Weight, Stock, Variant title', async () => {
    const t = shop.token;
    expect(await ids(t, [{ field: 'status', operator: 'equals', value: 'Unavailable' }])).toEqual([lily]);
    expect(await ids(t, [{ field: 'status', operator: 'not_equals', value: 'Available' }])).toEqual([lily]);
    expect(await ids(t, [{ field: 'tag', operator: 'equals', value: 'spring' }])).toEqual([tulip]);
    expect((await ids(t, [{ field: 'tag', operator: 'not_equals', value: 'spring' }])).includes(tulip)).toBe(false);
    expect(await ids(t, [{ field: 'category', operator: 'equals', value: String(shop.manualId) }])).toEqual([rose, tulip, lily, plain].sort((a, b) => a - b));
    expect(await ids(t, [{ field: 'product_type', operator: 'equals', value: 'box' }])).toEqual([tulip]);
    expect(await ids(t, [{ field: 'product_type', operator: 'not_equals', value: 'box' }])).toEqual([rose]); // NULL types are unknown
    expect(await ids(t, [{ field: 'brand', operator: 'contains', value: 'acme' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'brand', operator: 'not_equals', value: 'zzz' }])).toEqual([rose]); // no brand = unknown
    // weights normalised to kg: 0.5 / 2 / 0.4536 / (none)
    expect(await ids(t, [{ field: 'weight', operator: 'lt', value: '1' }])).toEqual([rose, lily].sort((a, b) => a - b));
    expect(await ids(t, [{ field: 'weight', operator: 'gt', value: '1' }])).toEqual([tulip]);
    // stock only for the tracked product that has stock rows
    expect(await ids(t, [{ field: 'stock', operator: 'equals', value: '4' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'stock', operator: 'lt', value: '10' }])).toEqual([rose]);
    expect(await ids(t, [{ field: 'variant_title', operator: 'equals', value: 'small / pink' }])).toEqual([tulip]);
    expect(await ids(t, [{ field: 'variant_title', operator: 'contains', value: 'pink' }])).toEqual([tulip]);
    expect(await ids(t, [{ field: 'variant_title', operator: 'not_contains', value: 'pink' }])).toEqual([]); // only tulip has titled variants
  });

  it('all vs any', async () => {
    const t = shop.token;
    const rules = [
      { field: 'title', operator: 'contains', value: 'o' },
      { field: 'price', operator: 'lt', value: '100' },
    ];
    expect(await ids(t, rules, 'all')).toEqual([rose, tulip].sort((a, b) => a - b));
    expect(await ids(t, rules, 'any')).toEqual([rose, tulip, plain].sort((a, b) => a - b));
    expect(await ids(t, [])).toEqual([]); // no conditions match nothing
  });

  it('hostile values are data: nothing is injected, nothing extra matches', async () => {
    const t = shop.token;
    for (const value of ["' OR '1'='1", "'; DROP TABLE product; --", '`', '\\', '%%', '___']) {
      for (const field of ['title', 'brand', 'product_type', 'variant_title']) {
        const got = await ids(t, [{ field, operator: 'contains', value }]);
        expect(got).toEqual([]);
        expect(await ids(t, [{ field, operator: 'equals', value }])).toEqual([]);
      }
      expect(await ids(t, [{ field: 'tag', operator: 'equals', value }])).toEqual([]);
    }
    await preview(t, [{ field: 'price', operator: 'gt', value: '1; DROP TABLE product' }]).expect(400);
    await preview(t, [{ field: 'price) OR (1=1', operator: 'gt', value: '1' }]).expect(400);
    await preview(t, [{ field: 'title', operator: "contains' OR '1'='1", value: 'x' }]).expect(400);
    // the product table is intact
    expect((await ids(t, [{ field: 'title', operator: 'contains', value: 'rose' }]))).toEqual([rose]);
  });

  it('caps: 21 conditions and a 256-character value are rejected', async () => {
    const t = shop.token;
    const one = { field: 'title', operator: 'contains', value: 'x' };
    await preview(t, Array.from({ length: 21 }, () => one)).expect(400);
    await preview(t, [{ ...one, value: 'x'.repeat(256) }]).expect(400);
    await preview(t, Array.from({ length: 20 }, () => one)).expect(201);
  });

  it('paginates the preview', async () => {
    const res = await preview(shop.token, [{ field: 'price', operator: 'gt', value: '0' }], 'all', { pageSize: 2, page: 2 }).expect(201);
    const r = body<PreviewResponse>(res);
    expect(r.total).toBe(4);
    expect(r.products).toHaveLength(2);
    expect(r.page).toBe(2);
  });

  it('is tenant-scoped: another shop sees none of these products, and cannot reference this shop’s collection', async () => {
    const other = await setupShop('auto-other');
    const otherProduct = await mkProduct(other.token, other.manualId, { name: 'Red Rose Other', price: 5 });
    // same rule, other shop: only its own product
    expect(await ids(other.token, [{ field: 'title', operator: 'contains', value: 'rose' }])).toEqual([otherProduct]);
    // a Category condition pointing at the first shop's collection is rejected
    await preview(other.token, [{ field: 'category', operator: 'equals', value: String(shop.manualId) }]).expect(400);
    // and creating an automated collection with it is rejected too
    await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'Sneaky', collectionType: 'automated', matchMode: 'all', rules: [{ field: 'category', operator: 'equals', value: String(shop.manualId) }] })
      .expect(400);
  });

  it('creates, edits and switches an automated collection; the storefront shows only Available products', async () => {
    const t = shop.token;
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${t}`)
      .send({
        name: 'Cheap and Pretty',
        collectionType: 'automated',
        matchMode: 'any',
        rules: [
          { field: 'price', operator: 'lt', value: '100' },
          { field: 'status', operator: 'equals', value: 'Unavailable' },
        ],
      })
      .expect(201);
    const c = created.body as { id: number; slug: string; collectionType: string; rules: unknown[] };
    expect(c.collectionType).toBe('automated');
    expect(c.rules).toHaveLength(2);

    // storefront: Unavailable lily matches the rule but must NOT be shown
    const pub = await request(http()).get(`/public/${shop.slug}/collections/${c.slug}`);
    const names = body<PublicCollection>(pub).products.map((p) => p.id).sort((a, b) => a - b);
    expect(names).toEqual([rose, tulip, plain].sort((a, b) => a - b));

    // replace the conditions
    const upd = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ rules: [{ field: 'tag', operator: 'equals', value: 'spring' }], matchMode: 'all' })
      .expect(200);
    expect((upd.body as { rules: unknown[] }).rules).toHaveLength(1);
    const pub2 = await request(http()).get(`/public/${shop.slug}/collections/${c.slug}`);
    expect(body<PublicCollection>(pub2).products.map((p) => p.id)).toEqual([tulip]);

    // back to manual: conditions are dropped, membership comes from productcollection again (none assigned)
    const back = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ collectionType: 'manual' })
      .expect(200);
    expect(back.body).toMatchObject({ collectionType: 'manual', rules: [] });
    const pub3 = await request(http()).get(`/public/${shop.slug}/collections/${c.slug}`);
    expect(body<PublicCollection>(pub3).products).toEqual([]);

    // a Category condition may not point at an automated collection
    await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ collectionType: 'automated', rules: [{ field: 'category', operator: 'equals', value: String(c.id) }] })
      .expect(400);

    // conditions on a manual collection are refused
    await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${t}`)
      .send({ name: 'Bad', rules: [{ field: 'title', operator: 'contains', value: 'x' }] })
      .expect(400);
  });

  it('only an admin can preview or write conditions', async () => {
    await request(http()).post('/collections/preview-rules').send({ matchMode: 'all', rules: [] }).expect(401);
  });
});
