import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface ScanPreviewItem {
  rawLine: string;
  name: string;
  quantity: number;
  price: number | null;
  suggestions: { id: number; type: string; name: string; score: number }[];
}
interface ScanPreviewResponse {
  imageUrl: string;
  rawText: string;
  items: ScanPreviewItem[];
  defaultOutletId: number | null;
  unmatchedBehavior: string;
}
interface ScanCommitResponse {
  batchId: number;
  created: number;
  updated: number;
  total: number;
}
interface ScanSettingsResponse {
  excludeKeywords: string[];
  includeKeywords: string[];
  defaultOutletId: number | null;
  unmatchedBehavior: string;
}
interface ProductRow {
  id: number;
  name: string;
  stockQuantity: number | null;
}
interface IngredientRow {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number | null;
}
interface StockMovementRow {
  type: string;
  delta: number;
  productId: number | null;
  ingredientId: number | null;
}
interface StockMovementList {
  data: StockMovementRow[];
  total: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

const RECEIPT_FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'receipt.png'),
);

describe('Scan to Stock (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  // Real tesseract.js OCR calls (not mocked) take a few seconds each — well
  // past Jest's 5s default, especially the multi-preview-call test. Set
  // per-file rather than relying on a CLI --testTimeout flag, so this passes
  // the same way whether run alone or as part of the full suite.
  jest.setTimeout(30000);

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
        name: 'Scan Admin',
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

  function preview(adminToken: string) {
    return request(app.getHttpServer())
      .post('/scan/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', RECEIPT_FIXTURE, {
        filename: 'receipt.png',
        contentType: 'image/png',
      });
  }

  function updateSettings(adminToken: string, patch: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch('/scan/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(patch);
  }

  it('filters lines by exclude/include keywords (case-insensitive) and settings changes affect subsequent scans', async () => {
    const { adminToken } = await setupShop('scan-filter');

    // Default excludeKeywords already covers subtotal/vat/total/thank you —
    // the three real item lines plus the header line survive.
    const res1 = await preview(adminToken).expect(201);
    const preview1 = body<ScanPreviewResponse>(res1);
    const names1 = preview1.items.map((i) => i.name);
    expect(names1).toContain('Fresh Rose Stems');
    expect(names1).toContain('White Lily Bunch');
    expect(names1).toContain('Ribbon Spool');
    expect(names1.some((n) => /subtotal|vat|total|thank you/i.test(n))).toBe(
      false,
    );

    const roses = preview1.items.find((i) => i.name === 'Fresh Rose Stems')!;
    expect(roses.quantity).toBe(2);
    expect(roses.price).toBe(45);
    const lilies = preview1.items.find((i) => i.name === 'White Lily Bunch')!;
    expect(lilies.quantity).toBe(3);
    expect(lilies.price).toBe(30);

    // Add a custom exclude keyword, uppercase to prove case-insensitivity —
    // the Ribbon Spool line should now also be dropped on the *next* scan.
    await updateSettings(adminToken, {
      excludeKeywords: ['subtotal', 'vat', 'total', 'thank you', 'RIBBON'],
    }).expect(200);
    const res2 = await preview(adminToken).expect(201);
    const preview2 = body<ScanPreviewResponse>(res2);
    const names2 = preview2.items.map((i) => i.name);
    expect(names2).toContain('Fresh Rose Stems');
    expect(names2).not.toContain('Ribbon Spool');

    // Include-only keywords: when set, ONLY lines containing one of them
    // survive — even lines that aren't otherwise "noise".
    await updateSettings(adminToken, { includeKeywords: ['rose'] }).expect(200);
    const res3 = await preview(adminToken).expect(201);
    const preview3 = body<ScanPreviewResponse>(res3);
    expect(preview3.items.map((i) => i.name)).toEqual(['Fresh Rose Stems']);
  });

  it('writes nothing until explicit commit, and tenant-scopes suggestions on preview', async () => {
    const shopA = await setupShop('scan-isolation-a');
    const shopB = await setupShop('scan-isolation-b');

    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .send({
        name: 'Fresh Rose Stems',
        price: 40,
        thumbnail: 'https://example.com/x.jpg',
        sku: `ISO-${runId}`,
        categoryIds: [shopA.categoryId],
      })
      .expect(201);

    const beforeB = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<ProductRow[]>(beforeB)).toHaveLength(0);

    const res = await preview(shopB.adminToken).expect(201);
    const previewB = body<ScanPreviewResponse>(res);
    // Shop A's product must never appear as a suggestion in shop B's scan,
    // even though the OCR text ("Fresh Rose Stems") matches it exactly.
    const allSuggestionNames = previewB.items.flatMap((i) =>
      i.suggestions.map((s) => s.name),
    );
    expect(allSuggestionNames).not.toContain('Fresh Rose Stems');

    // Preview is read-only — nothing was created or moved for either shop.
    const afterB = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<ProductRow[]>(afterB)).toHaveLength(0);
    const movementsB = await request(app.getHttpServer())
      .get('/products/stock/movements')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<StockMovementList>(movementsB).total).toBe(0);
  });

  it('creates a new Product and a new Ingredient end-to-end on commit', async () => {
    const { adminToken, outletId, categoryId } = await setupShop('scan-create');

    const res = await request(app.getHttpServer())
      .post('/scan/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageUrl: '/uploads/scans/test-fixture.png',
        items: [
          {
            targetType: 'product',
            outletId,
            quantity: 12,
            createNew: { name: 'Scanned New Rose', price: 22, categoryId },
          },
          {
            targetType: 'ingredient',
            outletId,
            quantity: 7,
            createNew: { name: 'Scanned New Wire', unit: 'spools' },
          },
        ],
      })
      .expect(201);
    const result = body<ScanCommitResponse>(res);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);

    const products = await request(app.getHttpServer())
      .get(`/products?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const newProduct = body<ProductRow[]>(products).find(
      (p) => p.name === 'Scanned New Rose',
    );
    expect(newProduct).toBeDefined();
    expect(newProduct!.stockQuantity).toBe(12);

    const ingredients = await request(app.getHttpServer())
      .get(`/shop/ingredients?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const newIngredient = body<IngredientRow[]>(ingredients).find(
      (i) => i.name === 'Scanned New Wire',
    );
    expect(newIngredient).toBeDefined();
    expect(newIngredient!.unit).toBe('spools');
    expect(newIngredient!.stockQuantity).toBe(7);
  });

  it('applies a RECEIVED StockMovement for a matched item — adds to existing stock, never overwrites it', async () => {
    const { adminToken, outletId, categoryId } =
      await setupShop('scan-matched');

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Existing Scan Target',
        price: 18,
        thumbnail: 'https://example.com/x.jpg',
        sku: `MATCH-${runId}`,
        categoryIds: [categoryId],
        trackInventory: true,
      })
      .expect(201);
    const productId = body<ProductRow>(product).id;

    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId, delta: 10, reason: 'received' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/scan/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageUrl: '/uploads/scans/test-fixture.png',
        items: [
          {
            targetType: 'product',
            matchedId: productId,
            outletId,
            quantity: 5,
          },
        ],
      })
      .expect(201);
    expect(body<ScanCommitResponse>(res).updated).toBe(1);
    expect(body<ScanCommitResponse>(res).created).toBe(0);

    // 10 (already there) + 5 (received via scan) = 15, not overwritten to 5.
    const after = await request(app.getHttpServer())
      .get(`/products/${productId}?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<ProductRow>(after).stockQuantity).toBe(15);

    const movements = await request(app.getHttpServer())
      .get(`/products/stock/movements?productId=${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rows = body<StockMovementList>(movements).data;
    const received = rows.find((m) => m.type === 'RECEIVED');
    expect(received).toBeDefined();
    expect(received!.delta).toBe(5);
  });

  it("rejects committing against another shop's matchedId or outletId", async () => {
    const shopA = await setupShop('scan-commit-tenant-a');
    const shopB = await setupShop('scan-commit-tenant-b');

    const productA = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .send({
        name: 'Shop A Product',
        price: 20,
        thumbnail: 'https://example.com/x.jpg',
        sku: `TENANT-${runId}`,
        categoryIds: [shopA.categoryId],
      })
      .expect(201);
    const productAId = body<ProductRow>(productA).id;

    // Shop B tries to add stock to Shop A's product by id.
    const attempt1 = await request(app.getHttpServer())
      .post('/scan/commit')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({
        imageUrl: '/uploads/scans/x.png',
        items: [
          {
            targetType: 'product',
            matchedId: productAId,
            outletId: shopB.outletId,
            quantity: 5,
          },
        ],
      });
    expect(attempt1.status).toBe(400);

    // Shop B tries to target Shop A's outlet.
    const attempt2 = await request(app.getHttpServer())
      .post('/scan/commit')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({
        imageUrl: '/uploads/scans/x.png',
        items: [
          {
            targetType: 'product',
            outletId: shopA.outletId,
            quantity: 5,
            createNew: {
              name: 'Sneaky Product',
              price: 10,
              categoryId: shopB.categoryId,
            },
          },
        ],
      });
    expect(attempt2.status).toBe(400);

    // Confirm Shop A's product/stock are untouched by either attempt — no
    // outletstock row was ever created for it, so this is null (no row),
    // not 0 (a row that says "none in stock").
    const productAfter = await request(app.getHttpServer())
      .get(`/products/${productAId}?outletId=${shopA.outletId}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<ProductRow>(productAfter).stockQuantity).toBeNull();
  });

  it('tenant-scopes the scan settings endpoint', async () => {
    const shopA = await setupShop('scan-settings-tenant-a');
    const shopB = await setupShop('scan-settings-tenant-b');

    await updateSettings(shopA.adminToken, {
      excludeKeywords: ['shop-a-only-keyword'],
    }).expect(200);

    const settingsB = await request(app.getHttpServer())
      .get('/scan/settings')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<ScanSettingsResponse>(settingsB).excludeKeywords).not.toContain(
      'shop-a-only-keyword',
    );

    // Shop B can't set its default outlet to Shop A's outlet id.
    const attempt = await updateSettings(shopB.adminToken, {
      defaultOutletId: shopA.outletId,
    });
    expect(attempt.status).toBe(400);
  });
});
