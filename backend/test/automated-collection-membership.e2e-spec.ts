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

interface IdRow {
  id: number;
}
interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface PublicTemplate {
  products: { id: number }[];
}

const OUTLET_LAT = 25.2048;
const OUTLET_LON = 55.2708;

function body<T>(res: Response): T {
  return res.body as T;
}

// Every reader that used to join productcollection directly must see an automated
// collection's rule-based members: the template collection rule, the template collection
// group, discount scoping (validate and checkout) and auto-discounts at order time.
describe('Automated collection membership everywhere (e2e)', () => {
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
        name: 'Membership Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      http(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const outlets = await request(http())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(http())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        active: true,
        deliveryEnabled: true,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    const manual = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'General' })
      .expect(201);
    const manualId = body<IdRow>(manual).id;
    return { token, outletId, manualId, slug };
  }

  async function mkProduct(
    token: string,
    manualId: number,
    name: string,
    price: number,
  ) {
    const res = await request(http())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        price,
        thumbnail: 'https://example.com/p.jpg',
        sku: `MB-${runId}-${Math.random().toString(36).slice(2, 9)}`,
        collectionIds: [manualId],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  // Automated collection "Roses": title contains "rose".
  async function mkAutomated(token: string) {
    const res = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roses',
        collectionType: 'automated',
        matchMode: 'all',
        rules: [{ field: 'title', operator: 'contains', value: 'rose' }],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  let s: Awaited<ReturnType<typeof setupShop>>;
  let rose: number, tulip: number, autoId: number;

  beforeAll(async () => {
    s = await setupShop('amm');
    rose = await mkProduct(s.token, s.manualId, 'Red Rose Bouquet', 100);
    tulip = await mkProduct(s.token, s.manualId, 'Tulip Box', 100);
    autoId = await mkAutomated(s.token);
    await request(http())
      .patch('/shop')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ published: true })
      .expect(200);
  });

  it('template RULE_BASED with a collection rule lists the automated collection’s products', async () => {
    const created = await request(http())
      .post('/templates')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        title: 'Rule Roses',
        type: 'RULE_BASED',
        rules: { collectionId: autoId },
        isActive: true,
      })
      .expect(201);
    const slug = (created.body as { slug: string }).slug;
    const pub = await request(http())
      .get(`/public/${s.slug}/templates/${slug}`)
      .expect(200);
    expect(body<PublicTemplate>(pub).products.map((p) => p.id)).toEqual([rose]);
  });

  it('template COLLECTION_GROUP unions an automated member with a manual one, de-duplicated', async () => {
    const created = await request(http())
      .post('/templates')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ title: 'Group', type: 'COLLECTION_GROUP', isActive: true })
      .expect(201);
    const t = created.body as { id: number; slug: string };
    await request(http())
      .put(`/templates/${t.id}/collections`)
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        collections: [
          { collectionId: autoId, sortOrder: 0 },
          { collectionId: s.manualId, sortOrder: 1 },
        ],
      })
      .expect(200);
    const pub = await request(http())
      .get(`/public/${s.slug}/templates/${t.slug}`)
      .expect(200);
    // automated members first (rose), then the manual collection's (rose again, tulip)
    expect(body<PublicTemplate>(pub).products.map((p) => p.id)).toEqual([
      rose,
      tulip,
    ]);
  });

  it('a template rule can never reach another shop’s collection', async () => {
    const other = await setupShop('amm-other');
    const otherAuto = await mkAutomated(other.token);
    await mkProduct(other.token, other.manualId, 'Rose Other', 5);
    const created = await request(http())
      .post('/templates')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        title: 'Foreign',
        type: 'RULE_BASED',
        rules: { collectionId: otherAuto },
        isActive: true,
      });
    if (created.status === 201) {
      const slug = (created.body as { slug: string }).slug;
      const pub = await request(http())
        .get(`/public/${s.slug}/templates/${slug}`)
        .expect(200);
      expect(body<PublicTemplate>(pub).products).toEqual([]);
    } else {
      expect(created.status).toBe(400);
    }
  });

  it('a discount scoped to the automated collection applies to its products only (validate)', async () => {
    const created = await request(http())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        code: `AUTO${runId}`.slice(0, 20),
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        collectionIds: [autoId],
      })
      .expect(201);
    const code = (created.body as { code: string }).code;
    const hit = await request(http())
      .post('/shop/discounts/validate')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        code,
        cartSubtotal: 100,
        items: [{ productId: rose, quantity: 1 }],
      });
    expect(hit.status).toBe(201);
    expect(
      Number((hit.body as { discountAmount: number }).discountAmount),
    ).toBeCloseTo(10, 2);
    const miss = await request(http())
      .post('/shop/discounts/validate')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        code,
        cartSubtotal: 100,
        items: [{ productId: tulip, quantity: 1 }],
      });
    const missAmount = Number(
      (miss.body as { discountAmount?: number }).discountAmount ?? 0,
    );
    expect(missAmount).toBe(0);
  });

  it('an auto-apply discount scoped to the automated collection is charged at order time, and not on other products', async () => {
    await request(http())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        collectionIds: [autoId],
      })
      .expect(201);
    const place = async (productId: number) => {
      const res = await request(http())
        .post(`/public/${s.slug}/orders`)
        .send({
          outletId: s.outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Member Buyer',
          customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
          customerAddress: '1 Main St',
          latitude: OUTLET_LAT,
          longitude: OUTLET_LON,
          items: [{ productId, quantity: 1 }],
        })
        .expect(201);
      const orderId = body<{ order: IdRow }>(res).order.id;
      const rows = await db.query<
        (RowDataPacket & { priceAtPurchase: string })[]
      >(`SELECT priceAtPurchase FROM orderitem WHERE orderId = ?`, [orderId]);
      return Number(rows[0].priceAtPurchase);
    };
    expect(await place(rose)).toBe(80);
    expect(await place(tulip)).toBe(100);
  });

  it('a draft order shows the discount scoped to the automated collection (draft order list)', async () => {
    const created = await request(http())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${s.token}`)
      .send({
        code: `DRAFT${runId}`.slice(0, 20),
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        collectionIds: [autoId],
      })
      .expect(201);
    const code = (created.body as { code: string }).code;
    const draftFor = async (productId: number) => {
      const res = await request(http())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${s.token}`)
        .send({
          outletId: s.outletId,
          customerName: 'Draft Buyer',
          customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
          customerAddress: '1 Main St',
          orderType: 'delivery',
          discountCode: code,
          items: [{ productId, quantity: 1 }],
        });
      return res;
    };
    const hit = await draftFor(rose);
    expect(hit.status).toBe(201);
    const hitId = (hit.body as { id: number }).id;
    const list = await request(http())
      .get('/shop/draft-orders')
      .set('Authorization', `Bearer ${s.token}`)
      .expect(200);
    const rows = (
      Array.isArray(list.body)
        ? list.body
        : (list.body as { data: unknown[] }).data
    ) as { id: number; discountAmount: number }[];
    // 10% of the rose's price after the 20% auto-discount created above (80), as stacking works today
    expect(
      Number(rows.find((r) => r.id === hitId)?.discountAmount),
    ).toBeCloseTo(8, 2);
  });
});
