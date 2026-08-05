import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface SearchResult {
  id: number;
  name: string;
}
interface SearchResponseBody {
  results: SearchResult[];
  nextCursor: string | null;
  matchType: 'exact' | 'fuzzy' | 'none';
  suggestion: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Storefront search: GET /public/:shopSlug/search (e2e)', () => {
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

  async function setupPublishedShop(slugPrefix: string) {
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
    await verifySignupEmail(app.getHttpServer(), body<AuthResponse>(signup).devVerificationLink);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pickupEnabled: true })
      .expect(200);

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    return { adminToken, categoryId, slug };
  }

  // Publishing requires the readiness bar (outlet + at least one product
  // must already exist — see ShopService.getPublishReadiness), so this is
  // only called after a product has been created, same convention as
  // bill-of-materials.e2e-spec.ts's own publishShop.
  async function publishShop(adminToken: string) {
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
  }

  async function createProduct(adminToken: string, categoryId: number, name: string, sku: string) {
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name,
        price: 50,
        thumbnail: 'https://example.com/p.jpg',
        sku,
        categoryIds: [categoryId],
        status: 'Available',
      })
      .expect(201);
  }

  it('returns exact matches by product name', async () => {
    const { adminToken, categoryId, slug } = await setupPublishedShop('search-exact');
    await createProduct(adminToken, categoryId, 'Rose Bouquet', `SRCH-${runId}-1`);
    await publishShop(adminToken);

    const res = await request(app.getHttpServer())
      .get(`/public/${slug}/search`)
      .query({ q: 'Rose' })
      .expect(200);

    const result = body<SearchResponseBody>(res);
    expect(result.matchType).toBe('exact');
    expect(result.results.map((r) => r.name)).toContain('Rose Bouquet');
  });

  it('falls back to a typo-tolerant fuzzy match when the exact query has zero hits', async () => {
    const { adminToken, categoryId, slug } = await setupPublishedShop('search-fuzzy');
    await createProduct(adminToken, categoryId, 'Rose Bouquet', `SRCH-${runId}-2`);
    await publishShop(adminToken);

    const res = await request(app.getHttpServer())
      .get(`/public/${slug}/search`)
      .query({ q: 'roes' })
      .expect(200);

    const result = body<SearchResponseBody>(res);
    expect(result.matchType).toBe('fuzzy');
    expect(result.results.map((r) => r.name)).toContain('Rose Bouquet');
  });

  it('returns an empty result for an empty query', async () => {
    const { slug } = await setupPublishedShop('search-empty');

    const res = await request(app.getHttpServer())
      .get(`/public/${slug}/search`)
      .query({ q: '' })
      .expect(200);

    expect(body<SearchResponseBody>(res).results).toEqual([]);
  });

  it("never returns another shop's products for the same query text", async () => {
    const shopA = await setupPublishedShop('search-isolation-a');
    const shopB = await setupPublishedShop('search-isolation-b');
    await createProduct(shopA.adminToken, shopA.categoryId, 'Rose Bouquet', `SRCH-${runId}-3`);
    await publishShop(shopA.adminToken);
    await createProduct(shopB.adminToken, shopB.categoryId, 'Tulip Bouquet', `SRCH-${runId}-4`);
    await publishShop(shopB.adminToken);

    const res = await request(app.getHttpServer())
      .get(`/public/${shopB.slug}/search`)
      .query({ q: 'Rose' })
      .expect(200);

    expect(body<SearchResponseBody>(res).results).toEqual([]);
  });

  it('404s for a shop that does not exist', async () => {
    await request(app.getHttpServer())
      .get(`/public/nonexistent-shop-${runId}/search`)
      .query({ q: 'rose' })
      .expect(404);
  });
});
