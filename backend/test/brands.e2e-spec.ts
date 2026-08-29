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
interface BrandRow {
  id: number;
  name: string;
  logoUrl: string | null;
}
interface ProductResponse {
  id: number;
  brandId: number | null;
  brand: { id: number; name: string; logoUrl: string | null } | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Brand CRUD + cross-shop isolation + product wiring (brandId round-trips,
// on-delete nulls the product, public filter/list). Mirrors
// collections.e2e-spec.ts's setup shape.
describe('Brands (e2e)', () => {
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

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Brands Admin',
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

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    return { adminToken, outletId, collectionId, slug };
  }

  function createBrand(adminToken: string, name: string) {
    return request(app.getHttpServer())
      .post('/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name });
  }

  function createProduct(
    adminToken: string,
    collectionId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bouquet',
        price: 50,
        thumbnail: 'https://example.com/bouquet.jpg',
        sku: `BR-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
        ...overrides,
      });
  }

  it('creates, lists, fetches, updates and deletes a brand', async () => {
    const { adminToken } = await setupShop('brand-crud');
    const created = body<BrandRow>(
      await createBrand(adminToken, 'Acme').expect(201),
    );
    expect(created.name).toBe('Acme');

    const list = await request(app.getHttpServer())
      .get('/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<BrandRow[]>(list).some((b) => b.id === created.id)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/brands/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Acme Corp', logoUrl: 'https://example.com/l.png' })
      .expect(200);

    const fetched = await request(app.getHttpServer())
      .get(`/brands/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<BrandRow>(fetched).name).toBe('Acme Corp');
    expect(body<BrandRow>(fetched).logoUrl).toBe('https://example.com/l.png');

    await request(app.getHttpServer())
      .delete(`/brands/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('rejects a duplicate brand name within the same shop', async () => {
    const { adminToken } = await setupShop('brand-dup');
    await createBrand(adminToken, 'Nike').expect(201);
    await createBrand(adminToken, 'Nike').expect(409);
  });

  it('isolates brands across shops (404 on cross-shop read/update/delete)', async () => {
    const shopA = await setupShop('brand-iso-a');
    const shopB = await setupShop('brand-iso-b');
    const brandA = body<BrandRow>(
      await createBrand(shopA.adminToken, 'ShopA Brand').expect(201),
    );

    await request(app.getHttpServer())
      .get(`/brands/${brandA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/brands/${brandA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/brands/${brandA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);

    // Still intact for the real owner.
    await request(app.getHttpServer())
      .get(`/brands/${brandA.id}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
  });

  it('round-trips brandId on a product and rejects a foreign brandId', async () => {
    const shopA = await setupShop('brand-prod-a');
    const shopB = await setupShop('brand-prod-b');
    const brandA = body<BrandRow>(
      await createBrand(shopA.adminToken, 'Brand One').expect(201),
    );

    const product = body<ProductResponse>(
      await createProduct(shopA.adminToken, shopA.collectionId, {
        brandId: brandA.id,
      }).expect(201),
    );
    expect(product.brandId).toBe(brandA.id);
    expect(product.brand).toMatchObject({ id: brandA.id, name: 'Brand One' });

    // A brand from another shop is not a valid brandId here.
    await createProduct(shopB.adminToken, shopB.collectionId, {
      brandId: brandA.id,
    }).expect(400);
  });

  it('nulls product.brandId when the brand is deleted (no cascade)', async () => {
    const { adminToken, collectionId } = await setupShop('brand-del');
    const brand = body<BrandRow>(
      await createBrand(adminToken, 'Disposable').expect(201),
    );
    const product = body<ProductResponse>(
      await createProduct(adminToken, collectionId, {
        brandId: brand.id,
      }).expect(201),
    );

    await request(app.getHttpServer())
      .delete(`/brands/${brand.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const refetched = await request(app.getHttpServer())
      .get(`/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<ProductResponse>(refetched).brandId).toBeNull();
    expect(body<ProductResponse>(refetched).brand).toBeNull();
  });

  it('public brands list only includes brands with an Available product, and ?brandId= filters', async () => {
    const { adminToken, collectionId, slug } = await setupShop('brand-public');
    const used = body<BrandRow>(
      await createBrand(adminToken, 'Used Brand').expect(201),
    );
    const unused = body<BrandRow>(
      await createBrand(adminToken, 'Unused Brand').expect(201),
    );
    const withBrand = body<ProductResponse>(
      await createProduct(adminToken, collectionId, {
        brandId: used.id,
      }).expect(201),
    );
    await createProduct(adminToken, collectionId, {}).expect(201);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    const publicBrands = body<BrandRow[]>(
      await request(app.getHttpServer())
        .get(`/public/${slug}/brands`)
        .expect(200),
    );
    expect(publicBrands.map((b) => b.id)).toContain(used.id);
    expect(publicBrands.map((b) => b.id)).not.toContain(unused.id);

    const filtered = body<ProductResponse[]>(
      await request(app.getHttpServer())
        .get(`/public/${slug}/products?brandId=${used.id}`)
        .expect(200),
    );
    expect(filtered.map((p) => p.id)).toEqual([withBrand.id]);
    expect(filtered[0].brand).toMatchObject({ id: used.id });
  });
});
