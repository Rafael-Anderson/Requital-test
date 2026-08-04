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
interface OutletRow {
  id: number;
}
interface IngredientRow {
  id: number;
  name: string;
  unit: string;
  trackInventory: boolean;
  stockQuantity: number | null;
}
interface ImportRowResult {
  rowNumber: number;
  action: 'create' | 'update' | 'reject';
  errors: string[];
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

const HEADERS = ['Name', 'Unit', 'Track Inventory', 'Stock'];

function buildCsv(rows: Record<string, unknown>[]): string {
  const lines = [
    HEADERS,
    ...rows.map((r) => HEADERS.map((h) => String(r[h] ?? ''))),
  ];
  return lines.map((line) => line.join(',')).join('\r\n');
}

describe('Ingredients CSV Import/Export (e2e)', () => {
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

    return { adminToken, outletId };
  }

  function confirm(adminToken: string, csv: string, outletId?: number) {
    return request(app.getHttpServer())
      .post(
        `/shop/ingredients/import/confirm${outletId ? `?outletId=${outletId}` : ''}`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv), {
        filename: 'ingredients.csv',
        contentType: 'text/csv',
      });
  }

  it('round-trips create, then update, and reports a bad row without failing the batch', async () => {
    const { adminToken, outletId } = await setupShop('ing-import');

    // Row 1 creates; row 2 is malformed and must not block row 1.
    const createCsv = buildCsv([
      {
        Name: 'Fresh Roses',
        Unit: 'stems',
        'Track Inventory': 'true',
        Stock: 50,
      },
      { Name: '', Unit: 'kg', Stock: 'oops' },
    ]);
    const createRes = await confirm(adminToken, createCsv, outletId).expect(
      201,
    );
    const created = body<ImportConfirmResponse>(createRes);
    expect(created.created).toBe(1);
    expect(created.skipped).toBe(1);
    expect(created.rows[0].action).toBe('create');
    expect(created.rows[1].action).toBe('reject');

    const list = await request(app.getHttpServer())
      .get(`/shop/ingredients?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rose = body<IngredientRow[]>(list).find(
      (i) => i.name === 'Fresh Roses',
    );
    expect(rose).toBeDefined();
    expect(rose!.stockQuantity).toBe(50);

    // Re-importing the same name now updates it (matched by name) instead
    // of creating a duplicate — and setting Stock again to the same value
    // is a no-op, satisfying round-trip fidelity.
    const updateCsv = buildCsv([
      { Name: 'Fresh Roses', Unit: 'stems', Stock: 50 },
    ]);
    const updateRes = await confirm(adminToken, updateCsv, outletId).expect(
      201,
    );
    const updated = body<ImportConfirmResponse>(updateRes);
    expect(updated.updated).toBe(1);
    expect(updated.created).toBe(0);

    const listAfter = await request(app.getHttpServer())
      .get(`/shop/ingredients?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rosesAfter = body<IngredientRow[]>(listAfter).filter(
      (i) => i.name === 'Fresh Roses',
    );
    expect(rosesAfter).toHaveLength(1);
    expect(rosesAfter[0].stockQuantity).toBe(50);
  });

  it("scopes matching to the importing shop — a colliding name from another shop's CSV creates a new row", async () => {
    const shopA = await setupShop('ing-tenant-a');
    const shopB = await setupShop('ing-tenant-b');
    const name = `Shared Ingredient ${runId}`;

    await request(app.getHttpServer())
      .post('/shop/ingredients')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .send({ name, unit: 'kg' })
      .expect(201);

    const csv = buildCsv([{ Name: name, Unit: 'pieces' }]);
    const res = await confirm(shopB.adminToken, csv).expect(201);
    const result = body<ImportConfirmResponse>(res);
    expect(result.rows[0].action).toBe('create');
    expect(result.created).toBe(1);

    const shopAList = await request(app.getHttpServer())
      .get('/shop/ingredients')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    const shopAIngredient = body<IngredientRow[]>(shopAList).find(
      (i) => i.name === name,
    );
    expect(shopAIngredient?.unit).toBe('kg');
  });

  // Regression test for a real bug: confirmImportIngredients used to trust
  // the outletId query param directly for stock writes with no ownership
  // check, letting Shop A's admin write stock/movement rows into Shop B's
  // outlet just by knowing/guessing its id.
  it("rejects a CSV import confirm targeting another shop's outletId, and writes nothing", async () => {
    const shopA = await setupShop('ing-spoof-a');
    const shopB = await setupShop('ing-spoof-b');
    const name = `Spoof Target ${runId}`;

    const csv = buildCsv([{ Name: name, Unit: 'stems', Stock: 99 }]);
    await confirm(shopA.adminToken, csv, shopB.outletId).expect(404);

    // Nothing was created under either shop as a side effect of the
    // rejected request.
    const shopAList = await request(app.getHttpServer())
      .get('/shop/ingredients')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<IngredientRow[]>(shopAList).some((i) => i.name === name)).toBe(
      false,
    );

    const shopBList = await request(app.getHttpServer())
      .get(`/shop/ingredients?outletId=${shopB.outletId}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<IngredientRow[]>(shopBList).some((i) => i.name === name)).toBe(
      false,
    );

    const shopBStockMovements = await prisma.stockmovement.findMany({
      where: { outletId: shopB.outletId },
    });
    expect(shopBStockMovements).toHaveLength(0);
  });
});
