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
interface SearchResult {
  products: { id: number; name: string; sku: string }[];
  orders: { id: number; customerName: string }[];
  customers: { id: number; name: string }[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Global search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
        name: 'Search Test Admin',
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

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    return { adminToken, outletId, categoryId };
  }

  async function createProduct(adminToken: string, categoryId: number, name: string) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `SRCH-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    return body<IdRow>(res);
  }

  async function createOrder(adminToken: string, outletId: number, productId: number, customerName: string) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName,
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    return body<IdRow>(res);
  }

  it('finds products by name and by SKU, orders by customer name, customers by name/phone', async () => {
    const { adminToken, categoryId, outletId } = await setupShop('search-basic');
    const uniqueTag = `Zephyr${runId}`;
    const product = await createProduct(adminToken, categoryId, `${uniqueTag} Widget`);
    await createOrder(adminToken, outletId, product.id, `${uniqueTag} Customer`);

    const byName = await request(app.getHttpServer())
      .get(`/search?q=${uniqueTag}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const result = body<SearchResult>(byName);
    expect(result.products.some((p) => p.name.includes(uniqueTag))).toBe(true);
    expect(result.orders.some((o) => o.customerName.includes(uniqueTag))).toBe(true);
    expect(result.customers.some((c) => c.name.includes(uniqueTag))).toBe(true);
  });

  it('finds an order by its numeric id', async () => {
    const { adminToken, categoryId, outletId } = await setupShop('search-by-id');
    const product = await createProduct(adminToken, categoryId, 'Search Order ID Item');
    const order = await createOrder(adminToken, outletId, product.id, 'Numeric Search Customer');

    const res = await request(app.getHttpServer())
      .get(`/search?q=${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<SearchResult>(res).orders.some((o) => o.id === order.id)).toBe(true);
  });

  it('caps each category at 5 results', async () => {
    const { adminToken, categoryId } = await setupShop('search-cap');
    const tag = `CapTest${runId}`;
    for (let i = 0; i < 8; i++) {
      await createProduct(adminToken, categoryId, `${tag} Item ${i}`);
    }
    const res = await request(app.getHttpServer())
      .get(`/search?q=${tag}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<SearchResult>(res).products.length).toBe(5);
  });

  it('returns empty categories for an empty query rather than erroring', async () => {
    const { adminToken } = await setupShop('search-empty');
    const res = await request(app.getHttpServer())
      .get('/search?q=')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const result = body<SearchResult>(res);
    expect(result).toEqual({ products: [], orders: [], customers: [] });
  });

  describe('tenant isolation + role scoping (adversarial)', () => {
    it("shop B's search never returns shop A's data, even for an identical query term", async () => {
      const shopA = await setupShop('search-tenant-a');
      const shopB = await setupShop('search-tenant-b');
      const sharedTag = `Shared${runId}`;
      await createProduct(shopA.adminToken, shopA.categoryId, `${sharedTag} Product`);

      const res = await request(app.getHttpServer())
        .get(`/search?q=${sharedTag}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<SearchResult>(res).products).toHaveLength(0);
    });

    it('branch/order_manager never see customers in search results, even with a matching name', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('search-role-customers');
      const tag = `RoleCust${runId}`;
      const product = await createProduct(adminToken, categoryId, `${tag} Item`);
      await createOrder(adminToken, outletId, product.id, `${tag} Customer`);

      const branchEmail = `search-role-branch-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch', email: branchEmail, password: 'password123', role: 'branch', outletId })
        .expect(201);
      const branchLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(branchLogin).accessToken;

      const res = await request(app.getHttpServer())
        .get(`/search?q=${tag}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);
      const result = body<SearchResult>(res);
      expect(result.customers).toHaveLength(0);
      // Products/orders still searchable — only customers is blocked.
      expect(result.products.length).toBeGreaterThan(0);
    });

    it("a branch user's order search is pinned to their own outlet", async () => {
      const { adminToken, categoryId, outletId } = await setupShop('search-branch-outlet');
      const secondOutlet = await request(app.getHttpServer())
        .post('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Second Outlet' })
        .expect(201);
      const outletId2 = body<IdRow>(secondOutlet).id;

      const tag = `OutletScope${runId}`;
      const product = await createProduct(adminToken, categoryId, `${tag} Item`);
      await createOrder(adminToken, outletId2, product.id, `${tag} Customer Elsewhere`);

      const branchEmail = `search-branch-outlet-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch', email: branchEmail, password: 'password123', role: 'branch', outletId })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      const res = await request(app.getHttpServer())
        .get(`/search?q=${tag}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);
      // The order exists but at a DIFFERENT outlet than this branch user —
      // must not show up in their search.
      expect(body<SearchResult>(res).orders).toHaveLength(0);
    });
  });
});
