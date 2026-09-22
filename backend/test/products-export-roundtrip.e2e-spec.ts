import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PRODUCT_IMPORT_HEADERS } from '../src/products/products-import';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

function csvLines(text: string): string[] {
  return text
    .replace(/^\ufeff/, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

// A minimal RFC 4180 reader, only good enough to check the file we produced.
// Deliberately not reusing the importer's own parser: a round-trip test that
// parses with the same code that writes would pass even if both were wrong.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\ufeff/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('Products export round trip (e2e)', () => {
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
        name: 'Roundtrip Admin',
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Roundtrip Collection' })
      .expect(201);

    return { adminToken, collectionId: body<IdRow>(collection).id, slug };
  }

  function exportProducts(adminToken: string) {
    return request(app.getHttpServer())
      .get('/exports/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  }

  async function snapshotProducts(shopSlug: string) {
    const shop = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [shopSlug],
    );
    const shopId = shop[0].id as number;
    const rows = await db.query<RowDataPacket[]>(
      `SELECT p.slug, p.name, p.description, p.sku, p.barcode, p.price,
              p.compareAtPrice, p.costPrice, p.status, p.trackInventory,
              p.chargeTax, p.vendor, p.productType
         FROM product p
        WHERE p.shopId = ?
        ORDER BY p.slug`,
      [shopId],
    );
    return rows.map((r) => ({ ...r }));
  }

  it('exports headers that ARE the import headers, not a copy of them', async () => {
    const shop = await setupShop('rt-headers');
    const res = await exportProducts(shop.adminToken);
    expect(csvLines(res.text)[0]).toBe(PRODUCT_IMPORT_HEADERS.join(','));
  }, 60000);

  // THE test this export is answerable to: a file it produced has to be a file
  // the importer can read back without changing anything.
  it('re-imports its own export as a no-op', async () => {
    const shop = await setupShop('rt-noop');

    // Two products: one simple, one with a comma and a quote in fields that the
    // CSV layer has to escape and the importer has to un-escape.
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Plain Rose',
        price: 25,
        costPrice: 9,
        thumbnail: 'https://example.com/a.jpg',
        sku: `RT-PLAIN-${runId}`,
        collectionIds: [shop.collectionId],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Bouquet, "Deluxe" Edition',
        description: 'Roses, lilies\nand a note',
        price: 120,
        thumbnail: 'https://example.com/b.jpg',
        sku: `RT-QUOTED-${runId}`,
        vendor: 'Some, Vendor',
        collectionIds: [shop.collectionId],
      })
      .expect(201);

    const before = await snapshotProducts(shop.slug);
    expect(before).toHaveLength(2);

    const exported = await exportProducts(shop.adminToken);
    const parsed = parseCsv(exported.text);
    expect(parsed[0]).toEqual([...PRODUCT_IMPORT_HEADERS]);
    expect(parsed).toHaveLength(3); // header + 2 products

    // Re-import the exact bytes the export produced.
    const buffer = Buffer.from(exported.text, 'utf8');
    const preview = await request(app.getHttpServer())
      .post('/products/import/preview')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .attach('file', buffer, 'products.csv')
      .expect(201);
    // The importer must recognise every row; any parse error here means the
    // two formats have drifted.
    const previewBody = body<{ errors?: unknown[]; rows?: unknown[] }>(preview);
    expect(previewBody.errors ?? []).toEqual([]);

    await request(app.getHttpServer())
      .post('/products/import/confirm')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .attach('file', buffer, 'products.csv')
      .expect(201);

    const after = await snapshotProducts(shop.slug);

    // Same products, same field values, and crucially no duplicates: importing
    // an export must update by Handle, not create a second copy of everything.
    expect(after).toHaveLength(2);
    expect(after).toEqual(before);
  }, 120000);

  it('escapes a comma and a quote so the column count survives the trip', async () => {
    const shop = await setupShop('rt-escaping');
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Tricky, "Name" Here',
        price: 10,
        thumbnail: 'https://example.com/c.jpg',
        sku: `RT-ESC-${runId}`,
        collectionIds: [shop.collectionId],
      })
      .expect(201);

    const res = await exportProducts(shop.adminToken);
    const parsed = parseCsv(res.text);
    // Every row must have exactly as many cells as there are headers - a
    // mis-escaped comma shows up here as an extra column.
    for (const row of parsed) {
      expect(row).toHaveLength(PRODUCT_IMPORT_HEADERS.length);
    }
    const nameCell = parsed[1][PRODUCT_IMPORT_HEADERS.indexOf('Name')];
    expect(nameCell).toBe('Tricky, "Name" Here');
  }, 60000);

  it('emits one row per variant, all sharing the product Handle', async () => {
    const shop = await setupShop('rt-variants');
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Variant Rose',
        price: 30,
        thumbnail: 'https://example.com/v.jpg',
        sku: `RT-VAR-${runId}`,
        collectionIds: [shop.collectionId],
      })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/products/${body<IdRow>(product).id}/options`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        options: [{ name: 'Size', values: ['Small', 'Large'] }],
      })
      .expect(200);

    const res = await exportProducts(shop.adminToken);
    const parsed = parseCsv(res.text);
    const handleIdx = PRODUCT_IMPORT_HEADERS.indexOf('Handle');
    const variantIdx = PRODUCT_IMPORT_HEADERS.indexOf('Variant');
    const rows = parsed.slice(1);

    expect(rows).toHaveLength(2); // one per variant, not one per product
    expect(new Set(rows.map((r) => r[handleIdx])).size).toBe(1);
    expect(rows.map((r) => r[variantIdx]).sort()).toEqual(['Large', 'Small']);
  }, 90000);

  it('stays scoped to the caller shop', async () => {
    const a = await setupShop('rt-iso-a');
    const b = await setupShop('rt-iso-b');
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${b.adminToken}`)
      .send({
        name: 'Other Shop Product',
        price: 5,
        thumbnail: 'https://example.com/o.jpg',
        sku: `RT-OTHER-${runId}`,
        collectionIds: [b.collectionId],
      })
      .expect(201);

    const res = await exportProducts(a.adminToken);
    expect(res.text).not.toContain('Other Shop Product');
  }, 90000);
});
