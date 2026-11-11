import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface CollectionBody {
  id: number;
  slug: string;
  defaultSort: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Collection defaultSort (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => app.getHttpServer();

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'Sort Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(http(), body<AuthResponse>(signup).devVerificationLink);
    await db.execute(`UPDATE shop SET published = 1 WHERE subdomain = ?`, [slug]);
    return { token, slug };
  }

  it('is NULL for a new and for every existing collection (current behaviour = Newest)', async () => {
    const { token, slug } = await setupShop('ds-default');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plain' })
      .expect(201);
    expect(body<CollectionBody>(created).defaultSort).toBeNull();
    const pub = await request(http()).get(`/public/${slug}/collections/${body<CollectionBody>(created).slug}`).expect(200);
    expect(body<CollectionBody>(pub).defaultSort).toBeNull();
  });

  it('is saved on create and update, returned by the admin API and the public collection, and cleared by null', async () => {
    const { token, slug } = await setupShop('ds-save');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cheap first', defaultSort: 'price_asc' })
      .expect(201);
    const c = body<CollectionBody>(created);
    expect(c.defaultSort).toBe('price_asc');

    const admin = await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(body<CollectionBody>(admin).defaultSort).toBe('price_asc');
    const list = await request(http()).get('/collections').set('Authorization', `Bearer ${token}`).expect(200);
    expect(body<CollectionBody[]>(list).find((x) => x.id === c.id)?.defaultSort).toBe('price_asc');
    const pub = await request(http()).get(`/public/${slug}/collections/${c.slug}`).expect(200);
    expect(body<CollectionBody>(pub).defaultSort).toBe('price_asc');

    const upd = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultSort: 'best_selling' })
      .expect(200);
    expect(body<CollectionBody>(upd).defaultSort).toBe('best_selling');

    // an unrelated edit leaves it alone
    const renamed = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'x' })
      .expect(200);
    expect(body<CollectionBody>(renamed).defaultSort).toBe('best_selling');

    const cleared = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultSort: null })
      .expect(200);
    expect(body<CollectionBody>(cleared).defaultSort).toBeNull();
  });

  it('works for an automated collection too', async () => {
    const { token, slug } = await setupShop('ds-auto');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Auto',
        collectionType: 'automated',
        matchMode: 'all',
        rules: [{ field: 'title', operator: 'contains', value: 'rose' }],
        defaultSort: 'az',
      })
      .expect(201);
    const c = body<CollectionBody>(created);
    const pub = await request(http()).get(`/public/${slug}/collections/${c.slug}`).expect(200);
    expect(body<CollectionBody>(pub).defaultSort).toBe('az');
  });

  it('rejects an unknown value with 400', async () => {
    const { token } = await setupShop('ds-bad');
    await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', defaultSort: 'popular' })
      .expect(400);
    const ok = await request(http()).post('/collections').set('Authorization', `Bearer ${token}`).send({ name: 'Ok' }).expect(201);
    await request(http())
      .patch(`/collections/${body<CollectionBody>(ok).id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultSort: "newest'; DROP TABLE collection; --" })
      .expect(400);
  });

  it('is shop-scoped: another shop can neither read nor change it', async () => {
    const a = await setupShop('ds-a');
    const b = await setupShop('ds-b');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Mine', defaultSort: 'oldest' })
      .expect(201);
    const c = body<CollectionBody>(created);
    await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${b.token}`).expect(404);
    await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ defaultSort: 'newest' })
      .expect(404);
    const list = await request(http()).get('/collections').set('Authorization', `Bearer ${b.token}`).expect(200);
    expect(body<CollectionBody[]>(list).some((x) => x.id === c.id)).toBe(false);
    // still unchanged for its owner
    const again = await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(body<CollectionBody>(again).defaultSort).toBe('oldest');
  });
});
