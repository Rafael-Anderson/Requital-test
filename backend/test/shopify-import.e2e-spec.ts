/* eslint-disable @typescript-eslint/no-unsafe-argument -- RowDataPacket rows are untyped; ids read back from the DB are passed straight into the next query */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
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
interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}
interface ProductReport {
  handle: string;
  action: string;
  reason: string | null;
  changes: FieldChange[];
  variantChanges: (FieldChange & { sku: string })[];
  variants: {
    total: number;
    toCreate: number;
    toUpdate: number;
    notMatched: number;
  };
  images: { total: number; toAdd: number; urls: string[] };
  stockUpdates: number;
  warnings: string[];
  errors: string[];
}
interface Report {
  source: string;
  currency: string;
  currencyNote: string;
  totals: Record<string, number>;
  products: ProductReport[];
  warnings: string[];
  unsupportedColumns: string[];
}
interface ConfirmResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  report: Report;
}

function body<T>(res: Response): T {
  return res.body as T;
}

const FIXTURE = readFileSync(join(__dirname, 'fixtures/shopify-products.csv'));
const HEADER =
  'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Image Src,Image Position,Status,Cost per item';

describe('Shopify product import (e2e)', () => {
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
        name: 'Importer',
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
    const outletId = body<IdRow[]>(outlets)[0].id;
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Imported' })
      .expect(201);
    const shopRows = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      slug,
      token,
      outletId,
      collectionId: body<IdRow>(collection).id,
      shopId: shopRows[0].id,
    };
  }

  type Shop = Awaited<ReturnType<typeof setupShop>>;

  function send(
    kind: 'preview' | 'confirm',
    shop: Shop,
    csv: Buffer | string,
    query: Record<string, string | number | undefined> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/products/import/${kind}`)
      .query({ source: 'shopify', ...query })
      .set('Authorization', `Bearer ${shop.token}`)
      .attach(
        'file',
        Buffer.isBuffer(csv) ? csv : Buffer.from(csv),
        'products.csv',
      );
  }

  const productCount = async (shopId: number) => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM product WHERE shopId = ?`,
      [shopId],
    );
    return Number(rows[0].c);
  };

  const find = (report: Report, handle: string) => {
    const hit = report.products.find((p) => p.handle === handle);
    if (!hit) throw new Error(`no report for ${handle}`);
    return hit;
  };

  let a: Shop;
  let b: Shop;

  beforeAll(async () => {
    a = await setupShop('shop-imp-a');
    b = await setupShop('shop-imp-b');
  });

  describe('preview (dry run)', () => {
    it('reports every product, writes nothing, and states the currency', async () => {
      const before = await productCount(a.shopId);
      const res = body<Report>(
        await send('preview', a, FIXTURE, {
          collectionId: a.collectionId,
          outletId: a.outletId,
        }).expect(201),
      );
      expect(await productCount(a.shopId)).toBe(before);
      expect(res.source).toBe('shopify');
      expect(res.currency).toBe('AED');
      expect(res.currencyNote).toMatch(/AED/);
      expect(res.totals).toMatchObject({
        products: 7,
        create: 4,
        update: 0,
        skip: 0,
        error: 3,
      });
      expect(res.unsupportedColumns).toEqual(['Google Shopping / Gender']);

      const rose = find(res, 'red-rose-bouquet');
      expect(rose.action).toBe('create');
      expect(rose.variants).toMatchObject({ total: 3, toCreate: 3 });
      expect(rose.images).toMatchObject({ total: 3, toAdd: 3 });
      expect(rose.images.urls[0]).toContain('rose-1.jpg');
      expect(rose.stockUpdates).toBe(3);
      // The raw description is never echoed; what was dropped is reported.
      expect(rose.warnings.join(' ')).toMatch(/<script>/);
      expect(rose.warnings.join(' ')).toMatch(/<img>/);
      expect(JSON.stringify(res)).not.toContain('alert(');
    });

    it('lists errors with their row numbers, errors first', async () => {
      const res = body<Report>(
        await send('preview', a, FIXTURE, {
          collectionId: a.collectionId,
        }).expect(201),
      );
      expect(res.products.slice(0, 3).every((p) => p.action === 'error')).toBe(
        true,
      );
      expect(find(res, 'Bad-Handle').errors.join(' ')).toMatch(/lowercase/);
      expect(find(res, 'broken-price').errors.join(' ')).toMatch(
        /Row \d+: Variant Price/,
      );
      expect(find(res, 'no-image-item').errors.join(' ')).toMatch(/Image Src/);
    });

    it('does not import stock without an outlet and says so', async () => {
      const res = body<Report>(
        await send('preview', a, FIXTURE, {
          collectionId: a.collectionId,
        }).expect(201),
      );
      expect(find(res, 'red-rose-bouquet').stockUpdates).toBe(0);
      expect(res.warnings.join(' ')).toMatch(/No outlet was chosen/);
    });

    it('needs a collection for new products', async () => {
      const res = body<Report>(await send('preview', a, FIXTURE).expect(201));
      expect(find(res, 'red-rose-bouquet').errors.join(' ')).toMatch(
        /Choose a collection/,
      );
      expect(res.totals.create).toBe(0);
    });
  });

  describe('confirm', () => {
    it('creates products with variants, options, images, tags, SEO and exact money', async () => {
      const res = body<ConfirmResult>(
        await send('confirm', a, FIXTURE, {
          collectionId: a.collectionId,
          outletId: a.outletId,
        }).expect(201),
      );
      expect(res).toMatchObject({ created: 4, updated: 0, errors: 3 });

      const products = await db.query<RowDataPacket[]>(
        `SELECT * FROM product WHERE shopId = ? ORDER BY id`,
        [a.shopId],
      );
      expect(products.map((p) => p.slug as string)).toEqual([
        'red-rose-bouquet',
        'ceramic-vase',
        'gift-wrap',
        'formula-title',
      ]);
      const rose = products[0];
      expect(Number(rose.price)).toBe(150);
      expect(String(rose.price)).toMatch(/^150(\.0+)?$/);
      expect(String(rose.compareAtPrice)).toMatch(/^180(\.0+)?$/);
      expect(String(rose.costPrice)).toMatch(/^80\.25(0+)?$/);
      expect(String(rose.weight)).toMatch(/^1\.5(0+)?$/);
      expect(rose.sku).toBe('RRB-S-RED');
      expect(rose.vendor).toBe('Petal & Co');
      expect(rose.productType).toBe('Bouquet');
      expect(rose.metaTitle).toBe('Red Rose Bouquet | Petal & Co');
      expect(rose.status).toBe('Available');
      expect(rose.trackInventory).toBe(true);
      expect(rose.showVariants).toBe(true);
      expect(rose.thumbnail).toContain('rose-1.jpg');
      expect(products[1].status).toBe('Unavailable');
      expect(products[2].status).toBe('Archived');
      expect(products[2].chargeTax).toBe(false);
      expect(products[2].physicalProduct).toBe(false);
      // A formula-looking title is data, stored verbatim.
      expect(products[3].name).toBe(
        '=HYPERLINK("http://evil.example","click")',
      );

      const variants = await db.query<RowDataPacket[]>(
        `SELECT v.*, o1.value AS o1, o2.value AS o2 FROM productvariant v
         LEFT JOIN productoptionvalue o1 ON o1.id = v.optionValue1Id
         LEFT JOIN productoptionvalue o2 ON o2.id = v.optionValue2Id
         WHERE v.productId = ? ORDER BY v.\`order\``,
        [rose.id],
      );
      expect(variants.map((v): unknown[] => [v.o1, v.o2, v.sku])).toEqual([
        ['Small', 'Red', 'RRB-S-RED'],
        ['Large', 'Red', 'RRB-L-RED'],
        ['Large', 'Gold', 'RRB-L-GOLD'],
      ]);
      expect(variants.map((v) => Number(v.price))).toEqual([150, 220.5, 235]);
      expect(variants[2].compareAtPrice).toBeNull();
      const options = await db.query<RowDataPacket[]>(
        `SELECT name FROM productoption WHERE productId = ? ORDER BY \`order\``,
        [rose.id],
      );
      expect(options.map((o) => o.name as string)).toEqual(['Size', 'Ribbon']);

      const images = await db.query<RowDataPacket[]>(
        `SELECT id, url FROM productimage WHERE productId = ? ORDER BY \`order\``,
        [rose.id],
      );
      expect(images).toHaveLength(3);
      // The per-variant image points at the product image row for that URL.
      const image2 = images.find((i) =>
        (i.url as string).includes('rose-2.jpg'),
      );
      expect(variants[1].imageId).toBe(image2?.id);

      const tags = await db.query<RowDataPacket[]>(
        `SELECT t.name FROM producttag pt JOIN tag t ON t.id = pt.tagId WHERE pt.productId = ? ORDER BY t.name`,
        [rose.id],
      );
      expect(tags.map((t) => t.name as string).sort()).toEqual([
        'Valentine',
        'red',
        'roses',
      ]);

      const link = await db.query<RowDataPacket[]>(
        `SELECT collectionId FROM productcollection WHERE productId = ?`,
        [rose.id],
      );
      expect(link.map((l) => l.collectionId as number)).toEqual([
        a.collectionId,
      ]);

      // Per-variant shadow ingredients carry each variant's own cost.
      const shadows = await db.query<RowDataPacket[]>(
        `SELECT i.shadowVariantId, i.costPerUnit FROM ingredient i
         WHERE i.shadowVariantId IN (${variants.map(() => '?').join(', ')}) ORDER BY i.shadowVariantId`,
        variants.map((v) => v.id as number),
      );
      expect(
        shadows.map((s) =>
          s.costPerUnit === null ? null : Number(s.costPerUnit),
        ),
      ).toEqual([80.25, 110.1, null]);
    });

    it('stores the description sanitised: no script, handlers or javascript: links', async () => {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT description FROM product WHERE shopId = ? AND slug = 'red-rose-bouquet'`,
        [a.shopId],
      );
      const html = rows[0].description as string;
      expect(html).toContain('<strong>red roses</strong>');
      expect(html).toContain(
        '<a href="https://example.com/care">care guide</a>',
      );
      expect(html).toContain('<li>12 stems</li>');
      expect(html).not.toMatch(
        /<script|<img|<table|onerror|onclick|javascript:|alert\(/i,
      );
    });

    it('writes stock to the chosen outlet only, with ledger rows that conserve', async () => {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT v.sku, s.stockQuantity,
                (SELECT COALESCE(SUM(m.delta), 0) FROM stockmovement m WHERE m.ingredientId = i.id AND m.outletId = s.outletId) AS ledger
         FROM productvariant v
         JOIN product p ON p.id = v.productId AND p.shopId = ?
         JOIN ingredient i ON i.shadowVariantId = v.id
         JOIN outletingredientstock s ON s.ingredientId = i.id
         WHERE s.outletId = ? ORDER BY v.sku`,
        [a.shopId, a.outletId],
      );
      expect(
        rows.map((r): unknown[] => [
          r.sku,
          Number(r.stockQuantity),
          Number(r.ledger),
        ]),
      ).toEqual([
        ['RRB-L-GOLD', 0, 0],
        ['RRB-L-RED', 5, 5],
        ['RRB-S-RED', 12, 12],
      ]);
      const simple = await db.query<RowDataPacket[]>(
        `SELECT s.stockQuantity,
                (SELECT SUM(m.delta) FROM stockmovement m WHERE m.ingredientId = i.id) AS ledger
         FROM product p JOIN ingredient i ON i.shadowProductId = p.id
         JOIN outletingredientstock s ON s.ingredientId = i.id
         WHERE p.shopId = ? AND p.slug = 'ceramic-vase'`,
        [a.shopId],
      );
      expect(Number(simple[0].stockQuantity)).toBe(7);
      expect(Number(simple[0].ledger)).toBe(7);
      const types = await db.query<RowDataPacket[]>(
        `SELECT DISTINCT type FROM stockmovement WHERE shopId = ?`,
        [a.shopId],
      );
      expect(types.map((t) => t.type as string)).toEqual(['IMPORT']);
    });

    it('exposes the imported variants through the normal product API', async () => {
      const list = await request(app.getHttpServer())
        .get('/products')
        .query({ outletId: a.outletId })
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);
      const payload = body<
        | { data?: { slug: string; variants?: unknown[] }[] }
        | { slug: string; variants?: unknown[] }[]
      >(list);
      const items = Array.isArray(payload) ? payload : (payload.data ?? []);
      const rose = items.find((p) => p.slug === 'red-rose-bouquet');
      expect(rose?.variants).toHaveLength(3);
    });

    it('writes nothing for the rows that had errors', async () => {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT slug FROM product WHERE shopId = ? AND slug IN ('Bad-Handle', 'bad-handle', 'broken-price', 'no-image-item')`,
        [a.shopId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('re-import and collisions', () => {
    it('importing the same file again is a no-op: every product is skipped as unchanged', async () => {
      const before = await productCount(a.shopId);
      const res = body<Report>(
        await send('preview', a, FIXTURE, {
          collectionId: a.collectionId,
          outletId: a.outletId,
        }).expect(201),
      );
      expect(res.totals).toMatchObject({
        create: 0,
        update: 0,
        skip: 4,
        error: 3,
      });
      expect(find(res, 'red-rose-bouquet').reason).toBe('No changes');
      const confirm = body<ConfirmResult>(
        await send('confirm', a, FIXTURE, {
          collectionId: a.collectionId,
          outletId: a.outletId,
        }).expect(201),
      );
      expect(confirm).toMatchObject({ created: 0, updated: 0 });
      expect(await productCount(a.shopId)).toBe(before);
    });

    it('an existing product is updated, with old to new values in the diff', async () => {
      const changed = [
        HEADER,
        'red-rose-bouquet,Red Rose Bouquet Deluxe,"<p>New text</p>",Petal & Co,Bouquet,"roses, red, deluxe",true,Size,Small,Ribbon,Red,RRB-S-RED,1500,shopify,20,deny,160.00,180.00,true,true,https://cdn.shopify.com/s/files/1/0001/0002/0003/products/rose-1.jpg?v=1700000000,1,active,80.25',
        'red-rose-bouquet,,,,,,,,Large,,Red,RRB-L-RED,2250,shopify,5,continue,225.75,250.00,true,true,https://cdn.shopify.com/s/files/1/0001/0002/0003/products/rose-4.jpg,2,,110.10',
        'red-rose-bouquet,,,,,,,,XL,,Red,RRB-XL-RED,3000,shopify,9,deny,300.00,,true,true,,,,',
      ].join('\r\n');
      const preview = body<Report>(
        await send('preview', a, changed, { outletId: a.outletId }).expect(201),
      );
      const rose = find(preview, 'red-rose-bouquet');
      expect(rose.action).toBe('update');
      expect(rose.changes).toEqual(
        expect.arrayContaining([
          {
            field: 'Title',
            from: 'Red Rose Bouquet',
            to: 'Red Rose Bouquet Deluxe',
          },
          { field: 'Price', from: '150', to: '160' },
        ]),
      );
      expect(rose.changes.find((c) => c.field === 'Tags')?.to).toBe(
        'roses, red, deluxe',
      );
      expect(rose.variantChanges).toEqual(
        expect.arrayContaining([
          { sku: 'RRB-S-RED', field: 'Price', from: '150', to: '160' },
          { sku: 'RRB-L-RED', field: 'Price', from: '220.5', to: '225.75' },
          { sku: 'RRB-S-RED', field: 'Stock', from: '12', to: '20' },
        ]),
      );
      expect(rose.images.toAdd).toBe(1);
      expect(rose.variants).toMatchObject({ toUpdate: 2, notMatched: 1 });
      expect(rose.warnings.join(' ')).toMatch(/not in Requital under that SKU/);

      await send('confirm', a, changed, { outletId: a.outletId }).expect(201);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT id, name, price FROM product WHERE shopId = ? AND slug = 'red-rose-bouquet'`,
        [a.shopId],
      );
      expect(rows[0].name).toBe('Red Rose Bouquet Deluxe');
      expect(Number(rows[0].price)).toBe(160);
      const variants = await db.query<RowDataPacket[]>(
        `SELECT sku, price FROM productvariant WHERE productId = ? ORDER BY \`order\``,
        [rows[0].id],
      );
      expect(variants.map((v): unknown[] => [v.sku, Number(v.price)])).toEqual([
        ['RRB-S-RED', 160],
        ['RRB-L-RED', 225.75],
        ['RRB-L-GOLD', 235],
      ]);
      const images = await db.query<RowDataPacket[]>(
        `SELECT url FROM productimage WHERE productId = ?`,
        [rows[0].id],
      );
      expect(images).toHaveLength(4);
      const stock = await db.query<RowDataPacket[]>(
        `SELECT s.stockQuantity,
                (SELECT SUM(m.delta) FROM stockmovement m WHERE m.ingredientId = i.id AND m.outletId = s.outletId) AS ledger
         FROM productvariant v JOIN ingredient i ON i.shadowVariantId = v.id
         JOIN outletingredientstock s ON s.ingredientId = i.id AND s.outletId = ?
         WHERE v.sku = 'RRB-S-RED' AND v.productId = ?`,
        [a.outletId, rows[0].id],
      );
      expect(Number(stock[0].stockQuantity)).toBe(20);
      expect(Number(stock[0].ledger)).toBe(20);
    });

    it('onExisting=skip leaves existing products alone', async () => {
      const csv = [
        HEADER,
        'ceramic-vase,Renamed Vase,,,,,true,Title,Default Title,,,VASE-01,800,shopify,7,deny,99.00,,true,true,https://cdn.example/v.jpg,1,active,',
      ].join('\n');
      const res = body<Report>(
        await send('preview', a, csv, { onExisting: 'skip' }).expect(201),
      );
      expect(find(res, 'ceramic-vase')).toMatchObject({ action: 'skip' });
      await send('confirm', a, csv, { onExisting: 'skip' }).expect(201);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT name FROM product WHERE shopId = ? AND slug = 'ceramic-vase'`,
        [a.shopId],
      );
      expect(rows[0].name).toBe('Ceramic Vase');
    });

    it('matches an existing product by SKU when the handle is new, and flags a handle/SKU conflict', async () => {
      const bySku = [
        HEADER,
        'totally-new-handle,Vase again,,,,,true,Title,Default Title,,,VASE-01,800,,,,89.90,,true,true,https://cdn.example/v.jpg,1,active,',
      ].join('\n');
      const res = body<Report>(await send('preview', a, bySku).expect(201));
      expect(find(res, 'totally-new-handle').action).not.toBe('create');
      const conflict = [
        HEADER,
        'ceramic-vase,Vase,,,,,true,Title,Default Title,,,WRAP,800,,,,89.90,,true,true,https://cdn.example/v.jpg,1,active,',
      ].join('\n');
      const bad = body<Report>(await send('preview', a, conflict).expect(201));
      expect(find(bad, 'ceramic-vase')).toMatchObject({ action: 'error' });
      expect(find(bad, 'ceramic-vase').errors.join(' ')).toMatch(
        /different products/,
      );
    });

    it('uses the handle as the SKU when the file has none, with a warning, and refuses a clash', async () => {
      const csv = [
        HEADER,
        'no-sku-item,No sku,,,,,true,Title,Default Title,,,,,,,,12.5,,true,true,https://cdn.example/n.jpg,1,active,',
      ].join('\n');
      const res = body<Report>(
        await send('preview', a, csv, { collectionId: a.collectionId }).expect(
          201,
        ),
      );
      expect(find(res, 'no-sku-item').action).toBe('create');
      expect(find(res, 'no-sku-item').warnings.join(' ')).toMatch(
        /handle .* is used as the SKU/,
      );
      await db.execute(
        `INSERT INTO product (shopId, name, price, thumbnail, sku, slug) VALUES (?, 'Other', 1, 'x', 'no-sku-item', 'other-slug')`,
        [a.shopId],
      );
      const clash = body<Report>(
        await send('preview', a, csv, { collectionId: a.collectionId }).expect(
          201,
        ),
      );
      expect(find(clash, 'no-sku-item').action).toBe('error');
    });

    it('keeps decimals exact and NULL for blank cost and compare-at', async () => {
      const csv = [
        HEADER,
        'precise-item,Precise,,,,,true,Title,Default Title,,,PREC-1,5,,,,10.505,,true,true,https://cdn.example/p.jpg,1,active,0.07',
        'plain-item,Plain,,,,,true,Title,Default Title,,,PLAIN-1,,,,,0.30,,true,true,https://cdn.example/q.jpg,1,active,',
      ].join('\n');
      await send('confirm', a, csv, { collectionId: a.collectionId }).expect(
        201,
      );
      const rows = await db.query<RowDataPacket[]>(
        `SELECT slug, price, compareAtPrice, costPrice, weight FROM product WHERE shopId = ? AND slug IN ('precise-item', 'plain-item') ORDER BY slug`,
        [a.shopId],
      );
      const precise = rows.find((r) => r.slug === 'precise-item')!;
      expect(String(precise.price)).toMatch(/^10\.505(0+)?$/);
      expect(String(precise.costPrice)).toMatch(/^0\.07(0+)?$/);
      expect(String(precise.weight)).toMatch(/^0\.005(0+)?$/);
      expect(precise.compareAtPrice).toBeNull();
      const plain = rows.find((r) => r.slug === 'plain-item')!;
      expect(String(plain.price)).toMatch(/^0\.3(0+)?$/);
      expect(plain.costPrice).toBeNull();
      expect(plain.weight).toBeNull();
    });
  });

  describe('malformed input and limits', () => {
    it('rejects a file that is not a Shopify export, no file, and a non-csv upload', async () => {
      await send('preview', a, 'Name,SKU\nx,y\n').expect(400);
      await request(app.getHttpServer())
        .post('/products/import/preview')
        .query({ source: 'shopify' })
        .set('Authorization', `Bearer ${a.token}`)
        .expect(400);
      await request(app.getHttpServer())
        .post('/products/import/preview')
        .query({ source: 'shopify' })
        .set('Authorization', `Bearer ${a.token}`)
        .attach('file', Buffer.from('Handle,Title'), 'p.txt')
        .expect(400);
      await send('preview', a, `${HEADER}\n`).expect(400);
    });

    it('rejects an unknown source and an unknown onExisting value', async () => {
      await send('preview', a, FIXTURE, { source: 'woo' }).expect(400);
      await send('preview', a, FIXTURE, { onExisting: 'replace' }).expect(400);
    });

    it('rejects more than the row cap', async () => {
      const lines = [HEADER];
      for (let i = 0; i < 10_001; i += 1)
        lines.push(
          `h${i},T${i},,,,,true,Title,Default Title,,,S${i},,,,,1,,,,,,,`,
        );
      await send('preview', a, lines.join('\n')).expect(400);
    });

    it('rejects an oversize file', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 'a');
      const res = await send('preview', a, big);
      expect([400, 413]).toContain(res.status);
    });

    it('treats cell text that looks like a formula as plain text, and reports bad rows with their number', async () => {
      const csv = [
        HEADER,
        'inj-item,"=cmd|\' /C calc\'!A0",,@SUM(1),,,true,Title,Default Title,,,+INJ-1,,,,,5,,true,true,https://cdn.example/i.jpg,1,active,',
        'inj-bad,Bad,,,,,true,Title,Default Title,,,INJ-2,,,,,"=1+1",,true,true,https://cdn.example/j.jpg,1,active,',
      ].join('\n');
      const res = body<Report>(
        await send('preview', a, csv, { collectionId: a.collectionId }).expect(
          201,
        ),
      );
      expect(find(res, 'inj-item').action).toBe('create');
      expect(find(res, 'inj-bad').errors.join(' ')).toMatch(
        /Row 3: Variant Price/,
      );
      await send('confirm', a, csv, { collectionId: a.collectionId }).expect(
        201,
      );
      const rows = await db.query<RowDataPacket[]>(
        `SELECT name, vendor, sku FROM product WHERE shopId = ? AND slug = 'inj-item'`,
        [a.shopId],
      );
      expect(rows[0]).toMatchObject({
        name: "=cmd|' /C calc'!A0",
        vendor: '@SUM(1)',
        sku: '+INJ-1',
      });
    });
  });

  describe('roles and tenant isolation', () => {
    it('is admin-only', async () => {
      const email = `shop-imp-viewer-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'V', email, password: 'password123', role: 'viewer' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(201);
      const viewer = { ...a, token: body<AuthResponse>(login).accessToken };
      await send('preview', viewer, FIXTURE).expect(403);
      await send('confirm', viewer, FIXTURE).expect(403);
      await request(app.getHttpServer())
        .post('/products/import/preview')
        .query({ source: 'shopify' })
        .attach('file', FIXTURE, 'p.csv')
        .expect(401);
    });

    it("rejects another shop's outlet or collection on preview and confirm, and writes nothing", async () => {
      const before = await productCount(b.shopId);
      const beforeA = await productCount(a.shopId);
      for (const kind of ['preview', 'confirm'] as const) {
        await send(kind, b, FIXTURE, { collectionId: a.collectionId }).expect(
          400,
        );
        await send(kind, b, FIXTURE, {
          collectionId: b.collectionId,
          outletId: a.outletId,
        }).expect(400);
      }
      expect(await productCount(b.shopId)).toBe(before);
      expect(await productCount(a.shopId)).toBe(beforeA);
      const foreignStock = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM stockmovement WHERE shopId = ?`,
        [b.shopId],
      );
      expect(Number(foreignStock[0].c)).toBe(0);
    });

    it("never matches or touches another shop's products, even with the same handle and SKU", async () => {
      const aRose = await db.query<RowDataPacket[]>(
        `SELECT id, name, price, updatedAt FROM (SELECT p.id, p.name, p.price, p.createdAt AS updatedAt FROM product p WHERE p.shopId = ? AND p.slug = 'red-rose-bouquet') x`,
        [a.shopId],
      );
      const preview = body<Report>(
        await send('preview', b, FIXTURE, {
          collectionId: b.collectionId,
          outletId: b.outletId,
        }).expect(201),
      );
      // Shop B has none of these, so they are creates, not updates of A's.
      expect(find(preview, 'red-rose-bouquet').action).toBe('create');
      await send('confirm', b, FIXTURE, {
        collectionId: b.collectionId,
        outletId: b.outletId,
      }).expect(201);
      const afterA = await db.query<RowDataPacket[]>(
        `SELECT id, name, price FROM product WHERE shopId = ? AND slug = 'red-rose-bouquet'`,
        [a.shopId],
      );
      expect(afterA[0].name).toBe(aRose[0].name);
      expect(String(afterA[0].price)).toBe(String(aRose[0].price));
      const bRose = await db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? AND slug = 'red-rose-bouquet'`,
        [b.shopId],
      );
      expect(bRose[0].id).not.toBe(afterA[0].id);
      // B's stock landed on B's outlet only.
      const leaked = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM stockmovement WHERE shopId = ? AND outletId = ?`,
        [b.shopId, a.outletId],
      );
      expect(Number(leaked[0].c)).toBe(0);
    });

    it('keeps the plain Requital CSV import working without a source', async () => {
      const csv =
        'Handle,Name,Description,SKU,Price,Thumbnail URL,Collections\n,Legacy,,LEG-1,5,https://cdn.example/l.jpg,Imported\n';
      const res = await request(app.getHttpServer())
        .post('/products/import/preview')
        .set('Authorization', `Bearer ${a.token}`)
        .attach('file', Buffer.from(csv), 'p.csv')
        .expect(201);
      expect(body<{ rows: { action: string }[] }>(res).rows[0].action).toBe(
        'create',
      );
    });
  });
});
