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
interface ProductRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Notify subscriptions (e2e)', () => {
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

  async function setupShopWithProduct(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Notify Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 50,
        thumbnail: 'https://example.com/p.jpg',
        sku: `NOTIFY-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        categoryIds: [body<IdRow>(category).id],
      })
      .expect(201);

    return { adminToken, productId: body<ProductRow>(product).id };
  }

  it('subscribes, is idempotent on a duplicate, and unsubscribes', async () => {
    const { productId } = await setupShopWithProduct('e2e-notify');
    const email = `shopper-${runId}@example.com`;

    const first = await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId, email })
      .expect(201);
    expect(body<{ alreadySubscribed: boolean }>(first).alreadySubscribed).toBe(false);

    const second = await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId, email })
      .expect(201);
    expect(body<{ alreadySubscribed: boolean }>(second).alreadySubscribed).toBe(true);

    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email, productId })
      .expect(200);

    const row = await prisma.notifysubscription.findFirst({
      where: { productId, email },
    });
    expect(row).toBeNull();
  });

  it('rejects a subscribe for a productId that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId: 999999999, email: 'nobody@example.com' })
      .expect(404);
  });

  it('rejects an unsubscribe with a non-numeric productId rather than 500ing', async () => {
    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email: 'nobody@example.com', productId: 'not-a-number' })
      .expect(400);
  });

  it('a product from shop B cannot be used to enumerate or delete shop A\'s subscription', async () => {
    const shopA = await setupShopWithProduct('e2e-notify-a');
    const shopB = await setupShopWithProduct('e2e-notify-b');
    const email = `shopper-${runId}@example.com`;

    await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId: shopA.productId, email })
      .expect(201);

    // Unsubscribing using shop B's product id must not touch shop A's row.
    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email, productId: shopB.productId })
      .expect(200);

    const stillThere = await prisma.notifysubscription.findFirst({
      where: { productId: shopA.productId, email },
    });
    expect(stillThere).not.toBeNull();
  });
});
