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
interface CollectionRow {
  id: number;
  name: string;
  slug: string;
  displayOrder: number;
  parentCollectionId: number | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Basic CRUD + tree/cycle guards + the new reorder endpoint for the
// Phase C-renamed taxonomy (formerly `categories/`). CollectionsService's
// behavior is otherwise unchanged from the pre-rename CategoriesService —
// this suite exists mainly to lock in the rename and cover the genuinely
// new reorder endpoint, which had no prior coverage.
describe('Collections (e2e)', () => {
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
        name: 'Collections Admin',
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
    return { adminToken };
  }

  async function createCollection(
    adminToken: string,
    data: { name: string; parentCollectionId?: number; displayOrder?: number },
  ) {
    const res = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(data)
      .expect(201);
    return body<CollectionRow>(res);
  }

  it('creates, lists, updates, and deletes a collection', async () => {
    const { adminToken } = await setupShop('coll-crud');
    const created = await createCollection(adminToken, { name: 'Bouquets' });
    expect(created.slug).toBe('bouquets');

    const list = await request(app.getHttpServer())
      .get('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      body<CollectionRow[]>(list).some((c) => c.id === created.id),
    ).toBe(true);

    await request(app.getHttpServer())
      .patch(`/collections/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Fresh Bouquets' })
      .expect(200);

    const fetched = await request(app.getHttpServer())
      .get(`/collections/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<CollectionRow>(fetched).name).toBe('Fresh Bouquets');

    await request(app.getHttpServer())
      .delete(`/collections/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('rejects a duplicate slug within the same shop', async () => {
    const { adminToken } = await setupShop('coll-slug');
    await createCollection(adminToken, { name: 'Gifts' });
    await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Something Else', slug: 'gifts' })
      .expect(409);
  });

  it('supports parent/child nesting and blocks a cycle', async () => {
    const { adminToken } = await setupShop('coll-tree');
    const parent = await createCollection(adminToken, { name: 'Flowers' });
    const child = await createCollection(adminToken, {
      name: 'Roses',
      parentCollectionId: parent.id,
    });
    expect(child.parentCollectionId).toBe(parent.id);

    await request(app.getHttpServer())
      .patch(`/collections/${parent.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ parentCollectionId: child.id })
      .expect(400);
  });

  it('blocks deleting a collection that has children or assigned products', async () => {
    const { adminToken } = await setupShop('coll-delete-blocked');
    const parent = await createCollection(adminToken, { name: 'Plants' });
    await createCollection(adminToken, {
      name: 'Succulents',
      parentCollectionId: parent.id,
    });

    await request(app.getHttpServer())
      .delete(`/collections/${parent.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it("adversarial: cannot read, update, or delete another shop's collection by spoofing its id", async () => {
    const shopA = await setupShop('coll-iso-a');
    const shopB = await setupShop('coll-iso-b');
    const collectionA = await createCollection(shopA.adminToken, {
      name: 'Shop A Only',
    });

    await request(app.getHttpServer())
      .get(`/collections/${collectionA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/collections/${collectionA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/collections/${collectionA.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
  });

  describe('reorder', () => {
    it('applies the requested display order to every collection in one call', async () => {
      const { adminToken } = await setupShop('coll-reorder');
      const first = await createCollection(adminToken, { name: 'Aardvark' });
      const second = await createCollection(adminToken, { name: 'Bumblebee' });
      const third = await createCollection(adminToken, { name: 'Coyote' });

      const reordered = await request(app.getHttpServer())
        .patch('/collections/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [third.id, first.id, second.id] })
        .expect(200);
      const rows = body<CollectionRow[]>(reordered);
      expect(rows.map((r) => r.id)).toEqual([third.id, first.id, second.id]);
      expect(rows.map((r) => r.displayOrder)).toEqual([0, 1, 2]);
    });

    it('rejects a reorder that is missing an id or includes a foreign one', async () => {
      const shopA = await setupShop('coll-reorder-bad-a');
      const shopB = await setupShop('coll-reorder-bad-b');
      const a1 = await createCollection(shopA.adminToken, { name: 'A1' });
      await createCollection(shopA.adminToken, { name: 'A2' });
      const foreign = await createCollection(shopB.adminToken, {
        name: 'B1',
      });

      await request(app.getHttpServer())
        .patch('/collections/reorder')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ ids: [a1.id] })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/collections/reorder')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ ids: [a1.id, foreign.id] })
        .expect(400);
    });

    it('is admin-only, same tier as create/update/delete', async () => {
      const { adminToken } = await setupShop('coll-reorder-role');
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const outletA = body<{ id: number }[]>(outlets)[0].id;
      const collection = await createCollection(adminToken, { name: 'Only' });

      const staffEmail = `coll-reorder-role-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Staff',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .patch('/collections/reorder')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ ids: [collection.id] })
        .expect(403);
    });
  });
});
