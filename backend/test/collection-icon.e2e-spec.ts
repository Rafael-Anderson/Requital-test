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
  image: string | null;
  icon: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Collection icon + banner (e2e)', () => {
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
        name: 'Icon Admin',
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

  it('icon is NULL for a new collection and the banner (image) is untouched', async () => {
    const { token, slug } = await setupShop('ic-null');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Banner only', image: '/uploads/collections/banner.jpg' })
      .expect(201);
    const c = body<CollectionBody>(created);
    expect(c.icon).toBeNull();
    expect(c.image).toBe('/uploads/collections/banner.jpg');
    const pub = await request(http()).get(`/public/${slug}/collections/${c.slug}`).expect(200);
    expect(body<CollectionBody>(pub).icon).toBeNull();
    expect(body<CollectionBody>(pub).image).toBe('/uploads/collections/banner.jpg');
  });

  it('carries both images through admin create/update/list and the public detail and list; null clears only the icon', async () => {
    const { token, slug } = await setupShop('ic-both');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Both', image: '/uploads/collections/b.jpg', icon: '/uploads/collections/i.png' })
      .expect(201);
    const c = body<CollectionBody>(created);
    expect(c.icon).toBe('/uploads/collections/i.png');
    expect(c.image).toBe('/uploads/collections/b.jpg');

    const admin = await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(body<CollectionBody>(admin).icon).toBe('/uploads/collections/i.png');
    const pubList = await request(http()).get(`/public/${slug}/collections`).expect(200);
    const row = body<CollectionBody[]>(pubList).find((x) => x.id === c.id);
    expect(row?.icon).toBe('/uploads/collections/i.png');
    expect(row?.image).toBe('/uploads/collections/b.jpg');
    const pub = await request(http()).get(`/public/${slug}/collections/${c.slug}`).expect(200);
    expect(body<CollectionBody>(pub).icon).toBe('/uploads/collections/i.png');
    expect(body<CollectionBody>(pub).image).toBe('/uploads/collections/b.jpg');

    // an unrelated edit leaves both alone
    const renamed = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'x' })
      .expect(200);
    expect(body<CollectionBody>(renamed).icon).toBe('/uploads/collections/i.png');
    expect(body<CollectionBody>(renamed).image).toBe('/uploads/collections/b.jpg');

    const cleared = await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ icon: null })
      .expect(200);
    expect(body<CollectionBody>(cleared).icon).toBeNull();
    expect(body<CollectionBody>(cleared).image).toBe('/uploads/collections/b.jpg');
  });

  it('works for an automated collection', async () => {
    const { token, slug } = await setupShop('ic-auto');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Auto',
        collectionType: 'automated',
        matchMode: 'all',
        rules: [{ field: 'title', operator: 'contains', value: 'rose' }],
        icon: '/uploads/collections/auto.png',
      })
      .expect(201);
    const c = body<CollectionBody>(created);
    const pub = await request(http()).get(`/public/${slug}/collections/${c.slug}`).expect(200);
    expect(body<CollectionBody>(pub).icon).toBe('/uploads/collections/auto.png');
  });

  it('is shop scoped: another shop cannot change or read this shop\'s icon', async () => {
    const a = await setupShop('ic-a');
    const b = await setupShop('ic-b');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Mine', icon: '/uploads/collections/a.png' })
      .expect(201);
    const c = body<CollectionBody>(created);
    await request(http())
      .patch(`/collections/${c.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ icon: '/uploads/collections/evil.png' })
      .expect(404);
    await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${b.token}`).expect(404);
    const pubB = await request(http()).get(`/public/${b.slug}/collections`).expect(200);
    expect(body<CollectionBody[]>(pubB).some((x) => x.id === c.id)).toBe(false);
    const still = await request(http()).get(`/collections/${c.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(body<CollectionBody>(still).icon).toBe('/uploads/collections/a.png');
  });

  it('rejects a non-string or over-long icon with 400', async () => {
    const { token } = await setupShop('ic-bad');
    await request(http()).post('/collections').set('Authorization', `Bearer ${token}`).send({ name: 'X', icon: 5 }).expect(400);
    await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Y', icon: 'a'.repeat(300) })
      .expect(400);
  });

  it('the public bio page carries both images of a linked collection', async () => {
    const { token, slug } = await setupShop('ic-bio');
    const created = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bio coll', image: '/uploads/collections/bb.jpg', icon: '/uploads/collections/bi.png' })
      .expect(201);
    const c = body<CollectionBody>(created);
    await request(http())
      .post('/shop/bio-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COLLECTION', label: 'Shop it', collectionId: c.id })
      .expect(201);
    const pub = await request(http()).get(`/public/${slug}/bio-links`).expect(200);
    const links = body<Array<{ type: string; collection?: { image: string | null; icon: string | null } | null }>>(pub);
    const link = links.find((l) => l.type === 'COLLECTION');
    expect(link?.collection?.image).toBe('/uploads/collections/bb.jpg');
    expect(link?.collection?.icon).toBe('/uploads/collections/bi.png');
  });
});

