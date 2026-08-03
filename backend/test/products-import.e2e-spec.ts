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
interface ProductRow {
  id: number;
  name: string;
  sku: string;
  price: string;
  vendor: string | null;
  thumbnail: string;
  status: string;
  stockQuantity: number | null;
  categories: { id: number; name: string }[];
}
interface ImportRowResult {
  rowNumber: number;
  kind: string;
  identifier: string;
  action: 'create' | 'update' | 'reject';
  errors: string[];
}
interface ImportPreviewResponse {
  rows: ImportRowResult[];
}
interface ImportConfirmResponse {
  rows: ImportRowResult[];
  created: number;
  updated: number;
  skipped: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Same column order as admin/lib/csv.ts's PRODUCT_IMPORT_HEADERS and
// backend/src/products/products-import.ts's PRODUCT_IMPORT_HEADERS — this
// suite talks to the real HTTP endpoint, not the parser directly, so it
// doubles as coverage for the hand-rolled CSV parser too.
const PRODUCT_HEADERS = [
  'Handle',
  'Name',
  'Description',
  'SKU',
  'Barcode',
  'Price',
  'Compare At Price',
  'Cost Price',
  'Status',
  'Track Inventory',
  'Charge Tax',
  'Vendor',
  'Product Type',
  'Thumbnail URL',
  'Categories',
  'Tags',
  'Variant',
  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price',
  'Stock',
];

function buildCsv(rows: Record<string, unknown>[]): string {
  const lines = [
    PRODUCT_HEADERS,
    ...rows.map((r) => PRODUCT_HEADERS.map((h) => csvCell(r[h] ?? ''))),
  ];
  return lines.map((line) => line.join(',')).join('\r\n');
}

describe('Products CSV Import/Export (e2e)', () => {
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

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Import Admin',
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

  function preview(adminToken: string, csv: string) {
    return request(app.getHttpServer())
      .post('/products/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv), {
        filename: 'products.csv',
        contentType: 'text/csv',
      });
  }

  function confirm(adminToken: string, csv: string, outletId?: number) {
    return request(app.getHttpServer())
      .post(
        `/products/import/confirm${outletId ? `?outletId=${outletId}` : ''}`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv), {
        filename: 'products.csv',
        contentType: 'text/csv',
      });
  }

  it('creates a new product from a CSV row', async () => {
    const { adminToken, categoryId } = await setupShop('import-create');
    const csv = buildCsv([
      {
        Name: 'Imported Rose Bouquet',
        SKU: `IMP-${runId}-1`,
        Price: 45,
        'Thumbnail URL': 'https://example.com/rose.jpg',
        Categories: 'General',
        Status: 'Available',
      },
    ]);

    const res = await confirm(adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(res);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.rows[0].action).toBe('create');

    const list = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const products = body<ProductRow[]>(list);
    const created = products.find((p) => p.sku === `IMP-${runId}-1`);
    expect(created).toBeDefined();
    expect(created!.name).toBe('Imported Rose Bouquet');
    expect(Number(created!.price)).toBe(45);
    expect(created!.categories.map((c) => c.id)).toContain(categoryId);
  });

  it('round-trips: re-importing an exported row is a no-op that leaves data identical', async () => {
    const shop = await setupShop('import-roundtrip');
    const original = body<ProductRow>(
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Roundtrip Vase',
          price: 60,
          thumbnail: 'https://example.com/vase.jpg',
          sku: `RT-${runId}`,
          categoryIds: [shop.categoryId],
          status: 'Available',
          vendor: 'Acme',
        })
        .expect(201),
    );

    // Mirrors exactly what admin's CSV export would produce for this row.
    const csv = buildCsv([
      {
        Name: original.name,
        SKU: original.sku,
        Price: original.price,
        'Thumbnail URL': original.thumbnail,
        Categories: 'General',
        Status: original.status,
        Vendor: original.vendor,
      },
    ]);

