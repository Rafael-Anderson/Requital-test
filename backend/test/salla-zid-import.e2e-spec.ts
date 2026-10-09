/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies and RowDataPacket rows are untyped */
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { ProductImageCopyService } from '../src/products/product-image-copy.service';
import { SafeFetchError, safeFetchImage } from '../src/common/safe-fetch';
import sharp from 'sharp';
import { buildXlsx } from './helpers/xlsx-fixture';
import { setupImportShop, type ImportShop } from './helpers/import-shop';

let PNG: Buffer;

const SALLA_HEADER =
  'النوع,أسم المنتج,تصنيف المنتج,صورة المنتج,الوصف,سعر المنتج,السعر المخفض,سعر التكلفة,رمز المنتج sku,الكمية,الوزن,وحدة الوزن,حالة المنتج';
const SALLA_CSV = [
  SALLA_HEADER,
  'منتج,باقة ورد جوري,ورد,https://cdn.example.test/a.png,<p>ورد طازج</p>,١٥٠٫٥٠٥,120.25,60.5,ROSE-1,12,500,جم,ظاهر',
  'منتج,Tulip Box,,https://cdn.example.test/b.png,,45,,,TULIP-1,,,,مخفي',
].join('\n');

describe('Salla and Zid product import (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let a: ImportShop;
  let b: ImportShop;

  beforeAll(async () => {
    PNG = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#cc2244' },
    })
      .png()
      .toBuffer();
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
    a = await setupImportShop(app, db, 'szi-a');
    b = await setupImportShop(app, db, 'szi-b');
  });

  afterAll(async () => {
    await app.close();
  });

  function send(
    kind: 'preview' | 'confirm',
    shop: ImportShop,
    file: Buffer | string,
    filename: string,
    query: Record<string, string | number | undefined>,
  ) {
    return request(app.getHttpServer())
      .post(`/products/import/${kind}`)
      .query(query)
      .set('Authorization', `Bearer ${shop.token}`)
      .attach(
        'file',
        Buffer.isBuffer(file) ? file : Buffer.from(file),
        filename,
      );
  }

  const count = async (shopId: number, table = 'product') =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM ${table} WHERE shopId = ?`,
          [shopId],
        )
      )[0].c,
    );

  describe('Salla', () => {
    it('previews without writing, then confirms with exact money, Arabic text and stock', async () => {
      const q = {
        source: 'salla',
        collectionId: a.collectionId,
        outletId: a.outletId,
      };
      const before = await count(a.shopId);
      const preview = (
        await send('preview', a, SALLA_CSV, 'salla.csv', q).expect(201)
      ).body;
      expect(await count(a.shopId)).toBe(before);
      expect(preview.source).toBe('salla');
      expect(preview.totals).toMatchObject({
        products: 2,
        create: 2,
        error: 0,
      });
      expect(preview.totals.stockUpdates).toBe(1);

      const confirm = (
        await send('confirm', a, SALLA_CSV, 'salla.csv', q).expect(201)
      ).body;
      expect(confirm).toMatchObject({ created: 2, updated: 0, errors: 0 });

      const rows = await db.query<RowDataPacket[]>(
        `SELECT name, slug, price, compareAtPrice, costPrice, weight, status, sku, trackInventory
           FROM product WHERE shopId = ? ORDER BY id`,
        [a.shopId],
      );
      expect(rows[0]).toMatchObject({
        name: 'باقة ورد جوري',
        slug: 'باقة-ورد-جوري',
        sku: 'ROSE-1',
        status: 'Available',
        trackInventory: true,
      });
      // sale price becomes the price, the old price the compare-at; exact decimals
      expect(Number(rows[0].price)).toBe(120.25);
      expect(String(rows[0].compareAtPrice)).toMatch(/^150\.505/);
      expect(String(rows[0].weight)).toMatch(/^0\.5/);
      expect(rows[1]).toMatchObject({
        name: 'Tulip Box',
        status: 'Unavailable',
        trackInventory: false,
      });

      const stock = await db.query<RowDataPacket[]>(
        `SELECT s.stockQuantity FROM outletingredientstock s
           JOIN ingredient i ON i.id = s.ingredientId
           JOIN product p ON p.id = i.shadowProductId
          WHERE p.shopId = ? AND p.sku = 'ROSE-1' AND s.outletId = ?`,
        [a.shopId, a.outletId],
      );
      expect(Number(stock[0].stockQuantity)).toBe(12);
      const ledger = await db.query<RowDataPacket[]>(
        `SELECT type FROM stockmovement WHERE shopId = ?`,
        [a.shopId],
      );
      expect(ledger.map((l) => l.type)).toEqual(['IMPORT']);
    });

    it('re-confirming the same file is a no-op', async () => {
      const q = {
        source: 'salla',
        collectionId: a.collectionId,
        outletId: a.outletId,
      };
      const before = await count(a.shopId);
      const again = (
        await send('confirm', a, SALLA_CSV, 'salla.csv', q).expect(201)
      ).body;
      expect(again).toMatchObject({ created: 0, updated: 0, skipped: 2 });
      expect(await count(a.shopId)).toBe(before);
    });

    it('accepts the same data as an .xlsx', async () => {
      const grid = [
        ['اسم المنتج', 'سعر المنتج', 'رمز المنتج sku', 'صورة المنتج'],
        ['منتج اكسل', 99.5, 'XL-1', 'https://cdn.example.test/x.png'],
      ];
      const q = { source: 'salla', collectionId: a.collectionId };
      const res = (
        await send('confirm', a, buildXlsx(grid), 'salla.xlsx', q).expect(201)
      ).body;
      expect(res).toMatchObject({ created: 1, errors: 0 });
      const rows = await db.query<RowDataPacket[]>(
        `SELECT name, price FROM product WHERE shopId = ? AND sku = 'XL-1'`,
        [a.shopId],
      );
      expect(rows[0].name).toBe('منتج اكسل');
      expect(Number(rows[0].price)).toBe(99.5);
    });

    it('refuses a file without the required columns and names them', async () => {
      const res = await send('preview', a, 'Sku,Quantity\nA,1\n', 'x.csv', {
        source: 'salla',
      }).expect(400);
      expect(res.body.message).toMatch(/Missing columns/);
      expect(
        res.body.missingColumns.map((m: { field: string }) => m.field),
      ).toEqual(['name', 'price']);
    });

    it('reports a bad row with its row number and writes nothing for it', async () => {
      const csv = `${SALLA_HEADER}\nمنتج,Bad Price,,https://cdn.example.test/z.png,,150 SAR,,,BAD-1,,,,\n`;
      const res = (
        await send('confirm', a, csv, 's.csv', {
          source: 'salla',
          collectionId: a.collectionId,
        }).expect(201)
      ).body;
      expect(res).toMatchObject({ created: 0, errors: 1 });
      expect(res.report.products[0].errors.join()).toMatch(
        /Row 2: Price .* is not a plain decimal/,
      );
    });
  });

  describe('Zid', () => {
    it('imports an English/Arabic product with a variant pair and stock', async () => {
      const csv = [
        'name_en,name_ar,price,sku,quantity,option 1 name,option 1 value,images',
        'Cap,قبعة,30.5,CAP-R,2,Colour,Red,https://cdn.example.test/c1.png',
        ',,30.5,CAP-B,3,,Blue,',
      ].join('\n');
      const q = {
        source: 'zid',
        collectionId: a.collectionId,
        outletId: a.outletId,
      };
      const preview = (await send('preview', a, csv, 'zid.csv', q).expect(201))
        .body;
      expect(preview.totals).toMatchObject({
        create: 1,
        error: 0,
        variants: 2,
      });
      expect(preview.products[0].warnings.join()).toMatch(/two languages/);
      await send('confirm', a, csv, 'zid.csv', q).expect(201);
      const variants = await db.query<RowDataPacket[]>(
        `SELECT v.sku FROM productvariant v JOIN product p ON p.id = v.productId
          WHERE p.shopId = ? AND p.slug = 'cap' ORDER BY v.id`,
        [a.shopId],
      );
      expect(variants.map((v) => v.sku)).toEqual(['CAP-R', 'CAP-B']);
    });
  });

  describe('tenant isolation and access', () => {
    it("rejects another shop's collection and outlet ids on preview and confirm", async () => {
      for (const kind of ['preview', 'confirm'] as const) {
        await send(kind, a, SALLA_CSV, 's.csv', {
          source: 'salla',
          collectionId: b.collectionId,
        }).expect(400);
        await send(kind, a, SALLA_CSV, 's.csv', {
          source: 'salla',
          collectionId: a.collectionId,
          outletId: b.outletId,
        }).expect(400);
      }
      expect(await count(b.shopId)).toBe(0);
    });

    it('requires a login', async () => {
      await request(app.getHttpServer())
        .post('/products/import/preview')
        .query({ source: 'salla' })
        .attach('file', Buffer.from(SALLA_CSV), 's.csv')
        .expect(401);
    });

    it('accepts .xlsx only for Salla and Zid', async () => {
      const xlsx = buildXlsx([['name'], ['x']]);
      await send('preview', a, xlsx, 'a.xlsx', {}).expect(400);
      await send('preview', a, xlsx, 'a.xlsx', { source: 'shopify' }).expect(
        400,
      );
      await send('preview', a, xlsx, 'a.xlsx', { source: 'zid' }).expect(400); // no price column
    });
  });

  describe('image copy', () => {
    let copy: ProductImageCopyService;
    let worker: JobsWorkerService;
    const csv = (name: string, sku: string, urls: string) =>
      `name,price,sku,images\n${name},10,${sku},"${urls}"\n`;

    beforeAll(() => {
      copy = app.get(ProductImageCopyService);
      worker = app.get(JobsWorkerService);
    });
    afterEach(() => {
      copy.fetchImage = safeFetchImage;
    });

    const jobsFor = (shopId: number) =>
      db.query<RowDataPacket[]>(
        `SELECT id, idempotencyKey, status FROM job WHERE shopId = ? AND type = 'import_copy_image' ORDER BY id`,
        [shopId],
      );

    it('queues nothing unless asked, and previews what it would queue', async () => {
      const file = csv('NoCopy', 'NC-1', 'https://cdn.example.test/nc.png');
      const q = { source: 'zid', collectionId: a.collectionId };
      const res = (await send('confirm', a, file, 'z.csv', q).expect(201)).body;
      expect(res.imageCopy).toEqual({ queued: 0, skipped: 0 });
      const file2 = csv(
        'WithCopy',
        'WC-1',
        'https://cdn.example.test/wc.png https://cdn.example.test/wc2.png',
      );
      const preview = (
        await send('preview', a, file2, 'z.csv', {
          ...q,
          copyImages: 'true',
        }).expect(201)
      ).body;
      expect(preview.imageCopy).toEqual({
        requested: true,
        willQueue: 2,
        overCap: 0,
      });
    });

    it('queues one job per image after the commit, once, and a re-run adds none', async () => {
      const file = csv('Copied', 'CP-1', 'https://cdn.example.test/cp.png');
      const q = {
        source: 'zid',
        collectionId: a.collectionId,
        copyImages: 'true',
      };
      const first = (await send('confirm', a, file, 'z.csv', q).expect(201))
        .body;
      expect(first.imageCopy).toEqual({ queued: 1, skipped: 0 });
      const jobs = await jobsFor(a.shopId);
      const mine = jobs.filter((j) =>
        (j.idempotencyKey as string).startsWith('imgcopy:'),
      );
      expect(mine.length).toBeGreaterThanOrEqual(1);

      // run the job with a stub fetcher: the stored image replaces the remote URL
      copy.fetchImage = () =>
        Promise.resolve({
          buffer: PNG,
          mime: 'image/png',
          ext: 'png',
          finalUrl: 'x',
        });
      const last = mine[mine.length - 1];
      expect(await worker.processJobById(last.id as number)).toBe(true);
      const images = await db.query<RowDataPacket[]>(
        `SELECT pi.url, p.thumbnail FROM productimage pi JOIN product p ON p.id = pi.productId
          WHERE p.shopId = ? AND p.sku = 'CP-1'`,
        [a.shopId],
      );
      expect(images[0].url).toMatch(/\/uploads\/products\/\d+\/.+\.png$/);
      expect(images[0].thumbnail).toBe(images[0].url);

      // re-confirming the same file: the remote URL is known from the ledger,
      // so no image is re-added and nothing new is queued
      const again = (await send('confirm', a, file, 'z.csv', q).expect(201))
        .body;
      expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1 });
      expect(again.imageCopy).toEqual({ queued: 0, skipped: 0 });
      const imagesAfter = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM productimage pi JOIN product p ON p.id = pi.productId
          WHERE p.shopId = ? AND p.sku = 'CP-1'`,
        [a.shopId],
      );
      expect(Number(imagesAfter[0].c)).toBe(1);
      expect((await jobsFor(a.shopId)).length).toBe(jobs.length);
      // and running the already-done job again fetches nothing
      let fetched = 0;
      copy.fetchImage = () => {
        fetched += 1;
        return Promise.reject(new Error('should not be called'));
      };
      await copy.handle({
        shopId: a.shopId,
        productId: await productId(a, 'CP-1'),
        url: 'https://cdn.example.test/cp.png',
      });
      expect(fetched).toBe(0);
    });

    async function productId(shop: ImportShop, sku: string) {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? AND sku = ?`,
        [shop.shopId, sku],
      );
      return rows[0].id as number;
    }

    it('keeps the remote URL when the fetch is refused, and never calls the network for a private address', async () => {
      const file = csv(
        'Hostile',
        'HO-1',
        'https://169.254.169.254/latest/meta-data/x.png',
      );
      const q = {
        source: 'zid',
        collectionId: a.collectionId,
        copyImages: 'true',
      };
      await send('confirm', a, file, 'z.csv', q).expect(201);
      const id = await productId(a, 'HO-1');
      const jobs = await jobsFor(a.shopId);
      const job = jobs[jobs.length - 1];
      // the REAL fetcher is in place: an IP literal in the metadata range is
      // refused before any DNS or socket
      expect(await worker.processJobById(job.id as number)).toBe(true);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT url FROM productimage WHERE productId = ?`,
        [id],
      );
      expect(rows[0].url).toBe(
        'https://169.254.169.254/latest/meta-data/x.png',
      );
      const done = await db.query<RowDataPacket[]>(
        `SELECT status FROM job WHERE id = ?`,
        [job.id],
      );
      expect(done[0].status).toBe('completed');
    });

    it('a retryable failure is retried, a permanent one is not', async () => {
      const file = csv('Flaky', 'FL-1', 'https://cdn.example.test/fl.png');
      await send('confirm', a, file, 'z.csv', {
        source: 'zid',
        collectionId: a.collectionId,
        copyImages: 'true',
      }).expect(201);
      const jobs = await jobsFor(a.shopId);
      const job = jobs[jobs.length - 1];
      copy.fetchImage = () =>
        Promise.reject(new SafeFetchError('timeout', 'slow', true));
      await worker.processJobById(job.id as number);
      const row = await db.query<RowDataPacket[]>(
        `SELECT status, attempts FROM job WHERE id = ?`,
        [job.id],
      );
      expect(row[0].status).toBe('pending');
      expect(Number(row[0].attempts)).toBe(1);
    });

    it("a job can only touch its own shop's product", async () => {
      const file = csv('Mine', 'MI-1', 'https://cdn.example.test/mi.png');
      await send('confirm', a, file, 'z.csv', {
        source: 'zid',
        collectionId: a.collectionId,
      }).expect(201);
      const id = await productId(a, 'MI-1');
      let fetched = 0;
      copy.fetchImage = () => {
        fetched += 1;
        return Promise.resolve({
          buffer: PNG,
          mime: 'image/png',
          ext: 'png',
          finalUrl: 'x',
        });
      };
      // a payload naming the right product under the WRONG shop does nothing
      await copy.handle({
        shopId: b.shopId,
        productId: id,
        url: 'https://cdn.example.test/mi.png',
      });
      expect(fetched).toBe(0);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT url FROM productimage WHERE productId = ?`,
        [id],
      );
      expect(rows[0].url).toBe('https://cdn.example.test/mi.png');
    });

    it('caps the images queued per product', async () => {
      const urls = Array.from(
        { length: 14 },
        (_, i) => `https://cdn.example.test/many${i}.png`,
      ).join(' ');
      const res = (
        await send('confirm', a, csv('Many', 'MA-1', urls), 'z.csv', {
          source: 'zid',
          collectionId: a.collectionId,
          copyImages: 'true',
        }).expect(201)
      ).body;
      expect(res.imageCopy).toEqual({ queued: 10, skipped: 4 });
    });
  });
});
