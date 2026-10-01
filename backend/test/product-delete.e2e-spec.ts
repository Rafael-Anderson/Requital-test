import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface VariantRow {
  id: number;
  label: string | null;
}
interface ProductRow {
  id: number;
  variants: VariantRow[];
}

// A product with options is the case that used to fail with MySQL 1452: the
// FK cascade product -> productoption -> productoptionvalue SET NULLs
// productvariant.optionValueNId while the product row is mid-delete.
describe('Product delete (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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
        name: 'Del Admin',
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
    const auth = { Authorization: `Bearer ${token}` };
    const outlets = await request(app.getHttpServer()).get('/outlets').set(auth).expect(200);
    const outletId = (outlets.body as { id: number }[])[0].id;
    const col = await request(app.getHttpServer())
      .post('/collections')
      .set(auth)
      .send({ name: 'General' })
      .expect(201);
    return { token, auth, outletId, collectionId: (col.body as { id: number }).id };
  }
  type Shop = Awaited<ReturnType<typeof setupShop>>;

  // Two options (Color x Size) => 4 variants, an image, stock, a collection.
  async function createVariantProduct(shop: Shop): Promise<ProductRow> {
    const created = await request(app.getHttpServer())
      .post('/products')
      .set(shop.auth)
      .send({
        name: `Del Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/a.jpg',
        sku: `DEL-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [shop.collectionId],
        images: [{ url: 'https://example.com/b.jpg', order: 0 }],
        status: 'Available',
      })
      .expect(201);
    const id = (created.body as { id: number }).id;
    await request(app.getHttpServer())
      .put(`/products/${id}/options`)
      .set(shop.auth)
      .send({
        options: [
          { name: 'Color', values: ['Red', 'Blue'] },
          { name: 'Size', values: ['S', 'L'] },
        ],
      })
      .expect(200);
    const detail = await request(app.getHttpServer()).get(`/products/${id}`).set(shop.auth).expect(200);
    const p = detail.body as ProductRow;
    expect(p.variants).toHaveLength(4);
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set(shop.auth)
      .send({
        outletId: shop.outletId,
        adjustments: [{ productId: id, variantId: p.variants[0].id, delta: 5 }],
      })
      .expect(200);
    return p;
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const rows = await db.query<(RowDataPacket & { n: number })[]>(sql, params);
    return Number(rows[0].n);
  }

  // Every table that hangs off a product (directly or through a variant/option).
  async function leftovers(productId: number, variantIds: number[] = []): Promise<Record<string, number>> {
    const vIds = [...variantIds, -1].map(() => '?').join(', ');
    const by = (t: string, col = 'productId') =>
      count(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`, [productId]);
    return {
      product: await by('product', 'id'),
      productvariant: await by('productvariant'),
      productoption: await by('productoption'),
      productoptionvalue: await count(
        `SELECT COUNT(*) AS n FROM productoptionvalue v
           LEFT JOIN productoption o ON o.id = v.optionId WHERE o.id IS NULL`,
        [],
      ),
      productimage: await by('productimage'),
      productcollection: await by('productcollection'),
      productingredient: await by('productingredient'),
      // A variant's shadow ingredient is keyed by shadowVariantId, not shadowProductId.
      shadowIngredient: await count(
        `SELECT COUNT(*) AS n FROM ingredient WHERE shadowProductId = ? OR shadowVariantId IN (${vIds})`,
        [productId, ...variantIds, -1],
      ),
      stockmovement: await by('stockmovement'),
      outletingredientstock: await count(
        `SELECT COUNT(*) AS n FROM outletingredientstock s
           JOIN ingredient i ON i.id = s.ingredientId
          WHERE i.shadowProductId = ? OR i.shadowVariantId IN (${vIds})`,
        [productId, ...variantIds, -1],
      ),
    };
  }

  it('deletes a product that has options, variants, images, stock and a collection, leaving no orphans', async () => {
    const shop = await setupShop('del-ok');
    const p = await createVariantProduct(shop);
    const before = await leftovers(p.id, p.variants.map((v) => v.id));
    expect(before.productvariant).toBe(4);
    expect(before.outletingredientstock).toBeGreaterThan(0);

    const res = await request(app.getHttpServer()).delete(`/products/${p.id}`).set(shop.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: p.id, deleted: true });

    await request(app.getHttpServer()).get(`/products/${p.id}`).set(shop.auth).expect(404);
    expect(await leftovers(p.id, p.variants.map((v) => v.id))).toEqual({
      product: 0,
      productvariant: 0,
      productoption: 0,
      productoptionvalue: 0,
      productimage: 0,
      productcollection: 0,
      productingredient: 0,
      shadowIngredient: 0,
      stockmovement: 0,
      outletingredientstock: 0,
    });

    const logs = await request(app.getHttpServer())
      .get('/audit-log?entityType=product')
      .set(shop.auth)
      .expect(200);
    const rows = (logs.body as { data: { action: string; entityId: number }[] }).data;
    expect(rows.some((l) => l.action === 'product.deleted' && l.entityId === p.id)).toBe(true);
  });

  it('bulk-delete removes variant products too', async () => {
    const shop = await setupShop('del-bulk');
    const a = await createVariantProduct(shop);
    const b = await createVariantProduct(shop);
    const res = await request(app.getHttpServer())
      .delete('/products/bulk-delete')
      .set(shop.auth)
      .send({ productIds: [a.id, b.id] })
      .expect(200);
    expect((res.body as { succeeded: number }).succeeded).toBe(2);
    expect((await leftovers(a.id)).productvariant).toBe(0);
    expect((await leftovers(b.id)).productvariant).toBe(0);
  });

  it('refuses with 409 a product with order history and leaves it (and its variants) untouched', async () => {
    const shop = await setupShop('del-hist');
    const p = await createVariantProduct(shop);
    await request(app.getHttpServer())
      .post('/orders')
      .set(shop.auth)
      .send({
        customerName: 'Del Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        orderType: 'pickup',
        outletId: shop.outletId,
        deliveryFee: 0,
        items: [{ productId: p.id, variantId: p.variants[0].id, quantity: 1 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).delete(`/products/${p.id}`).set(shop.auth);
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/order history/);

    const after = await leftovers(p.id, p.variants.map((v) => v.id));
    expect(after.product).toBe(1);
    expect(after.productvariant).toBe(4);
    expect(after.productoption).toBe(2);
    expect(after.shadowIngredient).toBe(4);
    // the order line still points at its variant: the variants-first delete rolled back.
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM orderitem WHERE productId = ? AND variantId = ?`,
        [p.id, p.variants[0].id],
      ),
    ).toBe(1);
  });

  it("cannot delete another shop's product (404) and changes nothing", async () => {
    const owner = await setupShop('del-own');
    const other = await setupShop('del-oth');
    const p = await createVariantProduct(owner);

    await request(app.getHttpServer()).delete(`/products/${p.id}`).set(other.auth).expect(404);
    const res = await request(app.getHttpServer())
      .delete('/products/bulk-delete')
      .set(other.auth)
      .send({ productIds: [p.id] })
      .expect(200);
    expect((res.body as { succeeded: number }).succeeded).toBe(0);

    const after = await leftovers(p.id);
    expect(after.product).toBe(1);
    expect(after.productvariant).toBe(4);
  });
});