    const res = await confirm(shop.adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(res);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const refetch = await request(app.getHttpServer())
      .get(`/products/${original.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const after = body<ProductRow>(refetch);
    expect(after.name).toBe(original.name);
    expect(Number(after.price)).toBe(Number(original.price));
    expect(after.vendor).toBe(original.vendor);
  });

  it('reports bad rows without failing the rest of the batch', async () => {
    const { adminToken } = await setupShop('import-partial-fail');
    const csv = buildCsv([
      {
        Name: 'Good Product',
        SKU: `GOOD-${runId}`,
        Price: 30,
        'Thumbnail URL': 'https://example.com/x.jpg',
        Categories: 'General',
      },
      {
        Name: 'Bad Product',
        SKU: `BAD-${runId}`,
        Price: 'not-a-number',
        'Thumbnail URL': 'https://example.com/y.jpg',
        Categories: 'General',
      },
      {
        Name: '',
        SKU: `NONAME-${runId}`,
        Price: 20,
        'Thumbnail URL': 'https://example.com/z.jpg',
        Categories: 'General',
      },
    ]);

    const previewRes = await preview(adminToken, csv).expect(201);
    const previewed = body<ImportPreviewResponse>(previewRes);
    expect(previewed.rows).toHaveLength(3);
    expect(previewed.rows[0].action).toBe('create');
    expect(previewed.rows[1].action).toBe('reject');
    expect(previewed.rows[1].errors.some((e) => e.includes('Price'))).toBe(
      true,
    );
    expect(previewed.rows[2].action).toBe('reject');
    expect(previewed.rows[2].errors.some((e) => e.includes('Name'))).toBe(true);

    const confirmRes = await confirm(adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(confirmRes);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);

    const list = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const products = body<ProductRow[]>(list);
    expect(products.some((p) => p.sku === `GOOD-${runId}`)).toBe(true);
    expect(products.some((p) => p.sku === `BAD-${runId}`)).toBe(false);
    expect(products.some((p) => p.sku === `NONAME-${runId}`)).toBe(false);
  });

  it('distinguishes create vs update within the same batch', async () => {
    const { adminToken, categoryId } = await setupShop(
      'import-create-vs-update',
    );
    const existing = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Existing Product',
        price: 15,
        thumbnail: 'https://example.com/a.jpg',
        sku: `EXIST-${runId}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const existingId = body<ProductRow>(existing).id;

    const csv = buildCsv([
      {
        Name: 'Existing Product Renamed',
        SKU: `EXIST-${runId}`,
        Price: 18,
        Categories: 'General',
      },
      {
        Name: 'Brand New Product',
        SKU: `NEW-${runId}`,
        Price: 22,
        'Thumbnail URL': 'https://example.com/b.jpg',
        Categories: 'General',
      },
    ]);

    const res = await confirm(adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(res);
    expect(result.rows[0].action).toBe('update');
    expect(result.rows[1].action).toBe('create');
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);

    const updated = await request(app.getHttpServer())
      .get(`/products/${existingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const after = body<ProductRow>(updated);
    expect(after.name).toBe('Existing Product Renamed');
    expect(Number(after.price)).toBe(18);
  });

  it("scopes matching to the importing shop — a colliding SKU from another shop's CSV creates a new row, never updates the other shop's product", async () => {
    const shopA = await setupShop('import-tenant-a');
    const shopB = await setupShop('import-tenant-b');
    const sharedSku = `SHARED-${runId}`;

    const productA = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .send({
        name: 'Shop A Original',
        price: 100,
        thumbnail: 'https://example.com/a.jpg',
        sku: sharedSku,
        categoryIds: [shopA.categoryId],
      })
      .expect(201);
    const productAId = body<ProductRow>(productA).id;

    const csv = buildCsv([
      {
        Name: 'Shop B Attempt',
        SKU: sharedSku,
        Price: 1,
        'Thumbnail URL': 'https://example.com/evil.jpg',
        Categories: 'General',
      },
    ]);
    const res = await confirm(shopB.adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(res);
    expect(result.rows[0].action).toBe('create');
    expect(result.created).toBe(1);

    const shopAAfter = await request(app.getHttpServer())
      .get(`/products/${productAId}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    const afterA = body<ProductRow>(shopAAfter);
    expect(afterA.name).toBe('Shop A Original');
    expect(Number(afterA.price)).toBe(100);

    await request(app.getHttpServer())
      .get(`/products/${productAId}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
  });

  it('sets stock via the Stock column against the outlet passed to confirm', async () => {
    const { adminToken, outletId } = await setupShop('import-stock');
    const csv = buildCsv([
      {
        Name: 'Stocked Import',
        SKU: `STOCK-${runId}`,
        Price: 10,
        'Thumbnail URL': 'https://example.com/s.jpg',
        Categories: 'General',
        'Track Inventory': 'true',
        Stock: 25,
      },
    ]);
    await confirm(adminToken, csv, outletId).expect(201);

    const list = await request(app.getHttpServer())
      .get(`/products?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const created = body<ProductRow[]>(list).find(
      (p) => p.sku === `STOCK-${runId}`,
    );
    expect(created?.stockQuantity).toBe(25);
  });
});
